// Service Worker Unregistration Script
// This script forcefully removes old service workers and clears caches

(function() {
  'use strict';
  
  console.log('BioImage.IO: Starting service worker cleanup...');
  
  // Unregister all service workers
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then(function(registrations) {
        if (registrations.length === 0) {
          console.log('BioImage.IO: No service workers found to unregister');
          return;
        }
        
        console.log('BioImage.IO: Found', registrations.length, 'service worker(s) to unregister');
        
        const unregisterPromises = registrations.map(function(registration) {
          console.log('BioImage.IO: Unregistering service worker:', registration.scope);
          return registration.unregister();
        });
        
        return Promise.all(unregisterPromises);
      })
      .then(function() {
        console.log('BioImage.IO: All service workers unregistered');
      })
      .catch(function(error) {
        console.error('BioImage.IO: Error unregistering service workers:', error);
      });
  }
  
  // Clear all caches
  if ('caches' in window) {
    caches.keys()
      .then(function(cacheNames) {
        if (cacheNames.length === 0) {
          console.log('BioImage.IO: No caches found to clear');
          return;
        }
        
        console.log('BioImage.IO: Found', cacheNames.length, 'cache(s) to clear:', cacheNames);
        
        const deletePromises = cacheNames.map(function(cacheName) {
          console.log('BioImage.IO: Deleting cache:', cacheName);
          return caches.delete(cacheName);
        });
        
        return Promise.all(deletePromises);
      })
      .then(function() {
        console.log('BioImage.IO: All caches cleared');
        
        // Mark that we've cleared the cache
        try {
          sessionStorage.setItem('bioimage_cache_cleared', Date.now().toString());
          localStorage.setItem('bioimage_cache_cleared', Date.now().toString());
        } catch (e) {
          // Storage might be disabled
          console.log('BioImage.IO: Could not set storage flag:', e.message);
        }
      })
      .catch(function(error) {
        console.error('BioImage.IO: Error clearing caches:', error);
      });
  }
  
  // Clear local storage items that might be from old site
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.includes('kaibu') || key.includes('imjoy') || key.includes('workbox'))) {
        keysToRemove.push(key);
      }
    }
    
    keysToRemove.forEach(function(key) {
      console.log('BioImage.IO: Removing localStorage key:', key);
      localStorage.removeItem(key);
    });
    
    if (keysToRemove.length > 0) {
      console.log('BioImage.IO: Removed', keysToRemove.length, 'localStorage items');
    }
  } catch (e) {
    console.log('BioImage.IO: Could not clear localStorage:', e.message);
  }
  
  console.log('BioImage.IO: Service worker cleanup complete');
})(); 