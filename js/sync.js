// 多设备同步。规则很简单：每个文档以"最后修改的那台设备"为准。
// 没登录或没有服务器时什么都不做，应用照常纯本地使用。
import * as DB from './db.js';

const API = 'api/';
let token = localStorage.getItem('sync-token');
let lastRev = null;
let running = false, again = false, timer = null;

/** status: none 没有服务器 | off 未登录 | syncing | ok | offline | error */
export const state = { status: 'none', setup: false, lastSync: 0 };
const listeners = new Set();
export const onStatus = (fn) => listeners.add(fn);
let onPulled = () => {};
export const setOnPulled = (fn) => { onPulled = fn; };
function set(status) {
  state.status = status;
  listeners.forEach((fn) => fn(state));
}

export const loggedIn = () => !!token;

async function call(pathname, opts = {}) {
  const res = await fetch(API + pathname, {
    ...opts,
    cache: 'no-store',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opts.headers },
  });
  if (res.status === 401 && token && !opts.login) {
    logout();
    throw new Error('登录已失效，请重新登录');
  }
  if (!res.ok) {
    let msg = `请求失败（${res.status}）`;
    try { msg = (await res.json()).error || msg; } catch { /* 不是 JSON */ }
    throw new Error(msg);
  }
  return res;
}
const getJson = async (p) => (await call(p)).json();
const putJson = async (p, body) => (await call(p, { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })).json();

/** 启动时探测：这个网址后面有没有同步服务。 */
export async function init() {
  try {
    const res = await fetch(`${API}status`, { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) throw new Error('no server');
    const s = await res.json();
    state.setup = s.setup;
    if (token && !s.authed) { token = null; localStorage.removeItem('sync-token'); }
    set(token ? 'ok' : 'off');
  } catch {
    // 离线打开时保留登录状态，等联网后再同步
    set(token ? 'offline' : 'none');
  }
  if (token) syncNow();
}

export async function login(password) {
  const res = await call(state.setup ? 'login' : 'setup', {
    method: 'POST', login: true, body: JSON.stringify({ password }), headers: { 'Content-Type': 'application/json' },
  });
  token = (await res.json()).token;
  localStorage.setItem('sync-token', token);
  state.setup = true;
  lastRev = null;
  set('ok');
  await syncNow();
}

export function logout() {
  token = null;
  lastRev = null;
  localStorage.removeItem('sync-token');
  set('off');
}

/** 稍后同步（把短时间内的多次改动合并成一次）。 */
export function kick(delay = 1200) {
  if (!token) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

/** 重新编辑从别的设备同步来的页面时，按需下载原图。 */
export async function fetchSrc(pageId) {
  return (await call(`pages/${pageId}/src`)).blob();
}

async function uploadDoc(d) {
  const pages = await DB.getPages(d.pageIds);
  for (const p of pages) {
    if (p.up === p.ver) continue;
    const { img, src, up, docId, ...meta } = p;
    await putJson(`pages/${p.id}/meta`, meta);
    await call(`pages/${p.id}/img`, { method: 'PUT', body: img, headers: { 'Content-Type': 'image/jpeg' } });
    if (src) await call(`pages/${p.id}/src`, { method: 'PUT', body: src, headers: { 'Content-Type': 'image/jpeg' } });
    p.up = p.ver;
    await DB.putPage(p);
  }
  const { dirty, ...body } = d;
  const { ok } = await putJson(`docs/${d.id}`, body);
  if (!ok) return false; // 服务器上的更新，下一轮会拉下来
  const cur = await DB.getDocRaw(d.id);
  if (cur && !cur.deleted && cur.updated === d.updated) {
    cur.dirty = false;
    await DB.putDocRaw(cur);
    return true;
  }
  return false; // 上传期间本机又改了，再来一轮
}

async function downloadDoc(r, local) {
  for (const id of r.pageIds) {
    const have = await DB.getPage(id);
    if (have && have.ver === r.pageVers?.[id]) continue;
    const meta = await getJson(`pages/${id}/meta`);
    const img = await (await call(`pages/${id}/img`)).blob();
    await DB.putPage({ ...meta, img, docId: r.id, up: meta.ver });
  }
  for (const id of local?.pageIds || []) if (!r.pageIds.includes(id)) await DB.deletePage(id);
  await DB.putDocRaw({ ...r, dirty: false });
}

export async function syncNow() {
  if (!token) return;
  if (running) { again = true; return; }
  running = true;
  clearTimeout(timer);
  let pulled = false;
  try {
    let all = await DB.listAllDocs();
    if (lastRev !== null && !all.some((d) => d.dirty)) {
      const { rev } = await getJson('rev');
      if (rev === lastRev) { state.lastSync = Date.now(); set('ok'); return; }
    }
    set('syncing');
    const remote = await getJson('state');
    const rmap = new Map(remote.docs.map((d) => [d.id, d]));

    // 上传本机的改动
    for (const d of all) {
      const r = rmap.get(d.id);
      if (d.deleted) {
        if (d.dirty && !(r && r.deleted)) await call(`docs/${d.id}?updated=${d.updated}`, { method: 'DELETE' });
        await DB.removeDoc(d);
        continue;
      }
      if (r && (r.updated > d.updated || !d.dirty)) continue; // 服务器更新，或没有改动
      if (!(await uploadDoc(d))) again = true;
    }

    // 下载别的设备的改动
    const local = new Map((await DB.listAllDocs()).map((d) => [d.id, d]));
    for (const r of remote.docs) {
      const l = local.get(r.id);
      if (r.deleted) {
        if (l && !l.deleted && l.updated <= r.updated) { await DB.removeDoc(l); pulled = true; }
        continue;
      }
      if (l && l.updated >= r.updated) continue;
      await downloadDoc(r, l);
      pulled = true;
    }

    lastRev = (await getJson('rev')).rev;
    state.lastSync = Date.now();
    set('ok');
  } catch (e) {
    console.warn('同步失败', e);
    if (token) set(navigator.onLine === false || e instanceof TypeError ? 'offline' : 'error');
  } finally {
    running = false;
    if (pulled) onPulled();
    if (again) { again = false; kick(400); }
  }
}

DB.setOnChange(() => kick());
addEventListener('online', () => kick(200));
document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(200); });
setInterval(() => { if (!document.hidden) syncNow(); }, 15000);
