import React, { useState } from 'react';
import { useLocation, Routes, Route } from 'react-router-dom';
import { useHyphaStore } from '../../store/hyphaStore';
import { KernelProvider, useSharedKernel } from './KernelContext';
import ColabGuide from './ColabGuide';
import DatasetList from './DatasetList';
import DatasetOverview from './DatasetOverview';
import TrainingPage from '../../pages/TrainingPage';
import AnnotatePage from '../../pages/AnnotatePage';
import LoginButton from '../LoginButton';
import { SUPPORTED_IMAGE_EXTENSIONS } from './imageFormats';
import { toArtifactId } from './datasetApi';

const ColabPageContent: React.FC = () => {
  const location = useLocation();

  // Parse sessionId from path: /colab/cold-badger-tick-roughly -> cold-badger-tick-roughly
  // (old bookmarked /colab/bioimage-io/<alias> links still parse fine, since
  // toArtifactId() below passes an already-qualified id through unchanged).
  const sessionId = location.pathname.startsWith('/colab/')
    ? location.pathname.slice('/colab/'.length) || undefined
    : undefined;

  const { user, server, artifactManager } = useHyphaStore();
  const { kernelStatus } = useSharedKernel();

  const [showLoginRequiredDialog, setShowLoginRequiredDialog] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);

  const supportedFileTypes = SUPPORTED_IMAGE_EXTENSIONS;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-purple-50/30 to-blue-50/30">
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        {/* Vibrant Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex-1" />
            {!sessionId && (
              <div className="text-center">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 bg-clip-text text-transparent tracking-tight mb-1">
                  BioImage.IO Colab
                </h1>
                <p className="text-sm text-gray-600">
                  Collaborative Image Annotation Platform
                </p>
              </div>
            )}
            {/* Kernel Status */}
            <div className="flex-1 flex justify-end items-center gap-3">
              <button
                onClick={() => setShowGuideModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-purple-200 bg-white/80 text-purple-700 text-xs font-medium hover:bg-purple-50 transition-colors shadow-sm"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Guide
              </button>
              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border shadow-sm transition-all ${
                kernelStatus === 'idle' ? 'bg-emerald-50 border-emerald-200' :
                kernelStatus === 'busy' ? 'bg-amber-50 border-amber-200' :
                kernelStatus === 'starting' ? 'bg-blue-50 border-blue-200' :
                'bg-red-50 border-red-200'
              }`}>
                <div className={`w-2 h-2 rounded-full ${
                  kernelStatus === 'idle' ? 'bg-emerald-500 shadow-emerald-500/50 shadow-sm' :
                  kernelStatus === 'busy' ? 'bg-amber-500 animate-pulse shadow-amber-500/50 shadow-sm' :
                  kernelStatus === 'starting' ? 'bg-blue-500 animate-pulse shadow-blue-500/50 shadow-sm' :
                  'bg-red-500 shadow-red-500/50 shadow-sm'
                }`} />
                <span className={`text-xs font-medium ${
                  kernelStatus === 'idle' ? 'text-emerald-700' :
                  kernelStatus === 'busy' ? 'text-amber-700' :
                  kernelStatus === 'starting' ? 'text-blue-700' :
                  'text-red-700'
                }`}>
                  {kernelStatus === 'idle' ? 'Ready' :
                   kernelStatus === 'busy' ? 'Busy' :
                   kernelStatus === 'starting' ? 'Starting...' :
                   'Error'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Login Info - Vibrant */}
        {!user?.email && (
          <div className="max-w-3xl mx-auto mb-6">
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/60 rounded-xl p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center flex-shrink-0 shadow-md">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-sm text-gray-700">
                    <strong className="font-semibold text-blue-900">Login required</strong> to create annotation sessions, collaborate, and train AI models.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div className="max-w-7xl mx-auto min-h-[600px]">
          {sessionId ? (
            server ? (
              <DatasetOverview
                artifactId={toArtifactId(sessionId)}
                server={server}
                user={user}
                artifactManager={artifactManager}
                initialFolderHandle={(location.state as any)?.folderHandle}
              />
            ) : (
              <div className="flex items-center justify-center h-64">
                <svg className="w-8 h-8 animate-spin text-purple-600" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              </div>
            )
          ) : (
            <DatasetList
              user={user}
              server={server}
              artifactManager={artifactManager}
              onRequireLogin={() => setShowLoginRequiredDialog(true)}
            />
          )}
        </div>

        {/* Modals */}
        {showLoginRequiredDialog && (
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
            onClick={() => setShowLoginRequiredDialog(false)}
          >
            <div
              className="bg-white rounded-2xl shadow-lg max-w-md w-full mx-4 p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center flex-shrink-0 shadow-md">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-semibold text-gray-900">Log in to continue</h2>
                  <p className="text-sm text-gray-600 mt-1">
                    You need to be logged in to create or resume an annotation session.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowLoginRequiredDialog(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <LoginButton />
              </div>
            </div>
          </div>
        )}

        {showGuideModal && (
          <ColabGuide
            supportedFileTypes={supportedFileTypes}
            onClose={() => setShowGuideModal(false)}
          />
        )}
      </div>
    </div>
  );
};

// Wrapper component that handles routing and kernel provider
const ColabPage: React.FC = () => {
  const location = useLocation();
  const isTrainingRoute = location.pathname.startsWith('/colab/training');
  const isAnnotateRoute = location.pathname.startsWith('/colab/annotate');

  // Keep one shared kernel provider mounted for all /colab routes so
  // navigating to training and back preserves the running kernel.
  return (
    <KernelProvider>
      {isTrainingRoute ? (
        <Routes>
          <Route path="training" element={<TrainingPage />} />
          <Route path="training/:sessionId" element={<TrainingPage />} />
        </Routes>
      ) : isAnnotateRoute ? (
        <AnnotatePage backTo="/colab" />
      ) : (
        <ColabPageContent />
      )}
    </KernelProvider>
  );
};

export default ColabPage;
