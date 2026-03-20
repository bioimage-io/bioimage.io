import React, { useEffect } from 'react';
import { HashRouter, Routes, Route, useLocation, Navigate, useParams } from 'react-router-dom';
import Navbar from './components/Navbar';

import ArtifactGrid from './components/ArtifactGrid';
import ArtifactDetails from './components/ArtifactDetails';
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
import TermsOfService from './components/TermsOfService';
import BioEngineHome from './components/bioengine/BioEngineHome';
import BioEngineWorker from './components/bioengine/BioEngineWorker';
import ColabPage from './components/colab/ColabPage';
import TrainingPage from './pages/TrainingPage';
import AnnotatePage from './pages/AnnotatePage';

// Add a utility function to check if footer should be hidden
const shouldHideFooter = (pathname: string): boolean => {
  return pathname.startsWith('/edit/') || pathname === '/upload' || pathname === '/annotate';
};

// Hide the full navbar on the annotate page (it has its own compact header)
const shouldHideNavbar = (pathname: string): boolean => {
  return pathname === '/annotate';
};

const TrainingRedirect: React.FC = () => {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const location = useLocation();
  return <Navigate to={sessionId ? `/colab/training/${sessionId}` : '/colab/training'} state={location.state} replace />;
};

// Create a wrapper component that uses Router hooks
const AppContent: React.FC = () => {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const hasResourceId = searchParams.has('id');
  const hideFooter = shouldHideFooter(location.pathname);
  const hideNavbar = shouldHideNavbar(location.pathname);

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
      {!hideNavbar && <Navbar />}
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
          <Route path="/models" element={<ArtifactGrid type="model" />} />
          <Route path="/applications" element={<ArtifactGrid type="application" />} />
          <Route path="/notebooks" element={<ArtifactGrid type="notebook" />} />
          <Route path="/datasets" element={<ArtifactGrid type="dataset" />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/my-artifacts" element={<MyArtifacts />} />
          <Route path="/edit/:artifactId/:version?" element={<Edit />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/review" element={<ReviewArtifacts />} />
          <Route path="/api" element={<ApiDocs />} />
          <Route path="/toc" element={<TermsOfService />} />
          <Route path="/bioengine" element={<BioEngineHome />} />
          <Route path="/bioengine-worker" element={<BioEngineWorker />} />
          <Route path="/colab/*" element={<ColabPage />} />
          <Route path="/training" element={<TrainingRedirect />} />
          <Route path="/training/:sessionId" element={<TrainingRedirect />} />
          <Route path="/annotate" element={<AnnotatePage />} />
        </Routes>
      </main>
      {!hideFooter && <Footer />}
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
