// 扫描仪 · 同步服务端。零依赖（只用 Node 自带模块）。
// 负责两件事：1) 提供网页文件；2) 保存各设备同步上来的文档和图片。
// 单用户：第一次访问时设置同步密码，之后各设备用这个密码登录。
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const PAGES = path.join(DATA, 'pages');
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY = 30 * 1024 * 1024;

fs.mkdirSync(PAGES, { recursive: true });

/* ---------- 存储 ---------- */

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
async function writeAtomic(file, data) {
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

const STATE_FILE = path.join(DATA, 'state.json');
const AUTH_FILE = path.join(DATA, 'auth.json');
const state = readJson(STATE_FILE, { rev: 0, docs: {} });
let auth = readJson(AUTH_FILE, null);

let saving = Promise.resolve();
function saveState() {
  state.rev++;
  saving = saving.then(() => writeAtomic(STATE_FILE, JSON.stringify(state))).catch((e) => console.error('保存失败', e));
  return saving;
}

const pageFile = (id, kind) => path.join(PAGES, `${id}.${kind}`);
async function removePages(ids) {
  for (const id of ids) for (const kind of ['meta', 'img', 'src']) await fsp.rm(pageFile(id, kind), { force: true });
}

/* ---------- 登录 ---------- */

const scrypt = (password, salt) => crypto.scryptSync(password, salt, 32);
const tokenOf = (a) => crypto.createHmac('sha256', Buffer.from(a.secret, 'hex')).update('token-v1').digest('hex');
const sameBytes = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

async function setPassword(password) {
  const salt = crypto.randomBytes(16);
  auth = { salt: salt.toString('hex'), hash: scrypt(password, salt).toString('hex'), secret: crypto.randomBytes(32).toString('hex') };
  await writeAtomic(AUTH_FILE, JSON.stringify(auth));
  await fsp.chmod(AUTH_FILE, 0o600).catch(() => {});
  return tokenOf(auth);
}

function authed(req) {
  if (!auth) return false;
  const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization || '');
  return !!m && sameBytes(Buffer.from(m[1], 'hex'), Buffer.from(tokenOf(auth), 'hex'));
}

// 防暴力破解：同一 IP 连续输错 5 次，锁 10 分钟
const fails = new Map();
const clientIp = (req) => req.headers['x-real-ip'] || req.socket.remoteAddress || '';
function locked(ip) {
  const f = fails.get(ip);
  return !!f && f.until > Date.now();
}
function noteFail(ip) {
  const f = fails.get(ip) || { n: 0, until: 0 };
  f.n++;
  if (f.n >= 5) { f.until = Date.now() + 10 * 60 * 1000; f.n = 0; }
  fails.set(ip, f);
}

/* ---------- HTTP 小工具 ---------- */

