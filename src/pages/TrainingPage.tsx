import React, { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import Training from '../components/Colab/Training';
import { useHyphaStore } from '../store/hyphaStore';

const TrainingPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { server, isConnected, isConnecting } = useHyphaStore();
  const [error, setError] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Get data from navigation state (when redirected from ColabPage)
  const locationState = location.state as any;
  const dataArtifactId = locationState?.dataArtifactId;
  const label = locationState?.label;

  // Use the global connection state from hyphaStore (managed by LoginButton)
  useEffect(() => {
    let cancelled = false;

    if (isConnected && server) {
      if (!cancelled) {
        setAuthChecked(true);
        setError(null);
      }
    } else if (!isConnecting) {
      // If we are not connecting and not connected, maybe there is no token or we failed
      // We will just let LoginButton handle the auto login. If it doesn't connect soon, 
      // we can consider auth checked (as not logged in).
      const token = localStorage.getItem('token');
      if (!token) {
        if (!cancelled) setAuthChecked(true);
      } else {
        // give LoginButton some time to process
        const timer = setTimeout(() => {
          if (!cancelled) setAuthChecked(true);
        }, 2000);
        return () => clearTimeout(timer);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [isConnected, isConnecting, server]);


  // After auth check completes, show connection error only if still disconnected.
  useEffect(() => {
    if (!authChecked || isConnecting) {
      return;
    }
    if (!isConnected || !server) {
      setError('Not connected to Hypha server. Please go back and ensure you are logged in.');
    } else {
      setError(null);
    }
  }, [authChecked, isConnecting, isConnected, server]);

  if (!authChecked || isConnecting) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-purple-50/30 to-blue-50/30 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-md border border-blue-200 p-8 max-w-md w-full text-center">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Restoring Session</h2>
          <p className="text-sm text-gray-600">Reconnecting to Hypha...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-purple-50/30 to-blue-50/30 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-md border border-red-200 p-8 max-w-md">
          <div className="flex items-center text-red-700 mb-4">
            <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h2 className="text-xl font-semibold">Connection Error</h2>
          </div>
          <p className="text-gray-700 mb-4">{error}</p>
          <button
            onClick={() => navigate('/colab')}
            className="w-full px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700"
          >
            Go Back to Colab
          </button>
        </div>
      </div>
    );
  }

  if (!server) {
    return null;
  }

  // If no session ID and no data artifact, redirect to colab page
  if (!sessionId && !dataArtifactId) {
    navigate('/colab');
    return null;
  }

  return (
    <Training
      sessionId={sessionId}
      dataArtifactId={dataArtifactId}
      label={label}
      server={server}
    />
  );
};

export default TrainingPage;
