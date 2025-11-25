import React, { useState, useEffect, useRef } from 'react';
import { useHyphaStore } from '../../store/hyphaStore';
import { useColabKernel } from './useColabKernel';
import ColabGuide from './ColabGuide';
import SessionModal from './SessionModal';
import ShareModal from './ShareModal';

const ColabPage: React.FC = () => {
  const { user, server, artifactManager } = useHyphaStore();
  const { isReady, kernelStatus, executeCode, mountDirectory, syncFileSystem } = useColabKernel();

  // File system state
  const [imageFolderHandle, setImageFolderHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [imageList, setImageList] = useState<string[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [annotationsFolderHandle, setAnnotationsFolderHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [annotationsList, setAnnotationsList] = useState<string[]>([]);
  const [isLoadingAnnotations, setIsLoadingAnnotations] = useState(false);

  // Session state
  const [isRunning, setIsRunning] = useState(false);
  const [annotationURL, setAnnotationURL] = useState('');
  const [dataArtifactId, setDataArtifactId] = useState<string | null>(null);
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  // Supported file types
  const [supportedFileTypes, setSupportedFileTypes] = useState<string[]>([]);

  useEffect(() => {
    const loadSupportedTypes = async () => {
      try {
        const response = await fetch(`${process.env.PUBLIC_URL}/colab_service.py`);
        const text = await response.text();
        const match = text.match(/class ImageFormat\(str, Enum\):([\s\S]*?)(?=\n\n|\n[a-zA-Z])/);
        if (match) {
          const enumContent = match[1];
          const typeMatches = enumContent.matchAll(/=\s*"([^"]+)"/g);
          const types = Array.from(typeMatches).map(m => '.' + m[1]);
          setSupportedFileTypes(types);
        } else {
          throw new Error('Could not find ImageFormat enum in colab_service.py');
        }
      } catch (error) {
        console.error('Failed to load supported file types:', error);
        alert('Failed to load supported file types: ' + (error as Error).message);
      }
    };
    loadSupportedTypes();
  }, []);

  const servicesRef = useRef<HTMLDivElement>(null);

  // Mount local folder
  const mountFolder = async () => {
    try {
      const dirHandle = await (window as any).showDirectoryPicker();
      setImageFolderHandle(dirHandle);
    } catch (error) {
      // User cancelled the picker - this is normal, don't show error
      if ((error as Error).name === 'AbortError') {
        console.log('User cancelled folder selection');
        return;
      }
      // Show error for other types of errors
      console.error('Error accessing folder:', error);
      alert('An error occurred while accessing the folder: ' + (error as Error).message);
    }
  };

  // Update file list
  const updateFileList = async (
    dirHandle: FileSystemDirectoryHandle,
    setFileList: React.Dispatch<React.SetStateAction<string[]>>,
    setLoading: React.Dispatch<React.SetStateAction<boolean>>
  ) => {
    setLoading(true);
    try {
      const files: string[] = [];
      for await (const entry of (dirHandle as any).values()) {
        if (entry.kind === 'file') {
          const fileType = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
          if (supportedFileTypes.includes(fileType)) {
            files.push(entry.name);
          }
        }
      }
      setFileList(files.sort());
    } catch (error) {
      console.error('Error updating file list:', error);
    } finally {
      setLoading(false);
    }
  };

  // Update images when folder is mounted
  useEffect(() => {
    if (imageFolderHandle && supportedFileTypes.length > 0) {
      updateFileList(imageFolderHandle, setImageList, setIsLoadingImages);
      setAnnotationsFolderHandle(null);
      setAnnotationsList([]);
      setAnnotationURL('');
      setDataArtifactId(null);
      // Clear any existing refresh interval when changing folders
      const refreshInterval = (window as any).__colabRefreshInterval;
      if (refreshInterval) {
        clearInterval(refreshInterval);
        (window as any).__colabRefreshInterval = null;
      }
    }
  }, [imageFolderHandle, supportedFileTypes]);

  // Cleanup refresh interval on unmount
  useEffect(() => {
    return () => {
      const refreshInterval = (window as any).__colabRefreshInterval;
      if (refreshInterval) {
        clearInterval(refreshInterval);
        (window as any).__colabRefreshInterval = null;
      }
    };
  }, []);

  const updateImages = async () => {
    if (imageFolderHandle) {
      await updateFileList(imageFolderHandle, setImageList, setIsLoadingImages);
    }
  };

  const updateAnnotations = async () => {
    if (annotationsFolderHandle) {
      // First sync filesystem from Python VFS to native browser filesystem
      if (syncFileSystem) {
        console.log('[Manual Refresh] Syncing filesystem...');
        const syncResult = await syncFileSystem('/mnt');
        if (syncResult.success) {
          console.log('[Manual Refresh] FileSystem synced');
        }
      }
      // Then update the file list
      await updateFileList(annotationsFolderHandle, setAnnotationsList, setIsLoadingAnnotations);
    } else if (dataArtifactId && artifactManager) {
      setIsLoadingAnnotations(true);
      try {
        const files = await artifactManager.list_files(dataArtifactId, "annotations");
        const fileNames = files.map((f: any) => f.name).sort();
        setAnnotationsList(fileNames);
      } catch (error) {
        console.error('Error refreshing remote annotations:', error);
      } finally {
        setIsLoadingAnnotations(false);
      }
    }
  };

  // Poll for remote annotations
  useEffect(() => {
    if (!dataArtifactId || !artifactManager) return;

    const fetchRemoteAnnotations = async () => {
      try {
        const files = await artifactManager.list_files(dataArtifactId, "annotations");
        const fileNames = files.map((f: any) => f.name).sort();
        setAnnotationsList(fileNames);
      } catch (error) {
        console.error('Error fetching remote annotations:', error);
      }
    };

    // Initial fetch
    fetchRemoteAnnotations();

    // Set up interval
    const intervalId = setInterval(fetchRemoteAnnotations, 2000);
    (window as any).__colabRefreshInterval = intervalId;

    return () => {
      clearInterval(intervalId);
      (window as any).__colabRefreshInterval = null;
    };
  }, [dataArtifactId, artifactManager]);

  const createAnnotationSession = () => {
    if (!user?.email) {
      alert('Please login first');
      return;
    }
    if (!isReady) {
      alert('Python kernel is still initializing. Please wait...');
      return;
    }
    setShowSessionModal(true);
  };

  const progressPercentage = annotationsList.length > 0 && imageList.length > 0
    ? Math.round((annotationsList.length / imageList.length) * 100)
    : 0;

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-12">
        <div className="flex items-center justify-center gap-4 mb-4">
          <div className="w-12 h-12 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </div>
          <h1 className="text-5xl font-bold bg-gradient-to-r from-purple-600 via-pink-600 to-orange-600 bg-clip-text text-transparent leading-tight">
            BioImage.IO Colab
          </h1>
        </div>
        <div className="w-24 h-1 bg-gradient-to-r from-purple-500 to-pink-500 mx-auto mt-4 rounded-full"></div>
        <p className="mt-4 text-xl text-gray-600 font-medium">
          Collaborative Image Annotation Platform
        </p>
      </div>

      {/* Kernel Status Indicator */}
      <div className="max-w-6xl mx-auto mb-6">
        <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-sm border border-white/20 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className={`w-3 h-3 rounded-full mr-3 ${
                kernelStatus === 'idle' ? 'bg-green-500' :
                kernelStatus === 'busy' ? 'bg-yellow-500 animate-pulse' :
                kernelStatus === 'starting' ? 'bg-blue-500 animate-pulse' :
                'bg-red-500'
              }`}></div>
              <span className="text-sm font-medium text-gray-700">
                Python Kernel: {kernelStatus === 'idle' ? 'Ready' :
                              kernelStatus === 'busy' ? 'Busy' :
                              kernelStatus === 'starting' ? 'Starting...' :
                              'Error'}
              </span>
            </div>
            {kernelStatus === 'starting' && (
              <div className="text-sm text-gray-500 animate-pulse">
                Initializing Python environment...
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Guide Section */}
      <div className="max-w-6xl mx-auto mb-8">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20 p-6 hover:shadow-md transition-all duration-200">
          <ColabGuide supportedFileTypes={supportedFileTypes} />
        </div>
      </div>

      {/* Action Steps */}
      <div className="max-w-6xl mx-auto mb-8">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/20 p-6">
          <div className="flex items-center mb-6 flex-wrap gap-4">
            <div className="flex items-center">
              <div className="text-xl font-semibold mr-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white w-8 h-8 rounded-full flex items-center justify-center">
                1
              </div>
              <button
                onClick={mountFolder}
                disabled={!isReady}
                className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 shadow-sm hover:shadow-md transition-all duration-200 font-medium disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed"
              >
                <svg className="w-5 h-5 inline-block mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                Mount Local Folder
              </button>
            </div>

            <span className="mx-2 text-xl text-gray-400">→</span>

            <div className="flex items-center">
              <div className="text-xl font-semibold mr-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white w-8 h-8 rounded-full flex items-center justify-center">
                2
              </div>
              <button
                onClick={createAnnotationSession}
                disabled={imageList.length === 0 || !isReady}
                className={`px-6 py-3 ${
                  imageList.length > 0 && isReady
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700'
                    : 'bg-gray-400 cursor-not-allowed'
                } text-white rounded-xl shadow-sm hover:shadow-md transition-all duration-200 font-medium`}
              >
                <svg className="w-5 h-5 inline-block mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                Create Annotation Session
              </button>
            </div>

            <span className="mx-2 text-xl text-gray-400">→</span>

            <div className="flex items-center">
              <div className="text-xl font-semibold mr-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white w-8 h-8 rounded-full flex items-center justify-center">
                3
              </div>
              <button
                onClick={() => setShowShareModal(true)}
                disabled={!annotationURL}
                className={`px-6 py-3 ${
                  annotationURL
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700'
                    : 'bg-gray-400 cursor-not-allowed'
                } text-white rounded-xl shadow-sm hover:shadow-md transition-all duration-200 font-medium`}
              >
                <svg className="w-5 h-5 inline-block mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                Share Annotation URL
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Files Display */}
      {imageFolderHandle && (
        <div className="max-w-6xl mx-auto mb-8" ref={servicesRef}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Images Panel */}
            <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-2xl shadow-sm border border-white/20 p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-gray-800 flex items-center">
                  <svg className="w-6 h-6 mr-2 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Images ({imageList.length})
                </h2>
                <button
                  onClick={updateImages}
                  className="p-2 text-purple-600 hover:bg-purple-100 rounded-lg transition-colors"
                  title="Refresh images"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
              <div className="bg-white/50 rounded-xl p-4 max-h-96 overflow-y-auto">
                {isLoadingImages ? (
                  <div className="flex justify-center items-center h-32">
                    <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                ) : imageList.length > 0 ? (
                  <ul className="space-y-2">
                    {imageList.map((file, index) => (
                      <li key={index} className="flex items-center text-gray-700 text-sm">
                        <svg className="w-4 h-4 mr-2 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {file}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-gray-500 text-center py-8">No images found</p>
                )}
              </div>
            </div>

            {/* Annotations Panel */}
            {(annotationsFolderHandle || dataArtifactId) && (
              <div className="bg-gradient-to-br from-green-50 to-teal-50 rounded-2xl shadow-sm border border-white/20 p-6">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-800 flex items-center">
                      <svg className="w-6 h-6 mr-2 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Annotations ({annotationsList.length})
                    </h2>
                    {dataArtifactId && (
                      <div className="text-xs text-gray-500 mt-1 ml-8">
                        Artifact ID: <span className="font-mono select-all">{dataArtifactId}</span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={updateAnnotations}
                    className="p-2 text-green-600 hover:bg-green-100 rounded-lg transition-colors"
                    title="Refresh annotations"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                </div>
                <div className="bg-white/50 rounded-xl p-4 max-h-96 overflow-y-auto">
                  {isLoadingAnnotations ? (
                    <div className="flex justify-center items-center h-32">
                      <div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  ) : annotationsList.length > 0 ? (
                    <ul className="space-y-2">
                      {annotationsList.map((file, index) => (
                        <li key={index} className="flex items-center text-gray-700 text-sm">
                          <svg className="w-4 h-4 mr-2 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          {file}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-gray-500 text-center py-8">No annotations yet</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Progress Bar */}
          {(annotationsFolderHandle || dataArtifactId) && imageList.length > 0 && (
            <div className="mt-6">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-gray-700">
                  Progress: {annotationsList.length} / {imageList.length} images annotated
                </span>
                <span className="text-sm font-semibold text-purple-600">
                  {progressPercentage}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-gradient-to-r from-purple-500 to-pink-500 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercentage}%` }}
                ></div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading Overlay */}
      {isRunning && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 flex flex-col items-center">
            <div className="w-16 h-16 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-gray-700 font-medium">Setting up annotation session...</p>
          </div>
        </div>
      )}

      {/* Modals */}
      {showSessionModal && (
        <SessionModal
          setShowSessionModal={setShowSessionModal}
          imageFolderHandle={imageFolderHandle}
          setIsRunning={setIsRunning}
          executeCode={executeCode}
          mountDirectory={mountDirectory}
          setAnnotationURL={setAnnotationURL}
          setDataArtifactId={setDataArtifactId}
          server={server}
          user={user}
          artifactManager={artifactManager}
        />
      )}

      {showShareModal && annotationURL && (
        <ShareModal
          annotationURL={annotationURL}
          setShowShareModal={setShowShareModal}
        />
      )}
    </div>
  );
};

export default ColabPage;
