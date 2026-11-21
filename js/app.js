import * as I from './imaging.js';
import * as DB from './db.js';
import { buildPdf } from './pdf.js';
import * as Sync from './sync.js';

/* ---------- 小工具 ---------- */

const ICONS = {
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  share: '<path d="M12 2v13"/><path d="m16 6-4-4-4 4"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
};

function icon(name, size = 20, stroke = 1.75) {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return t.content.firstChild;
}

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter((k) => k != null && k !== false));
  return el;
}

const btn = (label, ico, onclick, cls = '') => h('button', { class: `btn ${cls}`, onclick }, ico && icon(ico, 18), label);
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (t) => { const d = new Date(t); return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtSize = (b) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);
const defaultName = () => { const d = new Date(); return `扫描 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`; };
const safeName = (s) => s.replace(/[\\/:*?"<>|]/g, '_').trim() || '扫描';
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function toast(msg, type = '') {
  const el = h('div', { class: `toast ${type && `toast-${type}`}` }, msg);
  document.getElementById('toasts').append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 2400);
}

let busyEl;
function busy(text) {
  busyEl?.remove();
  busyEl = null;
  if (text) {
    busyEl = h('div', { class: 'busy' }, h('div', { class: 'busy-card' }, h('div', { class: 'spinner' }), text));
    document.body.append(busyEl);
  }
}

/** 通用弹窗。actions: [{ label, cls, value }]；点遮罩或 Esc 返回 null。 */
function modal({ title, iconName, danger, body, actions }) {
  return new Promise((resolve) => {
    const done = (v) => { document.removeEventListener('keydown', onKey); overlay.remove(); resolve(v); };
    const onKey = (e) => {
      if (e.key === 'Escape') done(null);
      if (e.key === 'Enter') { const p = actions.find((a) => a.primary); if (p) fire(p); }
    };
    const fire = (a) => (a.onclick ? a.onclick(done) : done(a.value));
    const overlay = h('div', { class: 'modal-overlay', onclick: (e) => e.target === overlay && done(null) },
      h('div', { class: 'modal' },
        iconName && h('div', { class: `modal-icon ${danger ? 'danger' : ''}` }, icon(iconName, 22)),
        h('div', { class: 'modal-header' }, title),
        h('div', { class: 'modal-body' }, body),
        h('div', { class: 'modal-footer' }, actions.map((a) => h('button', { class: `btn ${a.cls || ''}`, onclick: () => fire(a) }, a.label)))));
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
  });
}

const confirmBox = (title, msg, okLabel) => modal({
  title, iconName: 'trash', danger: true,
  body: h('div', { class: 'modal-msg' }, msg),
  actions: [{ label: '取消', value: false }, { label: okLabel, cls: 'btn-red', value: true, primary: true }],
});

async function promptBox(title, value) {
  const input = h('input', { class: 'input', value, maxlength: 80 });
  setTimeout(() => { input.focus(); input.select(); }, 60);
  const ok = await modal({
    title, body: input,
    actions: [{ label: '取消', value: false }, { label: '好', cls: 'btn-primary', value: true, primary: true }],
  });
  return ok ? input.value.trim() : null;
}

/* ---------- 导出与分享 ---------- */

function download(file) {
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const canShare = (files) => !!navigator.canShare && navigator.canShare({ files });

function share(files) {
  navigator.share({ files }).catch((e) => { if (e.name !== 'AbortError') toast('分享失败，请改用下载', 'error'); });
}

async function exportPdf(doc) {
  busy('正在生成 PDF…');
  let file, count;
  try {
    await nextFrame();
    const pages = await DB.getPages(doc.pageIds);
    const items = [];
    for (const p of pages) items.push({ bytes: new Uint8Array(await p.img.arrayBuffer()), w: p.w, h: p.h });
    file = new File([buildPdf(items)], `${safeName(doc.name)}.pdf`, { type: 'application/pdf' });
    count = pages.length;
  } catch (e) {
    console.error(e);
    toast('生成 PDF 失败', 'error');
    return;
  } finally {
    busy(false);
  }
  // 分享必须由一次点击直接触发，所以生成完再让用户点按钮
  const sharable = canShare([file]);
  await modal({
    title: 'PDF 已生成',
    body: h('div', { class: 'file-row' },
      h('div', { class: 'app-ico' }, icon('file', 20)),
      h('div', {}, h('div', { class: 'fname' }, file.name), h('div', { class: 'finfo' }, `${count} 页 · ${fmtSize(file.size)}`))),
    actions: sharable
      ? [{ label: '下载', onclick: (done) => { download(file); done(); } }, { label: '分享或存储…', cls: 'btn-primary', onclick: (done) => { share([file]); done(); } }]
      : [{ label: '关闭', value: null }, { label: '下载', cls: 'btn-primary', onclick: (done) => { download(file); done(); } }],
  });
}

/* ---------- 编辑器：裁剪 → 调整 ---------- */

/**
 * 打开编辑器。返回 { img, thumb, w, h, corners, filter, rot }，取消则返回 null。
 * src 是原图 canvas；corners/filter/rot 用于重新编辑已有页面。
 */
function openEditor({ src, corners, filter, rot, label = '' }) {
  return new Promise((resolve) => {
    const detected = corners ? null : I.detectCorners(src);
    const st = {
      corners: (corners || detected || I.defaultCorners()).map((c) => ({ ...c })),
      filter: filter || localStorage.getItem('filter') || 'enhance',
      rot: rot || 0,
      base: null, // 矫正并旋转后的图
      out: null, // 套完滤镜的成品
    };

    const top = h('div', { class: 'ed-top' });
    const stage = h('div', { class: 'ed-stage' });
    const bottom = h('div', { class: 'ed-bottom' });
    const el = h('div', { class: 'editor' }, top, stage, bottom);
    document.body.append(el);

    let relayout = () => {};
    const onResize = () => relayout();
    window.addEventListener('resize', onResize);
    const finish = (v) => { window.removeEventListener('resize', onResize); el.remove(); resolve(v); };
    const setTop = (left, title, right) => top.replaceChildren(
      h('div', { class: 'ed-side' }, left), h('div', { class: 'ed-title' }, title), h('div', { class: 'ed-side right' }, right));

    /* 第一步：拖动四角 */
    function showCrop() {
      const preview = I.scaled(src, 1600);
      const box = h('div', { class: 'crop-box' }, preview);
      box.insertAdjacentHTML('beforeend',
        `<svg><path class="crop-mask"/><polygon class="crop-line"/>${[0, 1, 2, 3].map((i) => `<g class="crop-handle" data-i="${i}"><circle class="hit" r="30"/><circle class="dot" r="11"/></g>`).join('')}</svg>`);
      const loupe = h('canvas', { class: 'loupe', width: 248, height: 248 });
      box.append(loupe);
      const svg = box.querySelector('svg');
      const mask = svg.querySelector('.crop-mask'), line = svg.querySelector('.crop-line');
      const handles = [...svg.querySelectorAll('.crop-handle')];
      let bw = 1, bh = 1;

      const draw = () => {
        const P = st.corners.map((c) => [c.x * bw, c.y * bh]);
        mask.setAttribute('d', `M0 0H${bw}V${bh}H0Z M${P.map((p) => p.join(' ')).join(' L')} Z`);
        line.setAttribute('points', P.map((p) => p.join(',')).join(' '));
        handles.forEach((g, i) => g.setAttribute('transform', `translate(${P[i][0]} ${P[i][1]})`));
      };
      relayout = () => {
        const r = stage.getBoundingClientRect(), m = 34;
        const k = Math.min((r.width - 2 * m) / src.width, (r.height - 2 * m) / src.height);
        bw = src.width * k; bh = src.height * k;
        Object.assign(box.style, { left: `${(r.width - bw) / 2}px`, top: `${(r.height - bh) / 2}px`, width: `${bw}px`, height: `${bh}px` });
        svg.setAttribute('viewBox', `0 0 ${bw} ${bh}`);
        draw();
      };

      const drawLoupe = (c) => {
        const g = loupe.getContext('2d');
        const rad = Math.max(src.width, src.height) * 0.035;
        g.fillStyle = '#000';
        g.fillRect(0, 0, 248, 248);
        g.drawImage(src, c.x * src.width - rad, c.y * src.height - rad, rad * 2, rad * 2, 0, 0, 248, 248);
        g.strokeStyle = '#0a84ff';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(124, 96); g.lineTo(124, 152); g.moveTo(96, 124); g.lineTo(152, 124);
        g.stroke();
        const px = c.x * bw, py = c.y * bh;
        const above = box.offsetTop + py - 160 > 0;
        Object.assign(loupe.style, { display: 'block', left: `${px - 62}px`, top: `${above ? py - 160 : py + 44}px` });
      };

      handles.forEach((g, i) => {
        let off = null;
        g.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          try { g.setPointerCapture(e.pointerId); } catch { /* 个别浏览器不支持，忽略 */ }
          const r = box.getBoundingClientRect();
          off = { x: e.clientX - r.left - st.corners[i].x * bw, y: e.clientY - r.top - st.corners[i].y * bh };
          g.classList.add('drag');
          drawLoupe(st.corners[i]);
        });
        g.addEventListener('pointermove', (e) => {
          if (!off) return;
          const r = box.getBoundingClientRect();
          st.corners[i] = {
            x: Math.min(1, Math.max(0, (e.clientX - r.left - off.x) / bw)),
            y: Math.min(1, Math.max(0, (e.clientY - r.top - off.y) / bh)),
          };
          draw();
          drawLoupe(st.corners[i]);
        });
        const end = () => { off = null; g.classList.remove('drag'); loupe.style.display = 'none'; };
        g.addEventListener('pointerup', end);
        g.addEventListener('pointercancel', end);
      });

      setTop(btn('取消', null, () => finish(null), 'btn-sm'), `调整边缘${label && ` · ${label}`}`, null);
      stage.replaceChildren(box);
      bottom.replaceChildren(
        btn('自动识别', 'scan', () => {
          const c = I.detectCorners(src);
          if (c) { st.corners = c; draw(); } else toast('没认出纸张边缘，请手动拖动四角');
        }),
        btn('整张图', 'crop', () => { st.corners = I.fullCorners(); draw(); }),
        btn('下一步', null, goAdjust, 'btn-primary'));
      relayout();
      if (!corners && !detected) toast('没认出纸张边缘，请手动拖动四角');
    }

    async function goAdjust() {
      busy('正在拉平…');
      await nextFrame();
      try {
        let c = I.warp(src, st.corners);
        for (let i = 0; i < st.rot; i++) c = I.rotate90(c);
        st.base = c;
        st.out = I.applyFilter(st.base, st.filter);
      } catch (e) {
        console.error(e);
        busy(false);
        toast('处理失败，图片可能太大', 'error');
        return;
      }
      busy(false);
      showAdjust();
    }

    /* 第二步：滤镜与旋转 */
    function showAdjust() {
      relayout = () => {};
      const show = () => { st.out.className = 'result-img'; stage.replaceChildren(st.out); };
      const refilter = async () => {
        busy('处理中…');
        await nextFrame();
        st.out = I.applyFilter(st.base, st.filter);
        busy(false);
        show();
      };
      const seg = h('div', { class: 'seg' }, I.FILTERS.map((f) => h('button', {
        class: f.id === st.filter ? 'active' : '',
        onclick: (e) => {
          if (st.filter === f.id) return;
          st.filter = f.id;
          localStorage.setItem('filter', f.id);
          seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.currentTarget));
          refilter();
        },
      }, f.name)));

      setTop(btn('返回', 'back', showCrop, 'btn-sm'), `调整效果${label && ` · ${label}`}`, null);
      bottom.replaceChildren(
        seg,
        h('button', { class: 'icon-btn', title: '旋转', 'aria-label': '旋转', onclick: () => { st.base = I.rotate90(st.base); st.rot = (st.rot + 1) % 4; refilter(); } }, icon('rotate')),
        btn('保存', null, save, 'btn-primary'));
      show();
    }

    async function save() {
      busy('正在保存…');
      await nextFrame();
      try {
        const img = await I.toBlob(st.out, 0.85);
        finish({ img, thumb: I.thumb(st.out), w: st.out.width, h: st.out.height, corners: st.corners, filter: st.filter, rot: st.rot });
      } catch (e) {
        console.error(e);
        toast('保存失败', 'error');
      } finally {
        busy(false);
      }
    }

    showCrop();
  });
}

