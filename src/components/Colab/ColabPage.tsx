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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-purple-50/30 to-blue-50/30">
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        {/* Vibrant Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex-1" />
            <div className="text-center">
              <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 bg-clip-text text-transparent tracking-tight mb-1">
                BioImage.IO Colab
              </h1>
              <p className="text-sm text-gray-600">
                Collaborative Image Annotation Platform
              </p>
            </div>
            {/* Kernel Status */}
            <div className="flex-1 flex justify-end">
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

        {/* Workflow Steps - Vibrant & Dynamic */}
        <div className="max-w-4xl mx-auto mb-8">
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/60 shadow-md p-6">
            <div className="grid grid-cols-3 gap-4">
              {/* Step 1 */}
              <button
                onClick={createAnnotationSession}
                disabled={!isReady || !user?.email}
                className={`group text-left p-4 rounded-xl border-2 transition-all duration-200 ${
                  isReady && user?.email
                    ? 'border-purple-200/60 hover:border-purple-400 hover:shadow-lg hover:shadow-purple-100 bg-gradient-to-br from-white to-purple-50/30'
                    : 'border-gray-100 bg-gray-50/50 cursor-not-allowed opacity-60'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-semibold transition-all ${
                    isReady && user?.email
                      ? 'bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-md group-hover:shadow-lg group-hover:scale-110'
                      : 'bg-gray-200 text-gray-500'
                  }`}>
                    1
                  </div>
                  <h3 className="font-semibold text-gray-900">Start Session</h3>
                </div>
                <p className="text-sm text-gray-600">
                  Create or resume an annotation session
                </p>
              </button>

              {/* Step 2 */}
              <button
                onClick={() => setShowShareModal(true)}
                disabled={!annotationURL || !user?.email}
                className={`group text-left p-4 rounded-xl border-2 transition-all duration-200 ${
                  annotationURL && user?.email
                    ? 'border-purple-200/60 hover:border-purple-400 hover:shadow-lg hover:shadow-purple-100 bg-gradient-to-br from-white to-purple-50/30'
                    : 'border-gray-100 bg-gray-50/50 cursor-not-allowed opacity-60'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-semibold transition-all ${
                    annotationURL && user?.email
                      ? 'bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-md group-hover:shadow-lg group-hover:scale-110'
                      : 'bg-gray-200 text-gray-500'
                  }`}>
                    2
                  </div>
                  <h3 className="font-semibold text-gray-900">Collaborate</h3>
                </div>
                <p className="text-sm text-gray-600">
                  Share URL and annotate together
                </p>
              </button>

              {/* Step 3 */}
              <button
                onClick={() => setShowTrainingModal(true)}
                disabled={!dataArtifactId || !user?.email}
                className={`group text-left p-4 rounded-xl border-2 transition-all duration-200 ${
                  dataArtifactId && user?.email
                    ? 'border-blue-200/60 hover:border-blue-400 hover:shadow-lg hover:shadow-blue-100 bg-gradient-to-br from-white to-blue-50/30'
                    : 'border-gray-100 bg-gray-50/50 cursor-not-allowed opacity-60'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-semibold transition-all ${
                    dataArtifactId && user?.email
                      ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md group-hover:shadow-lg group-hover:scale-110'
                      : 'bg-gray-200 text-gray-500'
                  }`}>
                    3
                  </div>
                  <h3 className="font-semibold text-gray-900">Train Model</h3>
                </div>
                <p className="text-sm text-gray-600">
                  Train AI on your annotations
                </p>
              </button>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="max-w-7xl mx-auto h-[600px]" ref={servicesRef}>
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
            <div className="h-full bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/60 shadow-md flex flex-col overflow-hidden">
              {/* Empty State */}
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-purple-100 via-pink-100 to-blue-100 flex items-center justify-center mb-6 shadow-lg">
                  <svg className="w-12 h-12 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-2xl font-semibold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent mb-2">
                  No Active Session
                </h3>
                <p className="text-gray-600 mb-8 max-w-md">
                  Click "Start Session" above to create a new annotation session or resume an existing one.
                </p>

                {/* Guide Link */}
                <button
                  onClick={() => setShowGuideModal(true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 rounded-lg transition-all shadow-md hover:shadow-lg hover:scale-105"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Learn how it works
                </button>
              </div>

              {/* Footer Feature List */}
              <div className="border-t border-gray-200/60 bg-gradient-to-r from-gray-50 to-purple-50/30 px-8 py-4">
                <div className="flex items-center justify-center gap-8 text-sm">
                  <div className="flex items-center gap-2 text-purple-600">
                    <div className="w-6 h-6 rounded-lg bg-purple-100 flex items-center justify-center">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <span className="font-medium">Collaborative</span>
                  </div>
                  <div className="flex items-center gap-2 text-pink-600">
                    <div className="w-6 h-6 rounded-lg bg-pink-100 flex items-center justify-center">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    </div>
                    <span className="font-medium">AI-Powered</span>
                  </div>
                  <div className="flex items-center gap-2 text-blue-600">
                    <div className="w-6 h-6 rounded-lg bg-blue-100 flex items-center justify-center">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </div>
                    <span className="font-medium">Browser-Based</span>
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
    </div>
  );
};

export default ColabPage;
