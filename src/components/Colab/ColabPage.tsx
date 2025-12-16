import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
  const location = useLocation();

  // Parse sessionId from path: /colab/bioimage-io/cold-badger-tick-roughly -> bioimage-io/cold-badger-tick-roughly
  const sessionId = location.pathname.startsWith('/colab/')
    ? location.pathname.slice('/colab/'.length) || undefined
    : undefined;

  const { user, server, artifactManager } = useHyphaStore();
  const { isReady, kernelStatus, executeCode, mountDirectory, syncFileSystem, writeFilesToPyodide } = useColabKernel();

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
  const [resumeArtifactId, setResumeArtifactId] = useState<string | null>(null);

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

  // Track if we've already loaded the session from URL
  const [hasLoadedUrlSession, setHasLoadedUrlSession] = useState(false);

  // Handle session ID from URL path parameter - auto-load without showing modal
  useEffect(() => {
    if (sessionId && isReady && user?.email && artifactManager && executeCode && !hasLoadedUrlSession) {
      console.log('Auto-loading session from URL:', sessionId);
      setHasLoadedUrlSession(true);
      setResumeArtifactId(sessionId);

      // Auto-start the session without showing modal
      const autoStartSession = async () => {
        try {
          setIsRunning(true);

          const token = localStorage.getItem('token') || '';
          const serverUrl = server.config.publicBaseUrl;

          // Install Python packages
          console.log('Installing Python packages...');
          const installCode = `
import micropip
await micropip.install(['numpy', 'Pillow', 'hypha-rpc', 'kaibu-utils==0.1.14', 'tifffile==2024.7.24'])
print("Packages installed", end='')
`;

          let hasError = false;
          await executeCode(installCode, {
            onOutput: (output: any) => {
              if (output.type === 'error') hasError = true;
            },
          });

          if (hasError) throw new Error('Failed to install Python packages');

          // Load service code
          console.log('Loading service code...');
          const serviceCodeResponse = await fetch(`${process.env.PUBLIC_URL}/colab_service.py`);
          const serviceCode = await serviceCodeResponse.text();
          await executeCode(serviceCode, {
            onOutput: (output: any) => {
              if (output.type === 'error') hasError = true;
            },
          });

          if (hasError) throw new Error('Failed to load service code');

          // Get artifact info to determine label
          // If sessionId contains '/', it's an absolute artifact ID (workspace/alias)
          // If not, it's a relative alias from user's own workspace
          const fullArtifactId = sessionId.includes('/')
            ? sessionId
            : `${server.config.workspace}/${sessionId}`;
          const artifact = await artifactManager.read({ artifact_id: fullArtifactId, stage: true, _rkwargs: true });
          const labels = artifact.manifest?.labels || [];
          const sessionLabel = labels[0] || 'cells';

          let sessionName = artifact.manifest?.name || 'Annotation Session';
          if (sessionName.startsWith('Annotation Session ')) {
            sessionName = sessionName.substring('Annotation Session '.length);
          }

          // Check if this was a lazy_upload session and if images exist
          const dataSource = artifact.manifest?.data_source;
          if (dataSource === 'lazy_upload') {
            // Check if images have been uploaded
            try {
              const imageFiles = await artifactManager.list_files({
                artifact_id: fullArtifactId,
                dir_path: 'input_images',
                _rkwargs: true
              });
              if (!imageFiles || imageFiles.length === 0) {
                throw new Error(
                  'This session was created with "Mount Local Folder" mode and no images have been uploaded to the cloud yet. ' +
                  'Please go back to the original browser where the session was created, click "Upload All" to upload images, ' +
                  'then you can share this session URL.'
                );
              }
              console.log(`Found ${imageFiles.length} images in artifact for lazy_upload session`);
            } catch (listError: any) {
              if (listError.message?.includes('Mount Local Folder')) {
                throw listError; // Re-throw our custom error
              }
              // Other errors - assume no images exist
              throw new Error(
                'This session was created with "Mount Local Folder" mode but no images are available in the cloud. ' +
                'Please use the Annotation URL from the original session to collaborate, or upload images first.'
              );
            }
          }

          // Register service
          const clientId = `colab-client-${Date.now()}`;
          const serviceId = `data-provider-${Date.now()}`;

          const registerCode = `
service_info = await register_service(
    server_url="${serverUrl}",
    token="${token}",
    name="${sessionName}",
    description="Resumed session",
    artifact_id="${fullArtifactId}",
    images_path=None,
    label="${sessionLabel}",
    client_id="${clientId}",
    service_id="${serviceId}",
)
print("Service registered successfully", end='')
`;

          await executeCode(registerCode, {
            onOutput: (output: any) => {
              if (output.type === 'error') hasError = true;
            },
          });

          if (hasError) throw new Error('Failed to register service');

          const fullServiceId = `${server.config.workspace}/${clientId}:${serviceId}`;

          // Generate annotation URL
          const pluginCommitHash = '6a18797';
          const pluginUrl = `https://raw.githubusercontent.com/bioimage-io/bioimageio-colab/${pluginCommitHash}/plugins/bioimageio-colab-annotator.imjoy.html`;
          const configStr = JSON.stringify({
            serverUrl: serverUrl,
            imageProviderId: fullServiceId,
            label: sessionLabel,
          });
          const encodedConfig = encodeURIComponent(configStr);
          const annotatorUrl = `https://imjoy.io/lite?plugin=${pluginUrl}&config=${encodedConfig}`;

          // Update state
          setAnnotationURL(annotatorUrl);
          setDataArtifactId(fullArtifactId);
          setLabel(sessionLabel);
          setSessionName(sessionName);
          setDataSourceType('resume');

          // Update URL to reflect the loaded session with full artifact ID
          navigate(`/colab/${fullArtifactId}`, { replace: true });

          console.log('✓ Session loaded from URL successfully!');
          setIsRunning(false);
        } catch (err) {
          console.error('Failed to auto-load session:', err);
          alert('Failed to load session: ' + (err as Error).message);
          setIsRunning(false);
          // Fallback: show modal for manual configuration
          setShowSessionModal(true);
        }
      };

      autoStartSession();
    }
  }, [sessionId, isReady, user?.email, artifactManager, executeCode, hasLoadedUrlSession, server]);

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

  // Load images from artifact for cloud-only mode (upload or resume without local folder)
  useEffect(() => {
    const loadImagesFromArtifact = async () => {
      if (dataArtifactId && !imageFolderHandle && artifactManager) {
        try {
          setIsLoadingImages(true);
          console.log('Loading images from artifact for cloud-only mode...');
          const files = await artifactManager.list_files({
            artifact_id: dataArtifactId,
            dir_path: 'input_images',
            _rkwargs: true
          });
          const imageNames = files.map((f: any) => f.name);
          setImageList(imageNames);
          console.log(`Loaded ${imageNames.length} images from artifact`);
        } catch (error) {
          console.error('Error loading images from artifact:', error);
          setImageList([]);
        } finally {
          setIsLoadingImages(false);
        }
      }
    };
    loadImagesFromArtifact();
  }, [dataArtifactId, imageFolderHandle, artifactManager]);

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
    if (!server || !annotationURL) {
      console.error('Missing required dependencies for upload');
      return;
    }

    try {
      console.log(`Uploading ${imageList.length} images to cloud...`);

      // Extract service ID from annotation URL
      const configMatch = annotationURL.match(/config=([^&]+)/);
      if (!configMatch) {
        throw new Error('Could not extract service ID from annotation URL');
      }
      const config = JSON.parse(decodeURIComponent(configMatch[1]));
      const serviceId = config.imageProviderId;

      // Get the data provider service
      const dataService = await server.getService(serviceId);

      // Call the service function to upload all local images
      const result = await dataService.upload_local_images_to_artifact();

      console.log(`Upload result: ${result.success}/${result.total} succeeded, ${result.failed} failed`);

      if (result.failed > 0) {
        console.error('Upload errors:', result.errors);
        alert(`Upload completed with ${result.failed} failure(s). Check console for details.`);
      } else {
        console.log('All images uploaded successfully. Session converted to cloud mode.');
      }

      // Update data source type to 'upload'
      setDataSourceType('upload');
    } catch (error) {
      console.error('Error during upload all:', error);
      alert('Failed to upload images. Check console for details.');
    }
  };

  const progressPercentage = annotationsList.length > 0 && imageList.length > 0
    ? Math.round((annotationsList.length / imageList.length) * 100)
    : 0;

  // Check if we're loading a session from URL
  const isLoadingSession = sessionId && (!isReady || !user?.email || !artifactManager);

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

        {/* Loading Session Overlay */}
        {isLoadingSession && (
          <div className="max-w-3xl mx-auto mb-6">
            <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200/60 rounded-xl p-6 shadow-md">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center flex-shrink-0 shadow-lg">
                  <div className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin"></div>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-purple-900 mb-2">Loading Session...</h3>
                  <p className="text-sm text-gray-700 mb-3">
                    Session ID: <code className="bg-white/60 px-2 py-0.5 rounded text-xs font-mono">{sessionId}</code>
                  </p>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex items-center gap-2">
                      {kernelStatus === 'idle' ? (
                        <span className="text-emerald-600">✓ Python kernel ready</span>
                      ) : kernelStatus === 'starting' ? (
                        <span className="text-blue-600">⏳ Starting Python kernel...</span>
                      ) : (
                        <span className="text-gray-600">○ Python kernel</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {user?.email ? (
                        <span className="text-emerald-600">✓ User logged in</span>
                      ) : (
                        <span className="text-amber-600">⏳ Please log in...</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {artifactManager ? (
                        <span className="text-emerald-600">✓ Artifact manager connected</span>
                      ) : (
                        <span className="text-blue-600">⏳ Connecting to server...</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Login Info - Vibrant */}
        {!user?.email && !isLoadingSession && (
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
              annotationURL={annotationURL}
              server={server}
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
          writeFilesToPyodide={writeFilesToPyodide}
          setAnnotationURL={setAnnotationURL}
          setDataArtifactId={setDataArtifactId}
          setSessionLabel={setLabel}
          setSessionName={setSessionName}
          setDataSourceType={setDataSourceType}
          setImageFolderHandle={setImageFolderHandle}
          onSessionCreated={(artifactId) => {
            // Update URL to reflect the created session
            navigate(`/colab/${artifactId}`, { replace: true });
          }}
          server={server}
          user={user}
          artifactManager={artifactManager}
          resumeArtifactId={resumeArtifactId}
        />
      )}

      {showShareModal && annotationURL && (
        <ShareModal
          annotationURL={annotationURL}
          label={label}
          dataArtifactId={dataArtifactId}
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
          dataArtifactId={dataArtifactId}
          label={label}
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