/* ---------- 新增页面 ---------- */

async function refreshCover(doc) {
  const first = doc.pageIds.length ? await DB.getPage(doc.pageIds[0]) : null;
  doc.cover = first?.thumb || null;
  doc.updated = Date.now();
  await DB.putDoc(doc);
}

/** 把一页存进文档（doc 为空则新建文档），返回文档。 */
async function appendPage(doc, src, res) {
  const page = { id: DB.newId(), ...res, src: await I.toBlob(src, 0.9), ver: Date.now() };
  doc ??= { id: DB.newId(), name: defaultName(), created: Date.now(), updated: Date.now(), pageIds: [], cover: null };
  page.docId = doc.id;
  await DB.putPage(page);
  doc.pageIds.push(page.id);
  (doc.pageVers ??= {})[page.id] = page.ver;
  await refreshCover(doc);
  return doc;
}

/** 不经过编辑器，直接按给定四角和滤镜出成品（实时相机用）。 */
async function renderPage(src, corners, filter) {
  const out = I.applyFilter(I.warp(src, corners), filter);
  return { img: await I.toBlob(out, 0.85), thumb: I.thumb(out), w: out.width, h: out.height, corners, filter, rot: 0 };
}

/* ---------- 实时相机：预览中识别边缘，稳定后自动拍 ---------- */

