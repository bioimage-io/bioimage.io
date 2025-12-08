import React, { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import CellposeFinetune from '../components/Colab/CellposeFinetune';
import { useHyphaStore } from '../store/hyphaStore';

const FinetuneCellposePage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { server, isConnected } = useHyphaStore();
  const [error, setError] = useState<string | null>(null);

  // Get data from navigation state (when redirected from ColabPage)
  const locationState = location.state as any;
  const dataArtifactId = locationState?.dataArtifactId;
  const label = locationState?.label;

  // Check if we're connected
  useEffect(() => {
    if (!isConnected || !server) {
      setError('Not connected to Hypha server. Please go back and ensure you are logged in.');
    } else {
      setError(null);
    }
  }, [isConnected, server]);

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
    <CellposeFinetune
      sessionId={sessionId}
      dataArtifactId={dataArtifactId}
      label={label}
      server={server}
      onBack={() => navigate('/colab')}
    />
  );
};

export default FinetuneCellposePage;
