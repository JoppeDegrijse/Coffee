// Coffee! – service worker: bewaart ENKEL de eigen code (html, css, js, lettertypes, iconen) op het toestel,
// zodat Coffee! snel start en als app te installeren is. Verzoeken naar Google (aanmelden, Drive, Docs)
// gaan altijd rechtstreeks naar Google en worden nooit bewaard.
// VERSIE en BESTANDEN worden bijgewerkt met tools/sw_bijwerken.py.
const VERSIE = "bb69b6bfaea0";
const BESTANDEN = ["./", "index.html", "manifest.webmanifest", "css/app.css", "js/app.js", "js/bewerken.js", "js/doelen.js", "js/evaluatie.js", "js/gegevens.js", "js/google.js", "js/huiswerk.js", "js/notities.js", "js/parser.js", "js/thema-vroeg.js", "js/todo.js", "js/weken.js", "js/vendor/jszip.min.js", "fonts/atkinson-hyperlegible-latin-400-italic.woff2", "fonts/atkinson-hyperlegible-latin-400-normal.woff2", "fonts/atkinson-hyperlegible-latin-700-normal.woff2", "fonts/bricolage-grotesque-latin-500-normal.woff2", "fonts/bricolage-grotesque-latin-700-normal.woff2", "fonts/bricolage-grotesque-latin-800-normal.woff2", "icons/apple-touch-icon.png", "icons/favicon-64.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"];
const CACHE = "coffee-" + VERSIE;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BESTANDEN)));
});

// Een nieuwe versie wacht tot je op "Vernieuwen" klikt
self.addEventListener("message", (e) => { if (e.data === "nu-bijwerken") self.skipWaiting(); });

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(sleutels => Promise.all(sleutels.filter(k => k.startsWith("coffee-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // Google & co: niet aankomen
  if (url.pathname.endsWith("/test.html")) return;
  if (req.mode === "navigate") {
    e.respondWith(caches.match("./index.html").then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});