async function openCamera(docId) {
  const fallback = (msg) => modal({
    title: '用不了实时相机', iconName: 'camera',
    body: h('div', { class: 'modal-msg' }, msg),
    actions: [{ label: '取消', value: null }, { label: '用系统相机', cls: 'btn-primary', primary: true, onclick: (done) => { done(); pick('camera', docId); } }],
  });
  if (!navigator.mediaDevices?.getUserMedia) return fallback('这个浏览器不支持在网页里打开摄像头。可以改用系统相机拍照，拍完再识别边缘。');

  const getStream = () => navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
  });
  let stream;
  busy('正在打开相机…');
  try {
    stream = await getStream();
  } catch (e) {
    console.warn(e);
    busy(false);
    return fallback(e.name === 'NotAllowedError'
      ? '没有相机权限。请在系统设置里允许这个网站使用相机，或者先改用系统相机拍照。'
      : '没找到可用的摄像头。可以改用系统相机拍照，或从相册导入。');
  }
  busy(false);

  let doc = docId ? await DB.getDoc(docId) : null;
  let added = 0, closed = false, capturing = false;
  let auto = localStorage.getItem('cam-auto') !== '0';
  let quad = null, stable = 0, miss = 0, armed = true;

  const video = h('video', { playsinline: true, muted: true, autoplay: true });
  video.muted = true;
  video.srcObject = stream;
  const box = h('div', { class: 'cam-box' }, video);
  box.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 1 1" preserveAspectRatio="none"><polygon class="cam-quad" vector-effect="non-scaling-stroke"/></svg>');
  const poly = box.querySelector('polygon');
  const stage = h('div', { class: 'ed-stage' }, box);
  const hint = h('div', { class: 'ed-title' });
  const closeBtn = btn('取消', null, () => close(), 'btn-sm');
  const autoBtn = h('button', { class: `chip ${auto ? 'active' : ''}`, onclick: () => {
    auto = !auto;
    localStorage.setItem('cam-auto', auto ? '1' : '0');
    autoBtn.classList.toggle('active', auto);
    stable = 0;
    draw();
  } }, '自动拍摄');
  const last = h('button', { class: 'cam-last', 'aria-label': '完成', onclick: () => close() }, h('span', { class: 'page-no' }, '0'));
  last.style.visibility = 'hidden';
  const el = h('div', { class: 'editor camera' },
    h('div', { class: 'ed-top' },
      h('div', { class: 'ed-side' }, closeBtn), hint,
      h('div', { class: 'ed-side right' }, btn('系统相机', null, () => { close(true); pick('camera', doc?.id ?? docId); }, 'btn-sm'))),
    stage,
    h('div', { class: 'ed-bottom' },
      h('div', { class: 'cam-side' }, autoBtn),
      h('button', { class: 'shutter', 'aria-label': '拍摄', onclick: () => shoot() }),
      h('div', { class: 'cam-side' }, last)));
  document.body.append(el);

  const layout = () => {
    if (!video.videoWidth) return;
    const r = stage.getBoundingClientRect(), m = 8;
    const k = Math.min((r.width - 2 * m) / video.videoWidth, (r.height - 2 * m) / video.videoHeight);
    const w = video.videoWidth * k, hh = video.videoHeight * k;
    Object.assign(box.style, { left: `${(r.width - w) / 2}px`, top: `${(r.height - hh) / 2}px`, width: `${w}px`, height: `${hh}px` });
  };
  video.addEventListener('loadedmetadata', layout);
  video.addEventListener('resize', layout);
  window.addEventListener('resize', layout);

  // 切到后台再回来时，系统可能已经把摄像头停了，重新打开
  const onVisible = async () => {
    if (document.hidden || closed || stream.getVideoTracks()[0]?.readyState === 'live') return;
    try { stream = await getStream(); video.srcObject = stream; } catch { close(); }
  };
  document.addEventListener('visibilitychange', onVisible);

  function draw() {
    poly.setAttribute('points', quad ? quad.map((p) => `${p.x},${p.y}`).join(' ') : '');
    poly.classList.toggle('steady', !!quad && auto && armed && stable >= 3);
    hint.textContent = !quad ? '把文件放进画面'
      : !armed ? '已拍下，请换下一页'
      : auto ? '保持不动…' : '点快门拍摄';
  }

  const small = I.makeCanvas(2, 2);
  const sg = small.getContext('2d', { willReadFrequently: true });
  // 画面"指纹"：缩小后的灰度图，用来判断拍完之后内容有没有换
  let shotSig = null;
  const signature = () => {
    const d = sg.getImageData(0, 0, small.width, small.height).data;
    const g = new Uint8Array(d.length >> 2);
    for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
    return g;
  };
  const changedSince = (old) => {
    if (!old) return false;
    const now = signature();
    if (now.length !== old.length) return true;
    let n = 0;
    for (let i = 0; i < now.length; i++) if (Math.abs(now[i] - old[i]) > 35) n++;
    return n > now.length * 0.025;
  };
  function tick() {
    if (closed) return;
    if (!capturing && !document.hidden && video.readyState >= 2 && video.videoWidth) {
      const k = 220 / Math.max(video.videoWidth, video.videoHeight);
      small.width = Math.round(video.videoWidth * k);
      small.height = Math.round(video.videoHeight * k);
      sg.drawImage(video, 0, 0, small.width, small.height);
      const c = I.detectCorners(small);
      if (!armed && changedSince(shotSig)) armed = true; // 纸上的内容变了：换了一页
      if (c) {
        const move = quad ? Math.max(...c.map((p, i) => Math.hypot(p.x - quad[i].x, p.y - quad[i].y))) : 1;
        if (!armed && move > 0.12) armed = true; // 画面明显变了：换了一页
        quad = quad && move < 0.08 ? quad.map((q, i) => ({ x: q.x + (c[i].x - q.x) * 0.5, y: q.y + (c[i].y - q.y) * 0.5 })) : c;
        stable = move < 0.02 ? stable + 1 : 0;
        miss = 0;
      } else if (++miss > 3) {
        quad = null;
        stable = 0;
        armed = true;
      }
      draw();
      if (auto && armed && quad && stable >= 8) shoot();
    }
    setTimeout(tick, 110);
  }

  async function shoot() {
    if (capturing || closed || !video.videoWidth) return;
    capturing = true;
    const frame = I.makeCanvas(video.videoWidth, video.videoHeight);
    frame.getContext('2d').drawImage(video, 0, 0);
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    try {
      await nextFrame();
      const corners = I.detectCorners(frame) || quad; // 在拍下的清晰画面上再精确识别一次
      const res = corners
        ? await renderPage(frame, corners, localStorage.getItem('filter') || 'enhance')
        : await openEditor({ src: frame }); // 没认出边缘：手动拖四角
      if (res) {
        doc = await appendPage(doc, frame, res);
        added++;
        last.style.visibility = '';
        last.style.backgroundImage = `url(${res.thumb})`;
        last.firstChild.textContent = String(added);
        closeBtn.lastChild.textContent = '完成';
        armed = false;
        stable = 0;
        sg.drawImage(video, 0, 0, small.width, small.height);
        shotSig = signature();
        draw();
      }
    } catch (e) {
      console.error(e);
      toast('保存失败', 'error');
    } finally {
      capturing = false;
    }
  }

  function close(silent) {
    if (closed) return;
    closed = true;
    stream.getTracks().forEach((t) => t.stop());
    window.removeEventListener('resize', layout);
    document.removeEventListener('visibilitychange', onVisible);
    el.remove();
    if (added && !silent) toast(`已添加 ${added} 页`, 'success');
    if (doc) showDoc(doc.id); else showHome();
  }

  draw();
  tick();
}

