import React, { useEffect } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import Navbar from './components/Navbar';
import SearchBar from './components/SearchBar';
import PartnerScroll from './components/PartnerScroll';
import { initializeHyphaClient } from './store/hyphaStore';

const App: React.FC = () => {
  useEffect(() => {
    // Initialize Hypha client when the app loads
    const init = async () => {
      try {
        await initializeHyphaClient();
      } catch (error) {
        console.error('Failed to initialize Hypha:', error);
      }
    };
    init();
  }, []);

  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main className="container mx-auto px-4">
          <PartnerScroll />
          <SearchBar />
        </main>
      </div>
    </Router>
  );
};

export default App;
