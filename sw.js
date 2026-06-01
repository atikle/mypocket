const CACHE_NAME = 'mypocket-cache-v0.0.1';
const OFFLINE_URL = './app.html'; // Fallback to main app since it works offline via Firestore

const ASSETS_TO_CACHE = [
    './',
    './app.html',
    './script.js',
    './login.html',
    
    // Fonts
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
    'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
    
    // External Libraries
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js',
    
    // Firebase Modular SDKs
    'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js',
    'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js',
    'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js'
];

// Install Event: Pre-cache the core shell
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[Service Worker] Pre-caching core assets');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

// Activate Event: Clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[Service Worker] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    return self.clients.claim();
});

// Fetch Event: Cache Strategies
self.addEventListener('fetch', event => {
    // Only handle GET requests
    if (event.request.method !== 'GET') return;

    // Skip cross-origin requests for things we don't control, unless they are in our ASSETS list
    const isAsset = ASSETS_TO_CACHE.some(url => event.request.url.includes(url));

    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            if (cachedResponse) {
                // If it's an external library or font, return cached immediately (Cache-First)
                // We fetch in the background to update the cache for next time (Stale-While-Revalidate)
                if (isAsset) {
                    fetch(event.request).then(networkResponse => {
                        if (networkResponse.ok) {
                            caches.open(CACHE_NAME).then(cache => cache.put(event.request, networkResponse));
                        }
                    }).catch(() => {}); // Ignore network errors in background
                    return cachedResponse;
                }
                return cachedResponse;
            }

            // Network-First for dynamic navigation requests (HTML pages)
            return fetch(event.request).then(networkResponse => {
                // Check if we received a valid response
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                    return networkResponse;
                }

                // Clone the response because it's a stream and can only be consumed once
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, responseToCache);
                });

                return networkResponse;
            }).catch(error => {
                console.warn('[Service Worker] Fetch failed, serving offline fallback', error);
                
                // Offline fallback logic for HTML navigation
                if (event.request.mode === 'navigate') {
                    return caches.match(OFFLINE_URL);
                }
            });
        })
    );
});