async function addFiles(files, docId) {
  let doc = docId ? await DB.getDoc(docId) : null;
  let added = 0;
  for (let i = 0; i < files.length; i++) {
    let src;
    busy('正在读取图片…');
    try {
      await nextFrame();
      src = await I.loadToCanvas(files[i]);
    } catch (e) {
      console.error(e);
      toast('这张图片读不了，已跳过', 'error');
      continue;
    } finally {
      busy(false);
    }
    const res = await openEditor({ src, label: files.length > 1 ? `${i + 1} / ${files.length}` : '' });
    if (!res) break;
    try {
      doc = await appendPage(doc, src, res);
      added++;
    } catch (e) {
      console.error(e);
      toast('保存失败，可能是存储空间不足', 'error');
      break;
    }
  }
  if (added) toast(added > 1 ? `已添加 ${added} 页` : '已保存', 'success');
  if (doc) showDoc(doc.id); else showHome();
}

let pendingDocId = null;
function pick(kind, docId) {
  pendingDocId = docId;
  document.getElementById(kind === 'camera' ? 'pick-camera' : 'pick-album').click();
}
for (const id of ['pick-camera', 'pick-album']) {
  const input = document.getElementById(id);
  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    if (files.length) addFiles(files, pendingDocId);
  });
}

/* ---------- 页面查看器 ---------- */

