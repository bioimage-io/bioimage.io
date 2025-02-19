import React, { useEffect } from 'react';
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';

import ResourceGrid from './components/ResourceGrid';
import ResourceDetails from './components/ResourceDetails';
import Snackbar from './components/Snackbar';
import About from './components/About';
import Footer from './components/Footer';
import Upload from './components/Upload';
import MyArtifacts from './components/MyArtifacts';
import Edit from './components/Edit';
import './index.css'
import './github-markdown.css'
import { HyphaProvider } from './HyphaContext';
import AdminDashboard from './pages/AdminDashboard';
import ReviewArtifacts from './components/ReviewArtifacts';
import ApiDocs from './components/ApiDocs';
import AnnotatePage from './pages/AnnotatePage';
import CreateAnnotationPage from './pages/CreateAnnotationPage';

// Create a wrapper component that uses Router hooks
const AppContent: React.FC = () => {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const hasResourceId = searchParams.has('id');

  // Add state for Snackbar
  const [snackbarOpen, setSnackbarOpen] = React.useState(false);
  const [snackbarMessage, setSnackbarMessage] = React.useState('');

  // Add search handlers
  const handleSearchChange = (value: string) => {
    // Implement search logic
  };

  const handleSearchConfirm = (value: string) => {
    // Implement search confirmation logic
  };

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
      <main className="container mx-auto px-4">
        <Routes>
          <Route
            path="/"
            element={
              <>
                <ResourceGrid />
              </>
            }
          />
          <Route 
            path="/resources/:id" 
            element={<ResourceDetails />} 
          />
          <Route 
            path="/about" 
            element={<About />} 
          />
          <Route path="/models" element={<ResourceGrid type="model" />} />
          <Route path="/applications" element={<ResourceGrid type="application" />} />
          <Route path="/notebooks" element={<ResourceGrid type="notebook" />} />
          <Route path="/datasets" element={<ResourceGrid type="dataset" />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/my-artifacts" element={<MyArtifacts />} />
          <Route path="/edit/:artifactId" element={<Edit />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/review" element={<ReviewArtifacts />} />
          <Route path="/api" element={<ApiDocs />} />
          <Route path="/annotate" element={<AnnotatePage />} />
          <Route path="/annotations" element={<AnnotatePage />} />
          <Route path="/annotate/new" element={<CreateAnnotationPage />} />
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
