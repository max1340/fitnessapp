// Service worker: app shell (precache) + runtime-кэш модулей Firebase с CDN gstatic.
// Увеличивайте CACHE_VERSION при каждом релизе, чтобы клиенты обновили оболочку.
const CACHE_VERSION = "v16";
const SHELL_CACHE = "fitness-shell-" + CACHE_VERSION;
const RUNTIME_CACHE = "fitness-runtime-" + CACHE_VERSION;

const SHELL = [
  "./", "index.html", "styles.css", "manifest.webmanifest", "firebase-config.js",
  "js/app.js", "js/db.js", "js/store.js", "js/metrics.js", "js/chart.js", "js/bodyMap.js", "js/timer.js", "js/ui.js",
  "js/views/workout.js", "js/views/programs.js", "js/views/exercises.js", "js/views/progress.js",
  "js/views/history.js", "js/views/settings.js", "js/views/entryCard.js",
  "icons/icon.svg", "icons/icon-maskable.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"
];
// Основные модули Firebase кэшируем сразу (best effort), остальные чанки — при первом обращении.
const CDN = [
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL.map(u => new Request(u, { cache: "reload" })));
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

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(request, { cache: "no-cache", signal: ctrl.signal });
    clearTimeout(t);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return (await cache.match(request, { ignoreSearch: true })) ||
           (fallbackUrl && (await cache.match(fallbackUrl))) ||
           Response.error();
  }
}

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
      event.respondWith(networkFirst(req, SHELL_CACHE, "index.html"));
      return;
    }
    event.respondWith(networkFirst(req, SHELL_CACHE));
  } else if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
  }
  // Запросы к firestore.googleapis.com не трогаем: офлайн обрабатывает сам Firestore SDK.
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow("./");
  })());
});