function openViewer(doc, pages, start) {
  let idx = start, url = null;
  const img = h('img', { class: 'result-img', alt: '' });
  const title = h('div', { class: 'ed-title' });
  const stage = h('div', { class: 'ed-stage' });
  const tools = {};
  const tool = (key, label, ico, onclick, cls = '') => (tools[key] = h('button', { class: `tool ${cls}`, onclick }, icon(ico, 22), label));
  const close = () => { URL.revokeObjectURL(url); el.remove(); showDoc(doc.id); };

  const render = () => {
    URL.revokeObjectURL(url);
    url = URL.createObjectURL(pages[idx].img);
    img.src = url;
    title.textContent = `${idx + 1} / ${pages.length}`;
    prev.style.visibility = idx > 0 ? '' : 'hidden';
    next.style.visibility = idx < pages.length - 1 ? '' : 'hidden';
    tools.left.disabled = idx === 0;
    tools.right.disabled = idx === pages.length - 1;
  };
  const move = async (dir) => {
    const j = idx + dir;
    [pages[idx], pages[j]] = [pages[j], pages[idx]];
    doc.pageIds = pages.map((p) => p.id);
    await refreshCover(doc);
    idx = j;
    render();
    toast(`已移到第 ${idx + 1} 页`);
  };
  const edit = async () => {
    const page = pages[idx];
    busy('正在读取图片…');
    let src;
    try {
      await nextFrame();
      if (!page.src) { // 这一页是从别的设备同步来的，原图按需下载
        page.src = await Sync.fetchSrc(page.id);
        await DB.putPage(page);
      }
      src = await I.loadToCanvas(page.src);
    } catch (e) {
      console.error(e);
      toast('原图取不到，请联网后再试', 'error');
      return;
    } finally {
      busy(false);
    }
    const res = await openEditor({ src, corners: page.corners, filter: page.filter, rot: page.rot });
    if (!res) return;
    Object.assign(page, res, { ver: Date.now() });
    await DB.putPage(page);
    (doc.pageVers ??= {})[page.id] = page.ver;
    await refreshCover(doc);
    render();
    toast('已更新', 'success');
  };
  const remove = async () => {
    if (!(await confirmBox('删除这一页？', '删除后无法恢复。', '删除'))) return;
    const [page] = pages.splice(idx, 1);
    await DB.deletePage(page.id);
    doc.pageIds = pages.map((p) => p.id);
    if (doc.pageVers) delete doc.pageVers[page.id];
    if (!pages.length) {
      await DB.deleteDoc(doc);
      URL.revokeObjectURL(url);
      el.remove();
      showHome();
      return;
    }
    await refreshCover(doc);
    idx = Math.min(idx, pages.length - 1);
    render();
  };
  const sharePage = () => {
    const file = new File([pages[idx].img], `${safeName(doc.name)}-${idx + 1}.jpg`, { type: 'image/jpeg' });
    if (canShare([file])) share([file]); else download(file);
  };

  const prev = h('button', { class: 'icon-btn nav-arrow prev', 'aria-label': '上一页', onclick: () => { idx--; render(); } }, icon('back'));
  const next = h('button', { class: 'icon-btn nav-arrow next', 'aria-label': '下一页', onclick: () => { idx++; render(); } }, icon('next'));
  stage.append(img, prev, next);
  const el = h('div', { class: 'editor' },
    h('div', { class: 'ed-top' },
      h('div', { class: 'ed-side' }, btn('完成', null, close, 'btn-sm')), title, h('div', { class: 'ed-side right' })),
    stage,
    h('div', { class: 'ed-bottom' },
      tool('edit', '重新编辑', 'crop', edit),
      tool('left', '前移', 'back', () => move(-1)),
      tool('right', '后移', 'next', () => move(1)),
      tool('share', '分享', 'share', sharePage),
      tool('del', '删除', 'trash', remove, 'danger')));
  document.body.append(el);
  render();
}

