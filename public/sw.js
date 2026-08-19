// Service worker écrit à la main — posé tel quel dans public/, servi à la
// racine du site aussi bien en aperçu qu'en production. Aucune génération
// au build : on évite ainsi toute dépendance à la façon dont Nitro
// restructure la sortie de Vite.
//
// Stratégie : pour toute requête GET vers le même domaine, on tente le
// réseau en premier ; si ça réussit, on met la réponse en cache et on la
// renvoie ; si le réseau échoue (hors ligne), on sert la dernière version
// mise en cache. Rien n'est pré-chargé au build : le cache se construit au
// fur et à mesure de la navigation en ligne.
const CACHE_NAME = "eg-cache-v1";

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
  // On ne touche jamais aux appels vers un autre domaine (Supabase, polices
  // Google, etc.) — seulement ce qui vient de l'app elle-même.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? Response.error())),
  );
});
