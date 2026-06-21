/* ════════════════════════════════════════════════════════════
   LinkMap — Service Worker  v202606210000
   - 웹 푸시 알림 수신 및 클릭 처리
   - 정적 파일 캐싱 (오프라인 지원)
════════════════════════════════════════════════════════════ */
const CACHE_NAME = 'linkmap-v202606210000';
const ASSETS = [
  './',
  './app.html',
  './app.js',
  './style.css',
  './icon-192.png',
  './manifest.json',
];

/* ── 설치: 정적 파일 캐시 ─── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* ── 활성화: 이전 캐시 정리 ─── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch: 동일 origin 요청만 처리 (외부 리소스 캐싱 차단) ─── */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  /* 동일 origin 아니면 무시 — 외부 API 요청은 SW 거치지 않음 */
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

/* ── Push 이벤트 수신 (서버에서 보낸 경우) ─── */
self.addEventListener('push', e => {
  let data = { title: '🔔 LinkMap 알림', body: '연락이 필요한 인맥이 있습니다.' };
  try { if (e.data) data = e.data.json(); } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    './icon-192.png',
      badge:   './icon-192.png',
      tag:     'linkmap-alert',
      vibrate: [200, 100, 200],
      data:    { url: './app.html' },
      actions: [
        { action: 'open',    title: '앱 열기' },
        { action: 'dismiss', title: '닫기'   },
      ],
    })
  );
});

/* ── 알림 클릭 처리 ─── */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  const url = (e.notification.data && e.notification.data.url) || './app.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      /* 이미 열린 탭이 있으면 포커스 */
      for (const client of list) {
        if (client.url.includes('app.html') && 'focus' in client) {
          return client.focus();
        }
      }
      /* 없으면 새 탭 열기 */
      return clients.openWindow(url);
    })
  );
});

/* ── 백그라운드 동기화 (지원 브라우저) ─── */
self.addEventListener('sync', e => {
  if (e.tag === 'check-alerts') {
    /* 실제 알림 발송은 앱 JS에서 처리 */
    e.waitUntil(Promise.resolve());
  }
});