/* ---------- 页面 ---------- */

const $app = document.getElementById('app');
let current = { view: 'home' };
let quiet = false; // 同步引起的刷新：不播进场动画、保持滚动位置
function mount(view) {
  if (quiet) {
    const top = $app.firstElementChild?.scrollTop || 0;
    view.style.animation = 'none';
    $app.replaceChildren(view);
    view.scrollTop = top;
  } else {
    $app.replaceChildren(view);
  }
}

/** 别的设备的改动同步下来后刷新当前页面；正在编辑或有弹窗时等它结束。 */
async function refresh() {
  if (document.querySelector('.editor, .modal-overlay, .busy')) { setTimeout(refresh, 1000); return; }
  quiet = true;
  try { await (current.view === 'doc' ? showDoc(current.id) : showHome()); } finally { quiet = false; }
}

/* ---------- 同步界面 ---------- */

const SYNC_TEXT = { off: '未开启', syncing: '正在同步…', ok: '已同步', offline: '没有网络，联网后会自动同步', error: '同步出错，稍后会自动重试' };

function syncButton() {
  if (Sync.state.status === 'none') return null;
  return h('button', { class: 'round-btn sync-btn', 'aria-label': '多设备同步', 'data-status': Sync.state.status, onclick: syncDialog }, icon('cloud', 20), h('i', { class: 'sync-dot' }));
}
Sync.onStatus((s) => document.querySelectorAll('.sync-btn').forEach((b) => { b.dataset.status = s.status; }));

