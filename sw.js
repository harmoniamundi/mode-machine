/* Service worker — Mode Machine
   Rend l'application utilisable hors ligne.
   - Les fichiers de l'application sont mis en cache à l'installation.
   - Stratégie « réseau d'abord, cache en secours » pour l'application : quand on est en ligne, on reçoit toujours la
     dernière version publiée (et le cache est rafraîchi) ; hors ligne, ou si le réseau tarde trop, c'est la copie en cache qui sert.
   - Les bibliothèques venues d'un CDN (VexFlow pour la portée, soundfont-player) et les échantillons du piano
     (soundfont MusyngKite, plusieurs Mo) sont mis en cache eux aussi, en « cache d'abord » : leurs adresses sont
     versionnées, elles ne changent donc pas.
   Pour forcer une mise à jour du cache après une publication, incrémenter VERSION. */

const VERSION = 'modes-v1';
const CACHE_APP = `${VERSION}-app`;
const CACHE_LIBS = `${VERSION}-libs`;

const FICHIERS_APP = [
    './',
    'index.html',
    'app/style.css',
    'app/manifest.webmanifest',
    'app/icon-192.png',
    'app/icon-512.png',
    'app/icon-maskable-512.png',
    'app/apple-touch-icon.png'
];

// Ressources externes : à garder identiques aux adresses utilisées dans index.html et par soundfont-player
// (acoustic_grand_piano, soundfont MusyngKite, format mp3).
const URLS_LIBS = [
    'https://cdn.jsdelivr.net/npm/vexflow@4.2.2/build/cjs/vexflow.js',
    'https://cdn.jsdelivr.net/npm/soundfont-player@0.12.0/dist/soundfont-player.min.js',
    'https://gleitz.github.io/midi-js-soundfonts/MusyngKite/acoustic_grand_piano-mp3.js'
];
const HOTES_LIBS = ['cdn.jsdelivr.net', 'gleitz.github.io'];
const DELAI_RESEAU_MS = 4000;

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cacheApp = await caches.open(CACHE_APP);
        // Les fichiers de l'application sont indispensables : si l'un manque, l'installation échoue et sera retentée.
        await cacheApp.addAll(FICHIERS_APP.map(u => new Request(u, { cache: 'reload' })));

        // Les bibliothèques sont un « plus » : un échec (hors ligne, site bloqué) n'empêche pas l'installation ;
        // elles seront alors mises en cache au premier usage en ligne.
        const cacheLibs = await caches.open(CACHE_LIBS);
        await Promise.all(URLS_LIBS.map(async (u) => {
            try {
                if (await cacheLibs.match(u)) return;
                const r = await fetch(u, { mode: 'cors' });
                if (r.ok) await cacheLibs.put(u, r);
            } catch (e) { /* ignoré */ }
        }));

        self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const noms = await caches.keys();
        await Promise.all(
            noms.filter(n => n !== CACHE_APP && n !== CACHE_LIBS).map(n => caches.delete(n))
        );
        await self.clients.claim();
    })());
});

// Réseau d'abord (avec délai maximal), sinon cache.
async function reseauPuisCache(request) {
    const cache = await caches.open(CACHE_APP);
    try {
        const reponse = await Promise.race([
            fetch(request),
            new Promise((_, rejet) => setTimeout(() => rejet(new Error('delai')), DELAI_RESEAU_MS))
        ]);
        if (reponse && reponse.ok) cache.put(request, reponse.clone());
        return reponse;
    } catch (e) {
        const enCache = await cache.match(request, { ignoreSearch: true });
        if (enCache) return enCache;
        if (request.mode === 'navigate') {
            const accueil = await cache.match('index.html') || await cache.match('./');
            if (accueil) return accueil;
        }
        throw e;
    }
}

// Cache d'abord pour les bibliothèques et les sons (adresses versionnées : inutile de les redemander).
// Quand l'élément n'est pas encore en cache, il est récupéré en mode « cors » (ces hôtes l'autorisent) :
// la copie gardée est ainsi lisible et ne compte pas pour une réponse « opaque », très coûteuse en espace.
async function cachePuisReseau(request) {
    const cache = await caches.open(CACHE_LIBS);
    const enCache = await cache.match(request.url);
    if (enCache) return enCache;
    try {
        const reponse = await fetch(request.url, { mode: 'cors' });
        if (reponse && reponse.ok) cache.put(request.url, reponse.clone());
        return reponse;
    } catch (e) {
        return Response.error();
    }
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);

    if (url.origin === self.location.origin) {
        event.respondWith(reseauPuisCache(request));
    } else if (HOTES_LIBS.includes(url.hostname)) {
        event.respondWith(cachePuisReseau(request));
    }
});
