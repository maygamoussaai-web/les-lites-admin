// Service worker — Les Elites de Gao
// Reseau d'abord pour les pages ; cache pour le hors ligne.
// Assets statiques (js/css/fonts/images) : cache d'abord puis reseau.
const CACHE_NAME = "eg-cache-v2";

const ASSET_EXT = /\.(js|css|woff2?|ttf|otf|png|jpe?g|gif|webp|svg|ico|webmanifest)(\?.*)?$/i;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Jamais intercepter Supabase / domaines externes.
  if (url.origin !== self.location.origin) return;

  const isAsset = ASSET_EXT.test(url.pathname);
  const isNavigate = request.mode === "navigate";

  if (isAsset) {
    // Cache-first pour les fichiers statiques (chargement plus fluide).
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response && response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
    return;
  }

  // Pages / HTML : reseau d'abord, sinon cache, sinon shell de navigation.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (isNavigate) {
          const shell =
            (await caches.match("/")) ||
            (await caches.match("/index.html")) ||
            (await caches.match("/tableau-de-bord"));
          if (shell) return shell;
        }
        return Response.error();
      }),
  );
});
