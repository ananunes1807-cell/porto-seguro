const CACHE_NAME = 'porto-seguro-v1';
const ARQUIVOS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.webmanifest',
    './favicon.svg'
];

self.addEventListener('install', (evento) => {
    evento.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ARQUIVOS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
    evento.waitUntil(
        caches.keys().then((nomes) => Promise.all(
            nomes
                .filter((nome) => nome !== CACHE_NAME)
                .map((nome) => caches.delete(nome))
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', (evento) => {
    if (evento.request.method !== 'GET') return;

    evento.respondWith(
        fetch(evento.request)
            .then((resposta) => {
                const copia = resposta.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(evento.request, copia));
                return resposta;
            })
            .catch(() => caches.match(evento.request).then((resposta) => resposta || caches.match('./index.html')))
    );
});