function syncHint() {
  if (Sync.state.status !== 'off' || localStorage.getItem('sync-hint-off')) return null;
  const el = h('div', { class: 'hint' },
    h('div', { class: 'grow' }, h('b', {}, '多设备同步'), '：开启后，手机上扫描的文档会自动出现在电脑和 iPad 上。'),
    h('button', { class: 'btn btn-sm', onclick: () => { localStorage.setItem('sync-hint-off', '1'); el.remove(); } }, '不用'),
    h('button', { class: 'btn btn-sm btn-primary', onclick: syncDialog }, '开启'));
  return el;
}

async function syncDialog() {
  if (Sync.loggedIn()) {
    const s = Sync.state;
    const when = s.status === 'ok' && s.lastSync ? ` · ${fmtDate(s.lastSync)}` : '';
    await modal({
      title: '多设备同步', iconName: 'cloud',
      body: h('div', { class: 'modal-msg' }, `${SYNC_TEXT[s.status] || ''}${when}\n在其他设备上打开同一个网址，输入同步密码即可看到这里的文档。`),
      actions: [
        { label: '退出登录', cls: 'btn-danger', onclick: (done) => { Sync.logout(); done(); toast('已退出，文档仍保留在本机'); refresh(); } },
        { label: '立即同步', cls: 'btn-primary', primary: true, onclick: (done) => { Sync.syncNow(); done(); } },
      ],
    });
    return;
  }
  const setup = !Sync.state.setup;
  const pw = h('input', { class: 'input', type: 'password', placeholder: setup ? '设置同步密码（至少 8 位）' : '同步密码', autocomplete: setup ? 'new-password' : 'current-password' });
  const pw2 = setup && h('input', { class: 'input', type: 'password', placeholder: '再输入一次', autocomplete: 'new-password' });
  const err = h('div', { class: 'form-err' });
  setTimeout(() => pw.focus(), 60);
  await modal({
    title: setup ? '开启多设备同步' : '登录同步', iconName: 'cloud',
    body: h('div', { class: 'form' },
      h('div', { class: 'modal-msg' }, setup
        ? '先设置一个同步密码。之后在手机、iPad、电脑上打开这个网址，输入同一个密码，文档就会自动互相同步。'
        : '输入同步密码，这台设备上的文档会和其他设备自动同步。'),
      pw, pw2, err),
    actions: [
      { label: '取消', value: null },
      {
        label: setup ? '开启' : '登录', cls: 'btn-primary', primary: true,
        onclick: async (done) => {
          if (pw.value.length < 8) { err.textContent = '密码至少 8 位'; return; }
          if (setup && pw.value !== pw2.value) { err.textContent = '两次输入的密码不一样'; return; }
          busy('正在连接…');
          try {
            await Sync.login(pw.value);
            done();
            toast('同步已开启', 'success');
          } catch (e) {
            err.textContent = e.message || '连接失败';
          } finally {
            busy(false);
          }
          if (Sync.loggedIn()) refresh();
        },
      },
    ],
  });
}
const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function installHint() {
  if (standalone || !isIOS || localStorage.getItem('hint-off')) return null;
  const el = h('div', { class: 'hint' },
    h('div', { class: 'grow' }, '想像 App 一样使用：点 Safari 的', h('b', {}, ' 分享 '), '按钮，选', h('b', {}, ' 添加到主屏幕'), '。之后从主屏幕图标打开，离线也能用。'),
    h('button', { class: 'btn btn-sm', onclick: () => { localStorage.setItem('hint-off', '1'); el.remove(); } }, '知道了'));
  return el;
}