function send(res, code, body, headers = {}) {
  const isJson = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  const data = isJson ? JSON.stringify(body) : body ?? '';
  res.writeHead(code, { 'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const readJsonBody = async (req) => {
  try { return JSON.parse((await readBody(req)).toString('utf8')); } catch (e) { if (e.code) throw e; throw Object.assign(new Error('bad json'), { code: 400 }); }
};

const ID = /^[A-Za-z0-9-]{8,64}$/;

/* ---------- 接口 ---------- */

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // 去掉 "api"
  const [a, id, kind] = parts;
  const m = req.method;

  if (a === 'status' && m === 'GET') return send(res, 200, { setup: !!auth, authed: authed(req) });

  if ((a === 'setup' || a === 'login') && m === 'POST') {
    const ip = clientIp(req);
    if (locked(ip)) return send(res, 429, { error: '尝试次数太多，请 10 分钟后再试' });
    const { password } = await readJsonBody(req);
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) return send(res, 400, { error: '密码至少 8 位' });
    if (a === 'setup') {
      if (auth) return send(res, 409, { error: '已经设置过密码了，请直接登录' });
      return send(res, 200, { token: await setPassword(password) });
    }
    if (!auth) return send(res, 409, { error: '还没有设置密码' });
    if (!sameBytes(scrypt(password, Buffer.from(auth.salt, 'hex')), Buffer.from(auth.hash, 'hex'))) {
      noteFail(ip);
      return send(res, 401, { error: '密码不对' });
    }
    fails.delete(ip);
    return send(res, 200, { token: tokenOf(auth) });
  }

  if (!authed(req)) return send(res, 401, { error: '请先登录' });

  if (a === 'rev' && m === 'GET') return send(res, 200, { rev: state.rev });
  if (a === 'state' && m === 'GET') return send(res, 200, { rev: state.rev, docs: Object.values(state.docs) });

  if (a === 'docs' && ID.test(id || '')) {
    const old = state.docs[id];
    if (m === 'PUT') {
      const d = await readJsonBody(req);
      if (typeof d.updated !== 'number' || !Array.isArray(d.pageIds) || !d.pageIds.every((p) => ID.test(p))) return send(res, 400, { error: '文档格式不对' });
      if (old && old.updated > d.updated) return send(res, 200, { ok: false }); // 别的设备改得更晚，以它为准
      const doc = {
        id, name: String(d.name || '扫描').slice(0, 120), created: Number(d.created) || d.updated, updated: d.updated,
        pageIds: d.pageIds, pageVers: d.pageVers && typeof d.pageVers === 'object' ? d.pageVers : {},
        cover: typeof d.cover === 'string' && d.cover.length < 400000 ? d.cover : null,
      };
      state.docs[id] = doc;
      await saveState();
      if (old?.pageIds) await removePages(old.pageIds.filter((p) => !doc.pageIds.includes(p)));
      return send(res, 200, { ok: true });
    }
    if (m === 'DELETE') {
      const updated = Number(url.searchParams.get('updated')) || Date.now();
      if (old && old.updated > updated) return send(res, 200, { ok: false });
      state.docs[id] = { id, deleted: true, updated, pageIds: [] };
      await saveState();
      if (old?.pageIds) await removePages(old.pageIds);
      return send(res, 200, { ok: true });
    }
  }

  if (a === 'pages' && ID.test(id || '') && ['meta', 'img', 'src'].includes(kind)) {
    const file = pageFile(id, kind);
    if (m === 'PUT') {
      const body = await readBody(req);
      if (kind === 'meta') JSON.parse(body.toString('utf8'));
      await writeAtomic(file, body);
      return send(res, 200, { ok: true });
    }
    if (m === 'GET') {
      let data;
      try { data = await fsp.readFile(file); } catch { return send(res, 404, { error: '没有这一页' }); }
      return send(res, 200, data, { 'Content-Type': kind === 'meta' ? 'application/json; charset=utf-8' : 'image/jpeg' });
    }
  }

  return send(res, 404, { error: '没有这个接口' });
}

/* ---------- 网页文件（白名单，数据目录不会被访问到） ---------- */

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json; charset=utf-8' };
const STATIC = /^\/(index\.html|sw\.js|manifest\.webmanifest|(css|js|icons)\/[A-Za-z0-9._-]+)$/;

// 版本号 = 所有程序文件内容的指纹。JS/CSS 通过 /v/<版本号>/... 访问，
// 每次发布地址都会变，这样 CDN（Cloudflare）和浏览器的缓存就不会让设备卡在旧版本上。
function computeVersion() {
  const hash = crypto.createHash('sha1');
  const files = ['index.html', 'sw.js'];
  for (const dir of ['css', 'js']) for (const f of fs.readdirSync(path.join(ROOT, dir)).sort()) files.push(`${dir}/${f}`);
  for (const f of files) hash.update(f).update(fs.readFileSync(path.join(ROOT, f)));
  return hash.digest('hex').slice(0, 10);
}
const VERSION = computeVersion();
const VERSIONED = /^\/v\/[0-9a-f]+(\/.*)$/;

async function serveStatic(req, res, url) {
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const versioned = VERSIONED.exec(p);
  if (versioned) p = versioned[1];
  if (!STATIC.test(p) || !TYPES[path.extname(p)]) return send(res, 404, 'Not found');
  try {
    let data = await fsp.readFile(path.join(ROOT, p));
    if (p === '/index.html') {
      data = data.toString('utf8').replace(/(href|src)="(css|js)\//g, `$1="v/${VERSION}/$2/`);
    } else if (p === '/sw.js') {
      data = data.toString('utf8').replaceAll('__VERSION__', VERSION);
    }
    send(res, 200, data, {
      'Content-Type': TYPES[path.extname(p)],
      'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
  } catch {
    send(res, 404, 'Not found');
  }
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return await serveStatic(req, res, url);
  } catch (e) {
    if (!e.code || typeof e.code !== 'number') console.error(e);
    if (!res.headersSent) send(res, typeof e.code === 'number' ? e.code : 500, { error: '服务器出错' });
  }
}).listen(PORT, HOST, () => console.log(`扫描仪服务已启动 http://${HOST}:${PORT}  数据目录 ${DATA}`));
