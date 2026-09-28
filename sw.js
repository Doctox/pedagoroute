/* Pédago Conduite — service worker.

   Trois régimes, et le choix compte :
   - la coque (HTML, icônes) : **réseau d'abord**. Le cache d'abord servirait
     éternellement l'ancienne version, et les mises à jour n'arriveraient
     jamais. Le cache ne sert que de filet quand le réseau manque.
   - les tuiles IGN : **cache d'abord**. C'est ce qui fait marcher le secteur
     déjà consulté en voiture, sans réseau.
   - les routes d'OpenStreetMap : **cache d'abord** aussi. Elles servent à
     recaler les points au milieu de leur voie, et ce serait la première chose
     à lâcher en leçon. Les bbox étant calées sur une grille fixe côté
     application, les mêmes URL reviennent d'une visite à l'autre.
   - tout le reste, dont Esri : **jamais mis en cache**. Les conditions d'Esri
     interdisent l'export de tuiles.
*/
const COQUE  = 'pedago-coque-6';
const TUILES = 'pedago-tuiles-1';
const ROUTES = 'pedago-routes-1';
const PLAFOND = 1500;                     // tuiles gardées
const PLAFOND_ROUTES = 150;               // cases de routes gardées (~180 km²)

const FICHIERS = ['./', './index.html', './manifest.webmanifest',
                  './icone-192.png', './icone-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(COQUE)
    .then(c => c.addAll(FICHIERS))
    .then(() => self.skipWaiting())
    .catch(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(n => Promise.all(n.filter(x => x !== COQUE && x !== TUILES && x !== ROUTES)
                            .map(x => caches.delete(x))))
    .then(() => self.clients.claim()));
});

async function elaguer(cache, plafond, purge) {
  const cles = await cache.keys();
  if (cles.length <= plafond) return;
  for (const c of cles.slice(0, cles.length - plafond + purge)) await cache.delete(c);
}

/* Cache d'abord, réseau en secours, et on garde ce qui revient. Le même
   régime sert aux tuiles et aux routes : ce sont deux fonds de leçon. */
function servirDuCache(e, nom, plafond, purge) {
  e.respondWith((async () => {
    const cache = await caches.open(nom);
    const garde = await cache.match(e.request);
    if (garde) return garde;
    try {
      const rep = await fetch(e.request);
      if (rep && rep.ok) cache.put(e.request, rep.clone()).then(() => elaguer(cache, plafond, purge));
      return rep;
    } catch (err) {
      return new Response('', { status: 504, statusText: 'hors ligne' });
    }
  })());
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);

  // tuiles IGN : cache d'abord, c'est le hors-ligne
  if (u.hostname === 'data.geopf.fr' && u.pathname.indexOf('/wmts') === 0) {
    servirDuCache(e, TUILES, PLAFOND, 200);
    return;
  }

  // routes d'OpenStreetMap : cache d'abord, pour recaler sans réseau
  if (u.hostname === 'api.openstreetmap.org' && u.pathname.indexOf('/api/0.6/map') === 0) {
    servirDuCache(e, ROUTES, PLAFOND_ROUTES, 30);
    return;
  }

  // géocodage IGN : inutile hors ligne, on laisse passer
  if (u.hostname === 'data.geopf.fr') return;

  // tout autre domaine (Esri) : on ne touche à rien, aucun cache
  if (u.origin !== self.location.origin) return;

  // la coque : réseau d'abord, cache en filet
  e.respondWith((async () => {
    try {
      const rep = await fetch(e.request);
      if (rep && rep.ok) {
        const copie = rep.clone();
        caches.open(COQUE).then(c => c.put(e.request, copie));
      }
      return rep;
    } catch (err) {
      const garde = await caches.match(e.request);
      if (garde) return garde;
      if (e.request.mode === 'navigate') {
        const accueil = await caches.match('./index.html');
        if (accueil) return accueil;
      }
      throw err;
    }
  })());
});
