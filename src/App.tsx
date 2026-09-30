import React, { useEffect } from 'react';
import { HashRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import HyphaStatusBanner from './components/HyphaStatusBanner';
import ErrorDialog from './components/ErrorDialog';
import { useHyphaStore } from './store/hyphaStore';

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
import BioEngineWorkerSetup from './components/bioengine/BioEngineWorkerSetup';
import BioEngineWorkerAdmin from './components/bioengine/BioEngineWorkerAdmin';
import BioEngineAppsPage from './components/bioengine/BioEngineAppsPage';
import BioEngineTokenPage from './components/bioengine/BioEngineTokenPage';
import ColabPage from './components/colab/ColabPage';
import CampaignsPage from './components/campaigns/CampaignsPage';
import { useConnectionLiveness } from './hooks/useConnectionLiveness';

// `/bioengine/worker` moved to `/bioengine/worker-admin` when the BioEngine
// landing page split into three audiences. Dashboard links carry the worker in
// `?service_id=` and are shared around, so the search string is forwarded
// verbatim rather than dropped. `replace` keeps the dead URL out of history.
const BioEngineWorkerRedirect: React.FC = () => {
  const { search } = useLocation();
  return <Navigate to={`/bioengine/worker-admin${search}`} replace />;
};

// Add a utility function to check if footer should be hidden
const shouldHideFooter = (pathname: string): boolean => {
  return pathname.startsWith('/edit/') || pathname === '/upload' || pathname.startsWith('/colab/annotate');
};

// Hide the full navbar on the annotate page (it has its own compact header)
const shouldHideNavbar = (pathname: string): boolean => {
  return pathname.startsWith('/colab/annotate');
};

// Single globally-mounted error dialog, driven by the store. Any component can
// open it via useHyphaStore().showError(...). Mounted once at the layout root
// so a mutation failure surfaces the same way from every page.
const GlobalErrorDialog: React.FC = () => {
  const errorDialog = useHyphaStore(state => state.errorDialog);
  const clearError = useHyphaStore(state => state.clearError);
  return (
    <ErrorDialog
      open={errorDialog != null}
      title={errorDialog?.title ?? ''}
      subtitle={errorDialog?.subtitle}
      message={errorDialog?.message ?? ''}
      onClose={clearError}
    />
  );
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

  // Proactively recover the Hypha connection when the tab regains focus or the
  // network returns (events only, no heartbeat). Mounted once here so it runs
  // regardless of route.
  useConnectionLiveness();

  // Scroll to the top when the ROUTE changes, not on every location change.
  // Several pages keep UI state in the query string (the resource grid's
  // search, tags and partner filter; the BioEngine app selection), and
  // depending on `location` meant every one of those updates was treated as a
  // fresh page and yanked the user back to the top mid-selection.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex flex-col">
      <HyphaStatusBanner />
      <GlobalErrorDialog />
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
          <Route path="/bioengine/worker-setup" element={<BioEngineWorkerSetup />} />
          <Route path="/bioengine/worker-admin" element={<BioEngineWorkerAdmin />} />
          <Route path="/bioengine/apps" element={<BioEngineAppsPage />} />
          <Route path="/bioengine/token" element={<BioEngineTokenPage />} />
          {/* The worker dashboard moved under the admin route. Redirect rather
              than drop it: dashboard URLs carry `?service_id=` and get shared,
              so the query string has to survive the move. */}
          <Route path="/bioengine/worker" element={<BioEngineWorkerRedirect />} />
          <Route path="/colab/*" element={<ColabPage />} />
          <Route path="/campaigns/*" element={<CampaignsPage />} />
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
