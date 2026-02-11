import React, { useEffect } from 'react';
import { HashRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';

import ArtifactGrid from './components/ArtifactGrid';
import ArtifactDetails from './components/ArtifactDetails';
import Snackbar from './components/Snackbar';
import About from './components/About';
import Footer from './components/Footer';
import Upload from './components/Upload';
import MyArtifacts from './components/MyArtifacts';
import Edit from './components/Edit';
import PartnersPage from './pages/PartnersPage';
import './index.css'
import './github-markdown.css'
import { HyphaProvider } from './HyphaContext';
import ApiDocs from './components/ApiDocs';
import Docs from './components/Docs';
import TermsOfService from './components/TermsOfService';

// Add a utility function to check if footer should be hidden
const shouldHideFooter = (pathname: string): boolean => {
  return pathname.startsWith('/edit/') || pathname === '/upload';
};

// Create a wrapper component that uses Router hooks
const AppContent: React.FC = () => {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const hasResourceId = searchParams.has('id');
  const hideFooter = shouldHideFooter(location.pathname);

  // Add state for Snackbar
  const [snackbarOpen, setSnackbarOpen] = React.useState(false);
  const [snackbarMessage, setSnackbarMessage] = React.useState('');

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <Snackbar 
        isOpen={snackbarOpen}
        message={snackbarMessage}
        onClose={() => setSnackbarOpen(false)}
      />
      <main className="w-full overflow-x-hidden">
        <Routes>
          <Route
            path="/"
            element={<Navigate to="/models" replace />}
          />
          <Route 
            path="/resources/:id" 
            element={<ArtifactDetails />} 
          />
          <Route 
            path="/artifacts/:id/:version?"
            element={<ArtifactDetails />} 
          />
          <Route 
            path="/about" 
            element={<About />} 
          />
          <Route path="/partners" element={<PartnersPage />} />
          <Route path="/models" element={<ArtifactGrid type="model" />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/my-artifacts" element={<MyArtifacts />} />
          <Route path="/edit/:artifactId/:version?" element={<Edit />} />
          <Route path="/api" element={<ApiDocs />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/toc" element={<TermsOfService />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
};

// Main App component that provides Router context
const App: React.FC = () => {
  return (
    <HyphaProvider>
      <HashRouter>
        <AppContent />
      </HashRouter>
    </HyphaProvider>
  );
};

export default App;
