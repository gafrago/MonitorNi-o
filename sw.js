/* A.R.E.S. C4I - Service Worker (solo lectura sin conexion)
   Guarda: la aplicacion, las librerias, los niveles de rios (datos publicos) y los mosaicos de mapa ya vistos.
   NO guarda: unidades, personal, misiones, aeronaves ni ninguna respuesta con sesion (eso solo viaja por POST y jamas se almacena).
   Al cambiar la aplicacion, subir VERSION para que los celulares se actualicen. */
const VERSION = 'ares-v1';
const CACHE_APP = VERSION + '-app', CACHE_LIB = VERSION + '-lib', CACHE_TILES = VERSION + '-tiles', CACHE_RIOS = VERSION + '-rios';
const PRECARGA = ['./', 'manifest.json', 'icon-192.png', 'icon-512.png'];
const MAX_TILES = 400;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_APP).then(c => Promise.all(PRECARGA.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.indexOf(VERSION) !== 0).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'LIMPIAR') e.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k))))); });

const guardable = r => r && (r.ok || r.type === 'opaque');
async function red_primero(req, nombre) {
  const c = await caches.open(nombre);
  try { const r = await fetch(req); if (guardable(r)) c.put(req, r.clone()); return r; }
  catch (e) { const h = await c.match(req); if (h) return h; throw e; }
}
async function cache_primero(req, nombre) {
  const c = await caches.open(nombre), h = await c.match(req); if (h) return h;
  const r = await fetch(req); if (guardable(r)) c.put(req, r.clone()); return r;
}
async function revalidar(req, nombre, tope) {
  const c = await caches.open(nombre), h = await c.match(req);
  const red = fetch(req).then(async r => { if (guardable(r)) { await c.put(req, r.clone()); if (tope) recortar(c, tope); } return r; }).catch(() => null);
  return h || (await red) || Response.error();
}
async function recortar(c, tope) { const ks = await c.keys(); for (let i = 0; i < ks.length - tope; i++) await c.delete(ks[i]); }

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;             // los POST (datos con sesion) nunca pasan por la cache
  const u = new URL(req.url);

  if (req.mode === 'navigate' && u.origin === location.origin) {      // la aplicacion: red primero, y si no hay red, la ultima guardada
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE_APP).then(c => c.put('./', cp)); return r; }).catch(() => caches.match('./').then(r => r || Response.error())));
    return;
  }
  if (u.origin === location.origin) { e.respondWith(revalidar(req, CACHE_APP)); return; }

  if (u.hostname === 'script.google.com' || u.hostname === 'script.googleusercontent.com') {
    // Unico dato del servidor que se guarda: niveles de rios (publicos). Todo lo demas, directo a la red.
    if (u.searchParams.get('action') === 'getData' && u.searchParams.get('tab') === 'Hidrometria') e.respondWith(red_primero(req, CACHE_RIOS));
    return;
  }
  if (/(^|\.)(cdnjs\.cloudflare\.com|unpkg\.com)$/.test(u.hostname)) { e.respondWith(cache_primero(req, CACHE_LIB)); return; }     // versiones fijas
  if (/tile\.openstreetmap\.org$|basemaps\.cartocdn\.com$/.test(u.hostname)) { e.respondWith(revalidar(req, CACHE_TILES, MAX_TILES)); return; }
  if (/tilecache\.rainviewer\.com$|gibs\.earthdata\.nasa\.gov$/.test(u.hostname)) { e.respondWith(red_primero(req, CACHE_TILES)); return; }
  // pronosticos, ruteo, busqueda de direcciones, etc.: siempre en linea (un dato viejo de clima engaña)
});
