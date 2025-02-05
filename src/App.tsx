import React from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import Navbar from './components/Navbar';
import SearchBar from './components/SearchBar';
import PartnerScroll from './components/PartnerScroll';

const App: React.FC = () => {
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
