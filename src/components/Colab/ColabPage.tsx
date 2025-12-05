import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHyphaStore } from '../../store/hyphaStore';
import { useColabKernel } from './useColabKernel';
import ColabGuide from './ColabGuide';
import SessionModal from './SessionModal';
import ShareModal from './ShareModal';
import DeleteArtifactModal from './DeleteArtifactModal';
import TrainingModal from './TrainingModal';
import ImageViewer from './ImageViewer';

const ColabPage: React.FC = () => {
  const navigate = useNavigate();
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
  const [label, setLabel] = useState<string>('');
  const [sessionName, setSessionName] = useState<string>('');
  const [dataSourceType, setDataSourceType] = useState<'local' | 'upload' | 'resume'>('upload');
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showTrainingModal, setShowTrainingModal] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);

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

  // Update images when folder is mounted (for local mode only)
  useEffect(() => {
    if (imageFolderHandle && supportedFileTypes.length > 0) {
      updateFileList(imageFolderHandle, setImageList, setIsLoadingImages);
      // Note: Don't clear annotationURL/dataArtifactId here anymore
      // as they're managed by the session modal
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
        const dirPath = label ? `masks_${label}` : "annotations";
        const files = await artifactManager.list_files({
            artifact_id: dataArtifactId,
            dir_path: dirPath,
            _rkwargs: true
        });
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
        const dirPath = label ? `masks_${label}` : "annotations";
        const files = await artifactManager.list_files({
            artifact_id: dataArtifactId,
            dir_path: dirPath,
            _rkwargs: true
        });
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
  }, [dataArtifactId, artifactManager, label]);

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

  const handleDeleteSuccess = () => {
    setDataArtifactId(null);
    setAnnotationsList([]);
    setAnnotationURL('');
    setLabel('');
  };

  const handleUploadAll = async () => {
    if (!imageFolderHandle || !executeCode || !dataArtifactId || !artifactManager) {
      console.error('Missing required dependencies for upload');
      return;
    }

    try {
      console.log(`Uploading ${imageList.length} images to cloud...`);

      for (let i = 0; i < imageList.length; i++) {
        const imageName = imageList[i];
        const baseName = imageName.substring(0, imageName.lastIndexOf('.')) || imageName;

        try {
          // Read file from local folder
          const fileHandle = await imageFolderHandle.getFileHandle(imageName);
          const file = await fileHandle.getFile();
          const arrayBuffer = await file.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          const base64 = btoa(String.fromCharCode(...Array.from(uint8Array)));

          // Convert to PNG via Python
          const convertCode = `
from PIL import Image
import io
import base64

try:
    input_data = base64.b64decode('${base64}')
    img = Image.open(io.BytesIO(input_data))

    # Convert to RGB if needed
    if img.mode != 'RGB':
        if img.mode == 'RGBA':
            background = Image.new('RGB', img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[3] if img.mode == 'RGBA' else None)
            img = background
        else:
            img = img.convert('RGB')

    # Save as PNG
    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    png_bytes = buffer.getvalue()
    print(base64.b64encode(png_bytes).decode('ascii'), end='')
except Exception as e:
    print(f"ERROR: {e}")
`;

          let pngBase64 = '';
          await executeCode(convertCode, {
            onOutput: (output: any) => {
              const trimmed = output.content?.trim() || '';
              if (trimmed && !trimmed.startsWith('ERROR:')) {
                pngBase64 = trimmed;
              }
            }
          });

          if (pngBase64) {
            // Upload to artifact
            const pngBuffer = Uint8Array.from(atob(pngBase64), c => c.charCodeAt(0));
            const blob = new Blob([pngBuffer], { type: 'image/png' });
            await artifactManager.put_file(
              `${dataArtifactId}/input_images/${baseName}.png`,
              blob
            );
            console.log(`Uploaded ${i + 1}/${imageList.length}: ${imageName}`);
          }
        } catch (error) {
          console.error(`Error uploading ${imageName}:`, error);
        }
      }

      // Update data source type to 'upload'
      setDataSourceType('upload');
      console.log('All images uploaded successfully. Session converted to cloud mode.');
    } catch (error) {
      console.error('Error during upload all:', error);
      alert('Failed to upload images. Check console for details.');
    }
  };

  const progressPercentage = annotationsList.length > 0 && imageList.length > 0
    ? Math.round((annotationsList.length / imageList.length) * 100)
    : 0;

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-4">
      {/* Header with Kernel Status */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex-1"></div>
          <div className="flex items-center justify-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 via-pink-600 to-orange-600 bg-clip-text text-transparent leading-tight">
              BioImage.IO Colab
            </h1>
          </div>
          {/* Kernel Status - Right Side */}
          <div className="flex-1 flex justify-end">
            <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-white/20 px-3 py-1.5">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  kernelStatus === 'idle' ? 'bg-green-500' :
                  kernelStatus === 'busy' ? 'bg-yellow-500 animate-pulse' :
                  kernelStatus === 'starting' ? 'bg-blue-500 animate-pulse' :
                  'bg-red-500'
                }`}></div>
                <span className="text-xs font-medium text-gray-700 whitespace-nowrap">
                  {kernelStatus === 'idle' ? 'Python: Ready' :
                   kernelStatus === 'busy' ? 'Python: Busy' :
                   kernelStatus === 'starting' ? 'Python: Starting...' :
                   'Python: Error'}
                </span>
              </div>
            </div>
          </div>
        </div>
        <p className="text-sm text-gray-600 font-medium text-center">
          Collaborative Image Annotation Platform
        </p>
      </div>

      {/* Login Required Info Box */}
      {!user?.email && (
        <div className="max-w-6xl mx-auto mb-3">
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg shadow-sm p-3">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-3 flex-1">
                <h3 className="text-sm font-semibold text-blue-900 mb-1">
                  Login Required
                </h3>
                <p className="text-xs text-blue-800 mb-1">
                  Please log in to start using BioImage.IO Colab. You need to authenticate to create annotation sessions, share work with collaborators, and train AI models.
                </p>
                <p className="text-xs text-blue-700">
                  Click the <strong>Login</strong> button in the navigation bar at the top of the page to get started.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Action Steps */}
      <div className="max-w-6xl mx-auto mb-4">
        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-white/20 p-4">
          <div className="flex items-center mb-4 flex-wrap gap-3">
            {/* Step 0 - Learn How It Works */}
            <div className="flex items-center">
              <div className="text-sm font-semibold mr-2 bg-gradient-to-r from-gray-500 to-gray-600 text-white w-6 h-6 rounded-full flex items-center justify-center">
                0
              </div>
              <button
                onClick={() => setShowGuideModal(true)}
                className="px-4 py-2 text-sm bg-gradient-to-r from-gray-500 to-gray-600 hover:from-gray-600 hover:to-gray-700 text-white rounded-lg shadow-sm hover:shadow-md transition-all duration-200 font-medium"
              >
                <svg className="w-4 h-4 inline-block mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Learn How It Works
              </button>
            </div>

            <span className="mx-1.5 text-lg text-gray-400">→</span>

            <div className="flex items-center">
              <div className="text-sm font-semibold mr-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white w-6 h-6 rounded-full flex items-center justify-center">
                1
              </div>
              <button
                onClick={createAnnotationSession}
                disabled={!isReady || !user?.email}
                className={`px-4 py-2 text-sm ${
                  isReady && user?.email
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700'
                    : 'bg-gray-400 cursor-not-allowed'
                } text-white rounded-lg shadow-sm hover:shadow-md transition-all duration-200 font-medium`}
              >
                <svg className="w-4 h-4 inline-block mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                Start Annotation Session
              </button>
            </div>

            <span className="mx-1.5 text-lg text-gray-400">→</span>

            <div className="flex items-center">
              <div className="text-sm font-semibold mr-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white w-6 h-6 rounded-full flex items-center justify-center">
                2
              </div>
              <button
                onClick={() => setShowShareModal(true)}
                disabled={!annotationURL || !user?.email}
                className={`px-4 py-2 text-sm ${
                  annotationURL && user?.email
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700'
                    : 'bg-gray-400 cursor-not-allowed'
                } text-white rounded-lg shadow-sm hover:shadow-md transition-all duration-200 font-medium`}
              >
                <svg className="w-4 h-4 inline-block mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                Share Annotation URL
              </button>
            </div>

            <span className="mx-1.5 text-lg text-gray-400">→</span>

            <div className="flex items-center">
              <div className="text-sm font-semibold mr-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white w-6 h-6 rounded-full flex items-center justify-center">
                3
              </div>
              <button
                onClick={() => setShowTrainingModal(true)}
                disabled={!dataArtifactId || !user?.email}
                className={`px-4 py-2 text-sm ${
                  dataArtifactId && user?.email
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700'
                    : 'bg-gray-400 cursor-not-allowed'
                } text-white rounded-lg shadow-sm hover:shadow-md transition-all duration-200 font-medium`}
              >
                <svg className="w-4 h-4 inline-block mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Train AI Model
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Image Viewer or Placeholder */}
      <div className="max-w-7xl mx-auto mb-4 h-[600px]" ref={servicesRef}>
        {dataArtifactId ? (
          <ImageViewer
            imageList={imageList}
            annotationsList={annotationsList}
            dataArtifactId={dataArtifactId}
            label={label}
            artifactManager={artifactManager}
            serverUrl={server.config.publicBaseUrl}
            isLoadingImages={isLoadingImages}
            isLoadingAnnotations={isLoadingAnnotations}
            sessionName={sessionName}
            dataSourceType={dataSourceType}
            imageFolderHandle={imageFolderHandle}
            executeCode={executeCode}
            onDelete={() => setShowDeleteModal(true)}
            onUploadAll={handleUploadAll}
          />
        ) : (
          <div className="h-full bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg shadow-sm border border-gray-200 flex items-center justify-center">
            <div className="text-center max-w-md px-6">
              <div className="mb-6">
                <svg className="w-32 h-32 mx-auto text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={0.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-700 mb-2">Ready to Start Annotating</h3>
              <p className="text-gray-500 mb-6">
                Create an annotation session to begin working with your images. You can mount local folders, upload to the cloud, or resume an existing session.
              </p>
              <div className="flex flex-col gap-2 text-sm text-gray-600">
                <div className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Collaborative annotation with Kaibu</span>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>AI model training with Cellpose-SAM</span>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Secure cloud storage for annotations</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

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
          setIsRunning={setIsRunning}
          executeCode={executeCode}
          mountDirectory={mountDirectory}
          setAnnotationURL={setAnnotationURL}
          setDataArtifactId={setDataArtifactId}
          setSessionLabel={setLabel}
          setSessionName={setSessionName}
          setDataSourceType={setDataSourceType}
          setImageFolderHandle={setImageFolderHandle}
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

      {showDeleteModal && dataArtifactId && (
        <DeleteArtifactModal
          setShowDeleteModal={setShowDeleteModal}
          dataArtifactId={dataArtifactId}
          artifactManager={artifactManager}
          onDeleteSuccess={handleDeleteSuccess}
        />
      )}

      {showTrainingModal && (
        <TrainingModal
          setShowTrainingModal={setShowTrainingModal}
          imageFolderHandle={imageFolderHandle}
          annotationsFolderHandle={annotationsFolderHandle}
          dataArtifactId={dataArtifactId}
          label={label}
          setIsRunning={setIsRunning}
          executeCode={executeCode}
          artifactManager={artifactManager}
          server={server}
        />
      )}

      {showGuideModal && (
        <ColabGuide
          supportedFileTypes={supportedFileTypes}
          onClose={() => setShowGuideModal(false)}
        />
      )}
    </div>
  );
};

export default ColabPage;
