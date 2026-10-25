// Service worker: app shell (precache) + runtime-РєСЌС€ РјРѕРґСѓР»РµР№ Firebase СЃ CDN gstatic.
// РЈРІРµР»РёС‡РёРІР°Р№С‚Рµ CACHE_VERSION РїСЂРё РєР°Р¶РґРѕРј СЂРµР»РёР·Рµ, С‡С‚РѕР±С‹ РєР»РёРµРЅС‚С‹ РѕР±РЅРѕРІРёР»Рё РѕР±РѕР»РѕС‡РєСѓ.
const CACHE_VERSION = "v2";
const SHELL_CACHE = "fitness-shell-" + CACHE_VERSION;
const RUNTIME_CACHE = "fitness-runtime-" + CACHE_VERSION;

const SHELL = [
  "./", "index.html", "styles.css", "manifest.webmanifest", "firebase-config.js",
  "js/app.js", "js/db.js", "js/store.js", "js/metrics.js", "js/chart.js", "js/timer.js", "js/ui.js",
  "js/views/workout.js", "js/views/programs.js", "js/views/exercises.js", "js/views/progress.js",
  "js/views/history.js", "js/views/settings.js", "js/views/entryCard.js",
  "icons/icon.svg", "icons/icon-maskable.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"
];
// РћСЃРЅРѕРІРЅС‹Рµ РјРѕРґСѓР»Рё Firebase РєСЌС€РёСЂСѓРµРј СЃСЂР°Р·Сѓ (best effort), РѕСЃС‚Р°Р»СЊРЅС‹Рµ С‡Р°РЅРєРё вЂ” РїСЂРё РїРµСЂРІРѕРј РѕР±СЂР°С‰РµРЅРёРё.
const CDN = [
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL);
    const rt = await caches.open(RUNTIME_CACHE);
    await Promise.all(CDN.map(u => rt.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (![SHELL_CACHE, RUNTIME_CACHE].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request).then(res => {
    if (res && (res.ok || res.type === "opaque")) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === "navigate") {
      event.respondWith((async () => {
        // РћР±РѕР»РѕС‡РєР° РѕС‚РґР°С‘С‚СЃСЏ РёР· РєСЌС€Р° РјРіРЅРѕРІРµРЅРЅРѕ (РІР°Р¶РЅРѕ РїСЂРё РїР»РѕС…РѕР№ СЃРµС‚Рё), РѕР±РЅРѕРІР»СЏРµС‚СЃСЏ РІ С„РѕРЅРµ.
        const cache = await caches.open(SHELL_CACHE);
        const cached = (await cache.match("index.html")) || (await cache.match("./"));
        const update = fetch("index.html", { cache: "no-cache" }).then(r => { if (r.ok) cache.put("index.html", r.clone()); return r; }).catch(() => null);
        return cached || (await update) || Response.error();
      })());
      return;
    }
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
  } else if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
  }
  // Р—Р°РїСЂРѕСЃС‹ Рє firestore.googleapis.com РЅРµ С‚СЂРѕРіР°РµРј: РѕС„Р»Р°Р№РЅ РѕР±СЂР°Р±Р°С‚С‹РІР°РµС‚ СЃР°Рј Firestore SDK.
});

