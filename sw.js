/* 离线缓存：应用外壳缓存优先，导航请求走网络优先 + 离线兜底 */

const VERSION = 'vn-v4';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './css/cloudview.css',
  './js/app.js',
  './js/store.js',
  './js/dict.js',
  './js/ai.js',
  './js/graph.js',
  './js/ui.js',
  './js/util.js',
  './js/cluster.js',
  './js/format.js',
  './js/viewstate.js',
  './js/views.js',
  './js/entry.js',
  './js/cloudview.js',
  './js/sync.js',
  './js/demo.js',
  './assets/icon.svg',
  './assets/icon-180.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(CORE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function sameOrigin(url) {
  return new URL(url, self.location.href).origin === self.location.origin;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (!sameOrigin(req.url)) return; // 词典 API / Supabase / 音频等一律直连

  // 导航：网络优先，离线时回退到缓存的 index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || Response.error()))
    );
    return;
  }

  // 静态资源：网络优先（改了代码刷新就能生效），断网时回退到缓存
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || Response.error()))
  );
});
