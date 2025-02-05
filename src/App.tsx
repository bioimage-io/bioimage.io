import React, { useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import SearchBar from './components/SearchBar';
import PartnerScroll from './components/PartnerScroll';
import { useHyphaStore } from './store/hyphaStore';
import ResourceGrid from './components/ResourceGrid';
import { ResourceDetails } from './components/ResourceDetails';

// Create a wrapper component that uses Router hooks
const AppContent: React.FC = () => {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const hasResourceId = searchParams.has('id');

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="container mx-auto px-4">
        <PartnerScroll />
        {hasResourceId ? (
          <ResourceDetails />
        ) : (
          <Routes>
            <Route path="/" element={<ResourceGrid />} />
            <Route path="/models" element={<ResourceGrid type="model" />} />
            <Route path="/applications" element={<ResourceGrid type="application" />} />
            <Route path="/notebooks" element={<ResourceGrid type="notebook" />} />
            <Route path="/datasets" element={<ResourceGrid type="dataset" />} />
          </Routes>
        )}
      </main>
    </div>
  );
};

// Main App component that provides Router context
const App: React.FC = () => {
  const { initializeClient } = useHyphaStore();

  const initializeClientCallback = useCallback(() => {
    initializeClient();
  }, [initializeClient]);

  useEffect(() => {
    initializeClientCallback();
  }, [initializeClientCallback]);

  return (
    <Router>
      <AppContent />
    </Router>
  );
};

export default App;
