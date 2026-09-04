// Service worker dasar untuk AMS
// Meng-cache file statis (app shell) supaya app tetap bisa dibuka (walau offline-friendly ala kadarnya)
// Data absensi tetap live via fetch ke Apps Script backend, TIDAK di-cache di sini.

const CACHE_NAME = 'ams-shell-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: bersihkan cache versi lama
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch strategy:
// - Request ke Apps Script (/exec, script.google.com) SELALU network-only (jangan di-cache, data live)
// - Request ke file statis app shell: cache-first, fallback ke network
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  const isBackendCall =
    url.includes('script.google.com') || url.includes('/exec');

  if (isBackendCall) {
    // Selalu ambil dari network untuk data absensi (tidak boleh basi/cache)
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).then((response) => {
          // Simpan salinan baru ke cache untuk file statis
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
      );
    })
  );
});
