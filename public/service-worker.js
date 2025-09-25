/**
 * RI-SCALE Model Hub Cleanup Service Worker
 * This minimal service worker unregisters itself and clears caches
 * to ensure users aren't stuck with old cached content
 * 
 * Last updated: 2025-08-21
 */

// Take control immediately when installed
self.addEventListener('install', (event) => {
  console.log('RI-SCALE Model Hub: Cleanup service worker installing...');
  // Skip waiting to activate immediately
  self.skipWaiting();
});

// Take control of all clients immediately and clean up
self.addEventListener('activate', (event) => {
  console.log('RI-SCALE Model Hub: Cleanup service worker activating...');
  
  event.waitUntil(
    (async () => {
      // Take control of all clients immediately
      await self.clients.claim();
      
      console.log('RI-SCALE Model Hub: Clearing all caches...');
      
      // Delete ALL caches
      try {
        const cacheNames = await caches.keys();
        if (cacheNames.length > 0) {
          console.log('RI-SCALE Model Hub: Found caches to clear:', cacheNames);
          await Promise.all(
            cacheNames.map(cacheName => {
              console.log('RI-SCALE Model Hub: Deleting cache:', cacheName);
              return caches.delete(cacheName);
            })
          );
          console.log('RI-SCALE Model Hub: All caches cleared!');
        } else {
          console.log('RI-SCALE Model Hub: No caches found to clear');
        }
      } catch (error) {
        console.error('RI-SCALE Model Hub: Error clearing caches:', error);
      }
      
      // Unregister this service worker after a short delay
      setTimeout(async () => {
        console.log('RI-SCALE Model Hub: Unregistering service worker...');
        try {
          await self.registration.unregister();
          console.log('RI-SCALE Model Hub: Service worker unregistered successfully');
        } catch (err) {
          console.error('RI-SCALE Model Hub: Failed to unregister service worker:', err);
        }
      }, 1000); // 1 second delay to ensure cleanup is complete
    })()
  );
});

// Don't intercept any fetch requests - just pass them through
self.addEventListener('fetch', (event) => {
  // Simply pass through all requests to the network
  event.respondWith(fetch(event.request));
});

// Listen for messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('RI-SCALE Model Hub: Received SKIP_WAITING message');
    self.skipWaiting();
  }
});

console.log('RI-SCALE Model Hub: Cleanup service worker loaded');