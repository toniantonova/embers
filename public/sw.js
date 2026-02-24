/**
 * Service Worker — Pre-caches Moonshine model files on install.
 *
 * This runs silently in the background after the user's first visit.
 * Once cached, the ~50MB model loads instantly from local storage,
 * eliminating the 5-second timeout on subsequent visits.
 *
 * Uses the same 'transformers-cache' cache name that Transformers.js
 * uses internally, so the cached files are shared.
 */

const CACHE_NAME = 'transformers-cache';
const MODEL_ID = 'onnx-community/moonshine-tiny-ONNX';
const HF_CDN = `https://huggingface.co/${MODEL_ID}/resolve/main`;

// These are the files fetched by Transformers.js during model loading.
// Captured by running the model load with DevTools Network tab open.
const MOONSHINE_MODEL_FILES = [
    `${HF_CDN}/onnx/encoder_model.onnx`,
    `${HF_CDN}/onnx/decoder_model_merged_q4.onnx`,
    `${HF_CDN}/tokenizer.json`,
    `${HF_CDN}/tokenizer_config.json`,
    `${HF_CDN}/preprocessor_config.json`,
    `${HF_CDN}/config.json`,
    `${HF_CDN}/generation_config.json`,
];

self.addEventListener('install', (event) => {
    // Don't wait for old SW to deactivate
    self.skipWaiting();

    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Pre-caching Moonshine model files...');
            // Fetch each file individually so partial failures don't
            // block the entire cache operation
            return Promise.allSettled(
                MOONSHINE_MODEL_FILES.map(async (url) => {
                    try {
                        const response = await fetch(url, { mode: 'cors' });
                        if (response.ok) {
                            await cache.put(url, response);
                            console.log(`[SW] Cached: ${url.split('/').pop()}`);
                        } else {
                            console.warn(`[SW] Failed to cache ${url}: ${response.status}`);
                        }
                    } catch (err) {
                        console.warn(`[SW] Network error caching ${url}:`, err);
                    }
                })
            );
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
    console.log('[SW] Activated — Moonshine model cache ready');
});

// Intercept fetch requests ONLY for HuggingFace model files.
// Important: do NOT intercept all requests — on iOS Safari, intercepting
// module script loads via service worker causes a blank gray screen.
self.addEventListener('fetch', (event) => {
    if (!event.request.url.includes('huggingface.co')) return;

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(event.request);
        })
    );
});
