import React, { createContext, useContext } from 'react';
import type { HyphaClient } from '@hyphahub/js-client';

interface HyphaContextType {
  hyphaClient: HyphaClient | null;
  setHyphaClient: (client: HyphaClient | null) => void;
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
  const [hyphaClient, setHyphaClient] = React.useState<HyphaClient | null>(null);

  return (
    <HyphaContext.Provider value={{ hyphaClient, setHyphaClient }}>
      {children}
    </HyphaContext.Provider>
  );
} 