import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { HyphaCore } from 'hypha-core';
// Add WinBox type declaration
declare global {
  interface Window {
    WinBox: any;
    HyphaCore: any;
  }
}

// We're not using the HyphaClient type since we couldn't find the module
interface HyphaContextType {
  hyphaClient: any | null;
  setHyphaClient: (client: any | null) => void;
  hyphaCoreAPI: any | null;
  isHyphaCoreReady: boolean;
}

// HyphaCore window configuration type
interface WindowConfig {
  name?: string;
  src: string;
  window_id: string;
  [key: string]: any;
}

const HyphaContext = createContext<HyphaContextType | undefined>(undefined);

export function useHyphaContext() {
  const context = useContext(HyphaContext);
  if (context === undefined) {
    throw new Error('useHyphaContext must be used within a HyphaProvider');
  }
  return context;
}

export function HyphaProvider({ children }: { children: React.ReactNode }) {
  const [hyphaClient, setHyphaClient] = useState<any | null>(null);
  const [hyphaCoreAPI, setHyphaCoreAPI] = useState<any | null>(null);
  const [isHyphaCoreReady, setIsHyphaCoreReady] = useState<boolean>(false);

  // Guards against React 18 StrictMode's dev-only double-invoke of this
  // effect. HyphaCore has no public teardown API and throws "Server already
  // running" if start() is called a second time for the same URL while the
  // first instance is still registered, so we skip the second invocation
  // entirely rather than trying to tear down and recreate it.
  const hasInitializedRef = useRef(false);

  // Initialize hypha-core
  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    const initHyphaCore = async () => {
      try {
        // Initialize HyphaCore
        const hyphaCore = new HyphaCore();
        // Start hypha-core and get the API
        const api = await hyphaCore.start();
        
        setHyphaCoreAPI(api);
        setIsHyphaCoreReady(true);
        console.log("HyphaCore initialized successfully");
      } catch (error) {
        console.error("Failed to initialize HyphaCore:", error);
      }
    };
    
    // Helper function to load scripts
    const loadScript = (src: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
          resolve();
          return;
        }
        
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = (e) => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(script);
      });
    };
    
    initHyphaCore();
    
    // Cleanup function
    return () => {
      // Add any cleanup code for HyphaCore if needed
    };
  }, []);

  return (
    <HyphaContext.Provider value={{ 
      hyphaClient, 
      setHyphaClient,
      hyphaCoreAPI,
      isHyphaCoreReady
    }}>
      {children}
    </HyphaContext.Provider>
  );
} 