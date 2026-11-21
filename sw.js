// 离线支持：有网时取最新文件并更新缓存，没网时用缓存。
// __VERSION__ 由服务端替换成当前版本号；每次发布这个文件都会变，旧缓存随之清掉。
const V = '__VERSION__';
const CACHE = `scanner-${V}`;
const FILES = [
  './', 'manifest.webmanifest',
  ...['css/tokens.css', 'css/app.css', 'js/app.js', 'js/imaging.js', 'js/db.js', 'js/pdf.js', 'js/sync.js'].map((f) => `v/${V}/${f}`),
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  // 打开页面时绕过浏览器缓存，保证拿到最新的首页（里面带着最新版本的文件地址）
  const live = req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache' }) : fetch(req);
  e.respondWith(
    live
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./'))),
  );
});
