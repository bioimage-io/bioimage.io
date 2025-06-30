/**
 * BioImage.IO Cache Clearing Service Worker
 * This service worker replaces the old Workbox service worker
 * and immediately clears all caches and unregisters itself
 * 
 * Version: 2025-06-30-v1
 * Last updated: June 30, 2025
 */

const SW_VERSION = '2025-06-30-v1';
const SW_NAME = 'BioImage.IO Cache Cleaner';

console.log(`${SW_NAME} v${SW_VERSION}: Starting...`);

// Take control immediately when installed
self.addEventListener('install', (event) => {
  console.log('BioImage.IO: Service worker installing...');
  // Skip waiting to activate immediately
  self.skipWaiting();
});

// Take control of all clients immediately
self.addEventListener('activate', (event) => {
  console.log('BioImage.IO: Service worker activating...');
  
  event.waitUntil(
    (async () => {
      // Take control of all clients immediately
      await self.clients.claim();
      
      console.log('BioImage.IO: Clearing all caches...');
      
      // Delete all caches
      const cacheNames = await caches.keys();
      console.log('BioImage.IO: Found caches:', cacheNames);
      
      await Promise.all(
        cacheNames.map(cacheName => {
          console.log('BioImage.IO: Deleting cache:', cacheName);
          return caches.delete(cacheName);
        })
      );
      
      console.log('BioImage.IO: All caches cleared!');
      
      // Get all clients and send them a message to reload
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        console.log('BioImage.IO: Sending reload message to client');
        client.postMessage({
          type: 'CACHE_CLEARED',
          message: 'Caches cleared, reloading page...'
        });
      });
      
      // Unregister this service worker after a short delay
      setTimeout(() => {
        console.log('BioImage.IO: Unregistering service worker...');
        self.registration.unregister().then(() => {
          console.log('BioImage.IO: Service worker unregistered successfully');
        }).catch(err => {
          console.error('BioImage.IO: Failed to unregister service worker:', err);
        });
      }, 1000);
    })()
  );
});

// Intercept all fetch requests temporarily
self.addEventListener('fetch', (event) => {
  // For the main page, always fetch from network to ensure fresh content
  if (event.request.mode === 'navigate' || event.request.url.endsWith('/')) {
    console.log('BioImage.IO: Serving fresh content for navigation request');
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' }).catch(() => {
        // Fallback to cache if network fails
        return caches.match(event.request);
      })
    );
    return;
  }
  
  // For other requests, just pass through to network
  event.respondWith(fetch(event.request));
});

// Listen for messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('BioImage.IO: Received SKIP_WAITING message');
    self.skipWaiting();
  }
});

console.log('BioImage.IO: Service worker script loaded'); 