async function showHome() {
  current = { view: 'home' };
  const docs = await DB.listDocs();
  mount(h('div', { class: 'view' }, h('div', { class: 'page' },
    h('header', { class: 'home-head' },
      h('div', {},
        h('h1', { class: 'big-title' }, '扫描仪'),
        h('p', { class: 'sub' }, docs.length ? `${docs.length} 个文档，全部保存在这台设备上` : '拍一张照片，把纸质文件变成清晰的 PDF')),
      h('div', { class: 'head-actions' },
        syncButton(),
        btn('导入图片', 'image', () => pick('album', null)),
        btn('拍照扫描', 'camera', () => openCamera(null), 'btn-primary'))),
    installHint(),
    syncHint(),
    docs.length ? docList(docs) : h('div', { class: 'empty' }, icon('scan', 38, 1.4), '还没有文档。点“拍照扫描”开始。'))));
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
function dayLabel(day) {
  const diff = Math.round((dayStart(Date.now()) - day) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  const d = new Date(day);
  const year = d.getFullYear() === new Date().getFullYear() ? '' : `${d.getFullYear()}年`;
  return `${year}${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`;
}
const fmtTime = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** 首页文档列表：按扫描日期分组（像相册），每个文档带序号（按扫描先后，数字越大越新）。 */
function docList(docs) {
  const order = localStorage.getItem('sort') === 'old' ? 'old' : 'new';
  const byTime = [...docs].sort((a, b) => a.created - b.created);
  const no = new Map(byTime.map((d, i) => [d.id, i + 1]));
  const newestId = byTime.at(-1).id;
  const list = order === 'new' ? byTime.reverse() : byTime;

  const groups = [];
  for (const d of list) {
    const day = dayStart(d.created);
    if (groups.at(-1)?.day !== day) groups.push({ day, docs: [] });
    groups.at(-1).docs.push(d);
  }

  const sortBtn = (id, label) => h('button', {
    class: order === id ? 'active' : '',
    onclick: () => { if (order !== id) { localStorage.setItem('sort', id); refresh(); } },
  }, label);

  return h('div', {},
    h('div', { class: 'list-bar' }, h('div', { class: 'seg' }, sortBtn('new', '最新在前'), sortBtn('old', '最早在前'))),
    groups.map((g) => h('section', {},
      h('div', { class: 'day-head' },
        h('h2', { class: 'day-title' }, dayLabel(g.day)),
        h('span', { class: 'day-count' }, `${g.docs.length} 个文档`)),
      h('div', { class: 'grid' }, g.docs.map((d) => h('button', { class: 'doc-card page-card', onclick: () => showDoc(d.id) },
        h('div', { class: 'doc-thumb' }, d.cover && h('img', { src: d.cover, alt: '' })),
        h('div', { class: 'page-no' }, String(no.get(d.id))),
        h('div', { class: 'doc-meta' },
          h('div', { class: 'doc-name-row' },
            h('div', { class: 'doc-name' }, d.name),
            d.id === newestId && docs.length > 1 && h('span', { class: 'tag-new' }, '最新')),
          h('div', { class: 'doc-info' }, `${fmtTime(d.created)} · ${d.pageIds.length} 页`))))))));
}

async function showDoc(id) {
  const doc = await DB.getDoc(id);
  if (!doc) return showHome();
  current = { view: 'doc', id };
  const pages = await DB.getPages(doc.pageIds);

  const rename = async () => {
    const name = await promptBox('重命名', doc.name);
    if (!name || name === doc.name) return;
    doc.name = name;
    doc.updated = Date.now();
    await DB.putDoc(doc);
    showDoc(id);
  };
  const remove = async () => {
    if (!(await confirmBox('删除这个文档？', `“${doc.name}”的 ${pages.length} 页都会被删除，无法恢复。`, '删除'))) return;
    await DB.deleteDoc(doc);
    toast('已删除');
    showHome();
  };

  mount(h('div', { class: 'view' }, h('div', { class: 'page' },
    h('header', { class: 'doc-head' },
      h('button', { class: 'round-btn', 'aria-label': '返回', onclick: showHome }, icon('back')),
      h('button', { class: 'doc-title', onclick: rename },
        h('div', { class: 'name' }, h('span', {}, doc.name), icon('pencil', 16)),
        h('div', { class: 'info' }, `${pages.length} 页 · ${fmtDate(doc.updated)}`)),
      h('button', { class: 'round-btn', 'aria-label': '删除文档', onclick: remove }, icon('trash', 19)),
      btn('导出 PDF', 'share', () => exportPdf(doc), 'btn-primary')),
    h('div', { class: 'grid' },
      pages.map((p, i) => h('button', { class: 'doc-card page-card', onclick: () => openViewer(doc, pages, i) },
        h('div', { class: 'doc-thumb' }, h('img', { src: p.thumb, alt: `第 ${i + 1} 页` })),
        h('div', { class: 'page-no' }, String(i + 1)))),
      h('button', { class: 'add-card', onclick: () => openCamera(id) }, icon('camera', 26, 1.5), '拍照加一页'),
      h('button', { class: 'add-card', onclick: () => pick('album', id) }, icon('image', 26, 1.5), '从相册添加')))));
}

/* ---------- 启动 ---------- */

const dark = matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => { document.documentElement.dataset.theme = dark.matches ? 'dark' : 'light'; };
applyTheme();
dark.addEventListener('change', applyTheme);

navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator && window.isSecureContext) {
  // 版本号取自本文件的地址（/v/<版本号>/js/app.js）。带上它注册，发布新版后各设备会自动换成新版
  const ver = /\/v\/([0-9a-f]+)\//.exec(import.meta.url)?.[1] || 'dev';
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register(`sw.js?v=${ver}`).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !document.querySelector('.editor, .modal-overlay, .busy')) location.reload();
  });
}

Sync.setOnPulled(refresh);
Sync.init().then(refresh);

window.app = { addFiles, showHome, showDoc, openCamera };
showHome().catch((e) => {
  console.error(e);
  mount(h('div', { class: 'empty' }, '无法打开本地存储。请关闭无痕浏览后重试。'));
});
