/**
 * BioImage.IO Cleanup Service Worker
 * This minimal service worker unregisters itself and clears caches
 * to ensure users aren't stuck with old cached content
 * 
 * Last updated: 2025-08-21
 */

// Take control immediately when installed
self.addEventListener('install', (event) => {
  console.log('BioImage.IO: Cleanup service worker installing...');
  // Skip waiting to activate immediately
  self.skipWaiting();
});

// Take control of all clients immediately and clean up
self.addEventListener('activate', (event) => {
  console.log('BioImage.IO: Cleanup service worker activating...');
  
  event.waitUntil(
    (async () => {
      // Take control of all clients immediately
      await self.clients.claim();
      
      console.log('BioImage.IO: Clearing all caches...');
      
      // Delete ALL caches
      try {
        const cacheNames = await caches.keys();
        if (cacheNames.length > 0) {
          console.log('BioImage.IO: Found caches to clear:', cacheNames);
          await Promise.all(
            cacheNames.map(cacheName => {
              console.log('BioImage.IO: Deleting cache:', cacheName);
              return caches.delete(cacheName);
            })
          );
          console.log('BioImage.IO: All caches cleared!');
        } else {
          console.log('BioImage.IO: No caches found to clear');
        }
      } catch (error) {
        console.error('BioImage.IO: Error clearing caches:', error);
      }
      
      // Unregister this service worker after a short delay
      setTimeout(async () => {
        console.log('BioImage.IO: Unregistering service worker...');
        try {
          await self.registration.unregister();
          console.log('BioImage.IO: Service worker unregistered successfully');
        } catch (err) {
          console.error('BioImage.IO: Failed to unregister service worker:', err);
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
    console.log('BioImage.IO: Received SKIP_WAITING message');
    self.skipWaiting();
  }
});

console.log('BioImage.IO: Cleanup service worker loaded');