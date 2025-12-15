const CACHE_NAME = 'neocalc-v1';
const STATIC_ASSETS = [
    '/',
    '/neo',
    '/index.html',
    '/manifest.json'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        }).catch(() => {
            // Ignore cache errors in development
        })
    );
    self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // Skip these requests entirely - don't intercept them
    if (
        event.request.method !== 'GET' ||
        url.includes('localhost:8080') ||      // LLM API
        url.includes('@vite') ||               // Vite HMR
        url.includes('@react-refresh') ||      // React refresh
        url.includes('node_modules') ||        // Dependencies
        url.includes('.jsx') ||                // Source files
        url.includes('.ts') ||                 // TypeScript files
        url.includes('?t=') ||                 // Vite cache busting
        url.includes('__vite')                 // Vite internals
    ) {
        return; // Let the browser handle these normally
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Only cache successful responses
                if (response && response.status === 200) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            })
            .catch(() => {
                // Fallback to cache
                return caches.match(event.request);
            })
    );
});
