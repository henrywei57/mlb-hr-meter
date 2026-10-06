// Service worker: lets the app install and open with no connection.
//
// Strategy: for files that belong to the app itself, try the network first (so you always get
// the newest code while online) and fall back to the saved copy when offline.
// Requests to the MLB API are NOT touched: the app handles being offline itself and keeps
// showing the last numbers it had.
//
// Change CACHE_NAME whenever you add a file to APP_FILES, so old caches get cleaned up.

const CACHE_NAME = "hr-meter-v19";

const APP_FILES = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "src/main.js",
  "src/config.js",
  "src/api.js",
  "src/sources.js",
  "src/gamestate.js",
  "src/model.js",
  "src/util.js",
  "src/theme.js",
  "src/settings.js",
  "src/audio.js",
  "src/ui/home.js",
  "src/ui/game.js",
  "src/ui/why.js",
  "src/ui/zone.js",
  "src/venues.js",
  "src/ui/scene.js",
  "src/ui/lab.js",
  "src/ui/wp.js",
  "src/ui/pitchdialog.js",
  "src/ui/saved.js",
  "src/ui/browse.js",
  "src/library.js",
  "src/pitchdata.js",
  "src/saved.js",
  "src/winprob.js",
  "src/ui/scene3d.js",
  "src/ui/stage.js",
  "src/ui/gl.js",
  "public/vendor/three.module.min.js",
  "src/ui/diamond.js",
  "public/data/rates.json",
  "public/data/venues.json",
  "public/data/team-colors.json",
  "public/data/demo_game.json",
  "public/icons/icon-192.png",
  "public/icons/icon-512.png",
  "public/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // Add files one by one so a single missing file can't stop the whole install.
      .then((cache) => Promise.all(APP_FILES.map((file) => cache.add(file).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return; // leave MLB API alone

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match("index.html")))
  );
});
