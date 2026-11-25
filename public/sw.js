// Service Worker — Rawdah PWA
// Cache offline + notifications push

const CACHE_NAME = "rawdah-v1";

// Fichiers essentiels à cacher pour le mode hors ligne.
// Les assets avec hash sont ajoutés dynamiquement au premier chargement.
const PRECACHE_URLS = [
  "/",
  "/app.html",
  "/manifest.webmanifest",
  "/logo.svg",
];

// ── Installation : précache des fichiers essentiels ──

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// ── Activation : nettoyage des anciens caches ──

self.addEventListener("activate", (event) => {
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

// ── Fetch : network-first pour les pages, cache-first pour les assets ──

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Ne pas cacher les requêtes vers Convex ou les APIs externes
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    event.request.method !== "GET"
  ) {
    return;
  }

  // Assets avec hash (immutables) : cache-first
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
      )
    );
    return;
  }

  // Pages HTML et autres : network-first avec fallback cache
  if (event.request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/")))
    );
    return;
  }

  // Autres ressources (CSS, JS, images, polices) : stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// ── Notifications push ──

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    return;
  }

  const options = {
    body: data.body || "",
    icon: data.icon || "/logo.svg",
    badge: data.badge || "/logo.svg",
    tag: data.tag || "rawdah",
    data: data.data || {},
    vibrate: [200, 100, 200],
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(data.title || "Rawdah", options));
});

// Au clic sur la notification, ouvrir l'app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes("/dashboard") && "focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow("/dashboard");
    })
  );
});
