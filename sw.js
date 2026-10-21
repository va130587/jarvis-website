/* NOVA service worker: keeps the app's own files so NOVA opens quickly and shows its shell offline.
   Network first (you always get the newest version when online); the cache is only a fallback.
   It NEVER caches /api/ or /auth/ (your data and sign-in) and never touches other sites. */
'use strict';
const CACHE = 'nova-shell-v9';
const SHELL = ['/', '/index.html', '/design.css', '/app.css', '/nova.css', '/boot.js', '/core.js', '/app.js', '/match.js', '/jobs.js', '/ics.js', '/calendar.js', '/matches.js', '/smart.js', '/speech.js', '/voice.js', '/intents.js', '/nova.js', '/nova-daily.js', '/nova-plus.js', '/nova-focus.js', '/nova-life.js', '/nova-replay.js', '/nova-help.js', '/fonts.css', '/fonts/ibm-plex-sans-latin-400-normal.woff2', '/fonts/rajdhani-latin-600-normal.woff2', '/manifest.webmanifest', '/icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || /^\/(api|auth)\//.test(url.pathname)) return;   // the network handles these
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then(hit => hit || (e.request.mode === 'navigate' ? caches.match('/index.html') : Response.error()))));
});
