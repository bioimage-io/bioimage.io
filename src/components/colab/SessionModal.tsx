import React, { useState, useEffect } from 'react';

interface SessionModalProps {
  setShowSessionModal: (show: boolean) => void;
  setIsRunning: (running: boolean) => void;
  executeCode: ((code: string, callbacks?: any) => Promise<void>) | null;
  mountDirectory: ((mountPoint: string, dirHandle: FileSystemDirectoryHandle) => Promise<boolean>) | undefined;
  writeFilesToPyodide: ((files: File[], targetPath: string) => Promise<{success: boolean; error?: string}>) | undefined;
  setAnnotationURL: (url: string) => void;
  setDataArtifactId: (id: string | null) => void;
  setSessionLabel: (label: string) => void;
  setSessionName: (name: string) => void;
  setDataSourceType: (type: 'local' | 'upload' | 'resume') => void;
  setImageFolderHandle: (handle: FileSystemDirectoryHandle | null) => void;
  onSessionCreated?: (artifactId: string) => void;
  server: any;
  user: any;
  artifactManager: any;
  resumeArtifactId?: string | null;
  cellposeModel?: string;
}

type DataSourceType = 'local' | 'upload' | 'resume';

const SessionModal: React.FC<SessionModalProps> = ({
  setShowSessionModal,
  setIsRunning,
  executeCode,
  mountDirectory,
  writeFilesToPyodide,
  setAnnotationURL,
  setDataArtifactId,
  setSessionLabel,
  setSessionName: setParentSessionName,
  setDataSourceType: setParentDataSourceType,
  setImageFolderHandle,
  onSessionCreated,
  server,
  user,
  artifactManager,
  resumeArtifactId: initialResumeArtifactId,
  cellposeModel,
}) => {
  // Step management
  const [step, setStep] = useState<'choose' | 'configure' | 'creating'>(
    initialResumeArtifactId ? 'configure' : 'choose'
  );
  const [dataSourceType, setDataSourceType] = useState<DataSourceType>(
    initialResumeArtifactId ? 'resume' : 'local'
  );

  // Common state
  const [sessionName, setSessionName] = useState('');
  const [sessionDescription, setSessionDescription] = useState('');
  const [label, setLabel] = useState('object');
  const [newLabelValue, setNewLabelValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Local folder state
  const [localFolderHandle, setLocalFolderHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [localFileCount, setLocalFileCount] = useState(0);

  // Upload state
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStats, setUploadStats] = useState({ success: 0, failed: 0, total: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // Resume state
  const [resumeArtifactId, setResumeArtifactId] = useState(
    initialResumeArtifactId || ''
  );
  const [userArtifacts, setUserArtifacts] = useState<any[]>([]);
  const [availableLabels, setAvailableLabels] = useState<string[]>([]);
  const [canUseLocal, setCanUseLocal] = useState(false);
  const [isLoadingArtifacts, setIsLoadingArtifacts] = useState(false);
  const [artifactsFetched, setArtifactsFetched] = useState(false);
  const [noArtifactsFound, setNoArtifactsFound] = useState(false);
  const [isLoadingLabels, setIsLoadingLabels] = useState(false);

  const supportedExtensions = ['.png', '.jpg', '.jpeg', '.tif', '.tiff'];

  // Check if browser is Chromium-based
  const isChromiumBrowser = () => {
    const userAgent = navigator.userAgent.toLowerCase();
    return userAgent.includes('chrome') || userAgent.includes('chromium') || userAgent.includes('edge');
  };

  const extractLabelsFromFileList = (files: any[]): string[] => {
    const labels = new Set<string>();

    console.log('📁 Extracting labels from files:', files);
    for (const file of files || []) {
      const rawName = String(file?.name || '');
      if (!rawName) continue;

      const topLevel = rawName.split('/')[0];
      console.log(`  Checking "${rawName}" -> topLevel "${topLevel}"`);
      if (topLevel.startsWith('masks_') && topLevel.length > 'masks_'.length) {
        const label = topLevel.substring('masks_'.length);
        console.log(`    ✓ Found label: "${label}"`);
        labels.add(label);
      }
    }

    const result = Array.from(labels);
    console.log('📋 Extracted labels:', result);
    return result;
  };

  const fetchLabelsFromArtifactFolders = async (artifactId: string): Promise<string[]> => {
    if (!artifactId || !artifactManager) {
      console.warn('⚠️ Missing artifactId or artifactManager:', { artifactId, hasManager: !!artifactManager });
      return [];
    }

    try {
      console.log('📂 Fetching files from artifact:', artifactId);
      const files = await artifactManager.list_files({
        artifact_id: artifactId,
        stage: true,
        _rkwargs: true
      });
      console.log('📦 Received files response with', files?.length || 0, 'entries');
      return extractLabelsFromFileList(files);
    } catch (error) {
      console.error('❌ Failed to fetch artifact files:', error);
      throw error;
    }
  };

  // Fetch user's artifacts immediately on mount
  useEffect(() => {
    const fetchUserArtifacts = async () => {
      if (!artifactManager || !user) return;
      setIsLoadingArtifacts(true);
      setNoArtifactsFound(false);
      setError(null);
      try {
        // Fetch both staged (draft) and committed artifacts, then deduplicate by id.
        // Committed artifacts are put back into staging mode by colab_service.py
        // (_ensure_artifact_exists calls edit(stage=True)) when a session resumes.
        const [stagedArtifacts, committedArtifacts] = await Promise.allSettled([
          artifactManager.list({ parent_id: "bioimage-io/colab-annotations", stage: true, _rkwargs: true }),
          artifactManager.list({ parent_id: "bioimage-io/colab-annotations", _rkwargs: true }),
        ]);

        const seen = new Set<string>();
        const allArtifacts: any[] = [];
        for (const result of [stagedArtifacts, committedArtifacts]) {
          if (result.status === 'fulfilled') {
            for (const a of (result.value ?? [])) {
              if (!seen.has(a.id)) {
                seen.add(a.id);
                allArtifacts.push(a);
              }
            }
          }
        }

        const myArtifacts = allArtifacts.filter((a: any) =>
          a.manifest?.owner?.id === user.id || a.manifest?.created_by === user.id
        );

        // Read full details for each to get the latest labels
        const fetchedArtifacts = await Promise.all(
          myArtifacts.map(async (a: any) => {
            try {
              // Try staged read first; fall back to committed read
              try {
                return await artifactManager.read({ artifact_id: a.id, stage: true, _rkwargs: true });
              } catch {
                return await artifactManager.read({ artifact_id: a.id, _rkwargs: true });
              }
            } catch (e) {
              console.error("Failed to read details for", a.id, e);
              return a;
            }
          })
        );

        setUserArtifacts(fetchedArtifacts);
        if (fetchedArtifacts.length === 0) {
          setNoArtifactsFound(true);
        }

        // Initialize labels if resumeArtifactId is already set
        if (initialResumeArtifactId) {
          const artifact = fetchedArtifacts.find(a => a.id === initialResumeArtifactId);
          if (artifact) {
            let labels: string[] = [];
            try {
              labels = await fetchLabelsFromArtifactFolders(initialResumeArtifactId);
            } catch (e) {
              console.warn('Could not derive labels from artifact folders', e);
            }
            if (labels.length > 0) {
              setAvailableLabels(labels);
              // Only override the label if it wasn't already set, or just use the first available
              setLabel(prev => prev || labels[0]);
            }
          }
        }
      } catch (e) {
        console.error("Failed to fetch artifacts", e);
        // Error handling if it fails entirely
        setError("Failed to fetch user sessions.");
      } finally {
        setIsLoadingArtifacts(false);
        setArtifactsFetched(true);
      }
    };
    fetchUserArtifacts();
  }, [artifactManager, user, initialResumeArtifactId]);

  const handleLocalFolderSelect = async () => {
    try {
      const dirHandle = await (window as any).showDirectoryPicker();
      setLocalFolderHandle(dirHandle);

      // Auto-fill session name with folder name if not already set
      if (!sessionName || sessionName.trim() === '') {
        setSessionName(dirHandle.name);
      }

      // Count supported image files
      let count = 0;
      for await (const entry of (dirHandle as any).values()) {
        if (entry.kind === 'file') {
          const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
          if (supportedExtensions.includes(ext)) {
            count++;
          }
        }
      }
      setLocalFileCount(count);
      setError(null);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError('Failed to select folder: ' + (err as Error).message);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const imageFiles = files.filter(f => {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      return supportedExtensions.includes(ext);
    });
    setSelectedFiles(imageFiles);
    setUploadStats({ success: 0, failed: 0, total: imageFiles.length });
    if (imageFiles.length < files.length) {
      setError(`Only ${imageFiles.length} of ${files.length} files are supported image formats`);
    } else {
      setError(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const processFileEntries = async (items: DataTransferItemList): Promise<File[]> => {
    const files: File[] = [];

    const processEntry = async (entry: any): Promise<void> => {
      if (entry.isFile) {
        return new Promise((resolve) => {
          entry.file((file: File) => {
            const ext = '.' + file.name.split('.').pop()?.toLowerCase();
            if (supportedExtensions.includes(ext)) {
              files.push(file);
            }
            resolve();
          });
        });
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        return new Promise((resolve) => {
          dirReader.readEntries(async (entries: any[]) => {
            for (const entry of entries) {
              await processEntry(entry);
            }
            resolve();
          });
        });
      }
    };

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry?.();
        if (entry) {
          await processEntry(entry);
        }
      }
    }

    return files;
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    try {
      const files = await processFileEntries(e.dataTransfer.items);
      setSelectedFiles(files);
      setUploadStats({ success: 0, failed: 0, total: files.length });
      setError(null);
    } catch (err) {
      setError('Failed to process dropped files: ' + (err as Error).message);
    }
  };

  const handleResumeArtifactChange = async (artifactId: string) => {
    setResumeArtifactId(artifactId);
    if (!artifactId) {
      setAvailableLabels([]);
      setLabel('');
      setIsLoadingLabels(false);
      return;
    }

    setIsLoadingLabels(true);
    try {
      console.log('🔄 Resume artifact selected:', artifactId);
      const latestArtifact = await artifactManager.read({
        artifact_id: artifactId,
        stage: true,
        _rkwargs: true
      });

      // Keep local artifact list in sync so dropdown metadata stays fresh.
      setUserArtifacts(prevArtifacts =>
        prevArtifacts.map(a => (a.id === artifactId ? latestArtifact : a))
      );

      let labels: string[] = [];
      try {
        console.log('📂 Fetching labels from artifact folders...');
        labels = await fetchLabelsFromArtifactFolders(artifactId);
        console.log('✅ Labels from folders:', labels);
      } catch (folderError) {
        console.warn('Could not derive labels from artifact folders', folderError);
      }
      console.log('🏷️ Final available labels:', labels);
      setAvailableLabels(labels);
      setLabel('');

      let name = latestArtifact.manifest?.name || '';
      if (name.startsWith('Annotation Session ')) {
        name = name.substring('Annotation Session '.length);
      }
      setSessionName(name);

      let description = latestArtifact.manifest?.description || '';
      description = description.replace(/\s*\(Owner:.*?\)\s*$/, '');
      setSessionDescription(description);
      setError(null);
      setIsLoadingLabels(false);
    } catch (e) {
      console.error('Failed to reload selected session details', e);
      setError('Failed to refresh the selected session. Please try again.');

      // Fallback to the already fetched artifact list if fresh read fails.
      const fallbackArtifact = userArtifacts.find(a => a.id === artifactId);
      if (fallbackArtifact) {
        let labels: string[] = [];
        try {
          labels = await fetchLabelsFromArtifactFolders(artifactId);
        } catch (folderError) {
          console.warn('Fallback: Failed to derive labels from artifact folders', folderError);
        }
        setAvailableLabels(labels);
        if (labels.length > 0) setLabel(labels[0]);
      } else {
        setAvailableLabels([]);
        setLabel('');
      }
      setIsLoadingLabels(false);
    }
  };

  const uploadFilesToArtifact = async (serviceId: string): Promise<void> => {
    if (!server || !writeFilesToPyodide || selectedFiles.length === 0) return;

    setUploadProgress(0);
    const totalFiles = selectedFiles.length;

    console.log(`Writing ${totalFiles} files to Pyodide filesystem...`);

    // Step 1: Write all files to Pyodide's filesystem at /tmp/uploads
    const writeResult = await writeFilesToPyodide(selectedFiles, '/tmp/uploads');
    if (!writeResult.success) {
      throw new Error(`Failed to write files to Python: ${writeResult.error}`);
    }

    setUploadProgress(50);
    setUploadStats({ success: 0, failed: 0, total: totalFiles });

    console.log('Files written to Python filesystem, now uploading to artifact...');

    // Step 2: Call Python service function to upload from /tmp/uploads to artifact
    const dataService = await server.getService(serviceId);
    const uploadResult = await dataService.upload_images_from_temp();

    // Update final progress
    setUploadProgress(100);
    setUploadStats({
      success: uploadResult.success,
      failed: uploadResult.failed,
      total: uploadResult.total
    });

    if (uploadResult.failed > 0) {
      console.error('Upload errors:', uploadResult.errors);
      throw new Error(`Upload completed with ${uploadResult.failed} failure(s) out of ${uploadResult.total} file(s)`);
    }

    console.log(`Successfully uploaded ${uploadResult.success} files!`);
  };

  const handleStartSession = async () => {
    if (!user || !artifactManager || !executeCode) {
      setError('You must be logged in and Python kernel must be ready.');
      return;
    }

    // Validation
    let finalLabel = label;
    if (label === '__new__') {
      if (!newLabelValue) {
        setError('Please specify a label for annotations.');
        return;
      }
      finalLabel = newLabelValue;
    } else if (!label) {
      setError('Please specify a label for annotations.');
      return;
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(finalLabel)) {
      setError('Label must contain only letters, numbers, dots, underscores, or hyphens.');
      return;
    }

    if (dataSourceType === 'local' && !localFolderHandle) {
      setError('Please select a local folder.');
      return;
    }
    if (dataSourceType === 'upload' && selectedFiles.length === 0) {
      setError('Please select files to upload.');
      return;
    }
    if (dataSourceType === 'resume' && !resumeArtifactId) {
      setError('Please select an existing session to resume.');
      return;
    }

    setStep('creating');
    setError(null);
    setIsRunning(true);

    try {
      let token = localStorage.getItem('token') || '';
      if (!token && typeof server?.generateToken === 'function') {
        try {
          token = await server.generateToken();
        } catch (tokenError) {
          console.warn('Failed to generate token for Python service:', tokenError);
        }
      }
      if (!token) {
        throw new Error('Authentication token missing. Please log in again.');
      }
      const serverUrl = server.config.publicBaseUrl;
      const ARTIFACT_WORKSPACE = 'bioimage-io';
      let targetArtifactId = '';
      let artifactAlias = '';
      let shouldMountLocal = false;

      // Generate a unique short alias in bioimage-io workspace
      const generateUniqueAlias = async (): Promise<string> => {
        for (let attempt = 0; attempt < 5; attempt++) {
          const ts = Date.now().toString(36);
          const rand = Math.random().toString(36).slice(2, 6);
          const alias = `annotation-${ts}-${rand}`;
          try {
            await artifactManager.read({ artifact_id: `${ARTIFACT_WORKSPACE}/${alias}`, stage: true, _rkwargs: true });
            // exists — try again
            console.warn(`Alias ${alias} already exists, retrying...`);
          } catch {
            return alias; // doesn't exist — use it
          }
        }
        throw new Error('Could not generate a unique session alias after 5 attempts');
      };

      // Handle different data source types
      if (dataSourceType === 'local') {
        console.log('Generating unique alias for new local session...');
        artifactAlias = await generateUniqueAlias();
        targetArtifactId = `${ARTIFACT_WORKSPACE}/${artifactAlias}`;
        shouldMountLocal = true;

      } else if (dataSourceType === 'upload') {
        console.log('Generating unique alias for new upload session...');
        artifactAlias = await generateUniqueAlias();
        targetArtifactId = `${ARTIFACT_WORKSPACE}/${artifactAlias}`;

      } else if (dataSourceType === 'resume') {
        console.log('Resuming existing session...');
        // resumeArtifactId is the full artifact ID like "bioimage-io/annotation-xxx"
        artifactAlias = resumeArtifactId; // Python service strips workspace prefix
        targetArtifactId = resumeArtifactId;

        // User can always mount local folder if requested, regardless of existing cloud images
        shouldMountLocal = canUseLocal && localFolderHandle !== null;
      }

      // Install Python packages
      console.log('Installing Python packages...');
      const installCode = `
import micropip
await micropip.install(['numpy', 'Pillow', 'hypha-rpc', 'tifffile==2024.7.24'])
print("Packages installed", end='')
`;

      let hasError = false;
      let lastPythonError: string | null = null;
      await executeCode(installCode, {
        onOutput: (output: any) => {
          if (output.type === 'error') {
            hasError = true;
            lastPythonError = output.content || output.short_content || 'Unknown Python error';
          }
        },
      });

      if (hasError) {
        throw new Error(
          `Failed to install Python packages${lastPythonError ? `: ${lastPythonError}` : ''}`
        );
      }

      // Load service code
      console.log('Loading service code...');
      const serviceCodeResponse = await fetch(`${process.env.PUBLIC_URL}/colab_service.py`);
      const serviceCode = await serviceCodeResponse.text();
      hasError = false;
      lastPythonError = null;
      await executeCode(serviceCode, {
        onOutput: (output: any) => {
          if (output.type === 'error') {
            hasError = true;
            lastPythonError = output.content || output.short_content || 'Unknown Python error';
          }
        },
      });

      if (hasError) {
        throw new Error(
          `Failed to load service code${lastPythonError ? `: ${lastPythonError}` : ''}`
        );
      }

      // Mount local folder if needed
      if (shouldMountLocal && mountDirectory && localFolderHandle) {
        console.log('Mounting local folder...');
        const mounted = await mountDirectory('/mnt', localFolderHandle);
        if (!mounted) throw new Error('Failed to mount directory');

        await executeCode(`
from pathlib import Path
supported, unsupported = list_image_files(Path("/mnt"))
print(f"Found {len(supported)} images", end='')
`, {
          onOutput: (output: any) => {
            if (output.type === 'error') {
              hasError = true;
              lastPythonError = output.content || output.short_content || 'Unknown Python error';
            }
          },
        });

        if (hasError) {
          throw new Error(
            `Failed to verify mounted folder${lastPythonError ? `: ${lastPythonError}` : ''}`
          );
        }
      }

      // Register service
      console.log('Registering annotation service...');
      const imagesPath = shouldMountLocal ? '"/mnt"' : 'None';

      // Generate predictable IDs
      const clientId = `colab-client-${Date.now()}`;
      const serviceId = `data-provider-${Date.now()}`;

      const registerCode = `
service_info = await register_service(
    server_url="${serverUrl}",
    token="${token}",
    name="${sessionName}",
    description="${sessionDescription}",
    artifact_alias="${artifactAlias}",
    images_path=${imagesPath},
    label="${finalLabel}",
    client_id="${clientId}",
    service_id="${serviceId}",
    cellpose_model="${cellposeModel || ''}",
    user_id="${user?.id || ''}",
    user_email="${user?.email || ''}"
)
print("Service registered successfully", end='')
`;

      hasError = false;
      lastPythonError = null;
      await executeCode(registerCode, {
        onOutput: (output: any) => {
          if (output.type === 'error') {
            hasError = true;
            lastPythonError = output.content || output.short_content || 'Unknown Python error';
          }
        },
      });

      if (hasError) {
        throw new Error(
          `Failed to register service${lastPythonError ? `: ${lastPythonError}` : ''}`
        );
      }

      console.log('Service registered successfully');
      const fullServiceId = `${server.config.workspace}/${clientId}:${serviceId}`;

      // Upload files if in eager upload mode
      if (dataSourceType === 'upload' && selectedFiles.length > 0) {
        console.log('Uploading files using service...');
        await uploadFilesToArtifact(fullServiceId);
      }

      // Generate annotation URL pointing to our own #/colab/annotate page
      const annotateParams = new URLSearchParams({
        server_url: serverUrl,
        image_provider_id: fullServiceId,
        label: finalLabel,
      });
      if (targetArtifactId) {
        annotateParams.set('session_id', targetArtifactId);
      }
      const baseUrl = window.location.origin + window.location.pathname;
      const annotatorUrl = `${baseUrl}#/colab/annotate?${annotateParams.toString()}`;

      console.log('Annotation URL:', annotatorUrl);
      console.log('Selected Label:', finalLabel);

      // Update parent component state
      setAnnotationURL(annotatorUrl);
      setDataArtifactId(targetArtifactId);
      setSessionLabel(finalLabel);
      setParentSessionName(sessionName);
      setParentDataSourceType(dataSourceType);
      // Always update the folder handle — clear it unless we actually mounted one
      setImageFolderHandle(shouldMountLocal && localFolderHandle ? localFolderHandle : null);

      console.log('✓ Session started successfully!');
      console.log('  Data Artifact ID:', targetArtifactId);
      console.log('  Service ID:', fullServiceId);
      console.log('  Data Source:', dataSourceType);

      // Notify parent that session was created (for URL update)
      if (onSessionCreated) {
        onSessionCreated(targetArtifactId);
      }

      setIsRunning(false);
      setShowSessionModal(false);

    } catch (err) {
      console.error('Session creation error:', err);
      setError((err as Error).message);
      setIsRunning(false);
      setStep('configure');
    }
  };

  // Render functions for each step
  const renderChooseStep = () => (
    <div className="space-y-4">
      <div className="text-center mb-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">Choose Data Source</h3>
        <p className="text-sm text-gray-600">How would you like to provide your images?</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {/* Option 1: Local Folder - Lazy Upload */}
        <button
          onClick={() => {
            setDataSourceType('local');
            setLabel('');
            setNewLabelValue('');
            setStep('configure');
          }}
          className="p-6 border-2 border-gray-200 rounded-xl hover:border-purple-500 hover:bg-purple-50 transition-all text-left group"
        >
          <div className="flex items-start">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mr-4 group-hover:bg-purple-200">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-gray-800 mb-1">Mount Local Folder</h4>
              <p className="text-sm text-gray-600">Start a new annotation project from scratch.</p>
            </div>
          </div>
        </button>

        {/* Option 3: Resume Session */}
        <button
          onClick={() => {
            setDataSourceType('resume');
            setLabel('');
            setNewLabelValue('');
            setStep('configure');
          }}
          disabled={isLoadingArtifacts || userArtifacts.length === 0}
          className="p-6 border-2 border-gray-200 rounded-xl hover:border-green-500 hover:bg-green-50 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex items-start">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mr-4 group-hover:bg-green-200">
              {isLoadingArtifacts ? (
                <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-gray-800 mb-1">Resume Previous Session</h4>
              <p className="text-sm text-gray-600">Continue working on an existing annotation project.</p>
              {!isLoadingArtifacts && userArtifacts.length > 0 && (
                <span className="inline-block mt-2 text-xs font-medium text-green-600">{userArtifacts.length} session(s) available</span>
              )}
              {!isLoadingArtifacts && userArtifacts.length === 0 && (
                <span className="inline-block mt-2 text-xs font-medium text-gray-500">No sessions available</span>
              )}
            </div>
          </div>
        </button>
      </div>
    </div>
  );

  const renderConfigureStep = () => (
    <div className="space-y-4">
      <button
        onClick={() => setStep('choose')}
        className="text-sm text-gray-600 hover:text-gray-800 flex items-center"
      >
        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to options
      </button>

      <div className="border-b pb-4">
        <h3 className="text-lg font-semibold text-gray-800">
          {dataSourceType === 'local' && 'Configure Local Folder Session'}
          {dataSourceType === 'upload' && 'Configure Cloud Upload Session'}
          {dataSourceType === 'resume' && 'Resume Existing Session'}
        </h3>
      </div>

      {/* Data Source Specific Configuration */}
      {dataSourceType === 'local' && (
        <div className="space-y-3">
          {/* Browser Compatibility Warning */}
          {!isChromiumBrowser() && (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-yellow-600 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p className="text-sm text-yellow-800 font-medium">Browser Compatibility Warning</p>
                  <p className="text-xs text-yellow-700 mt-1">
                    Local folder mounting works best in Chromium-based browsers (Chrome, Edge, Brave).
                    Your current browser may not support the File System Access API.
                    Consider switching to a Chromium browser.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Image Folder
            </label>
            <button
              onClick={handleLocalFolderSelect}
              className="w-full px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition-all flex items-center justify-center"
            >
              <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              {localFolderHandle ? `${localFolderHandle.name} (${localFileCount} images)` : 'Choose Folder'}
            </button>
          </div>
        </div>
      )}

      {dataSourceType === 'resume' && (
        <div className="space-y-3">
          {noArtifactsFound ? (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
              No previous sessions found. Please start a new session instead.
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Session to Resume
                </label>
                <select
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  value={resumeArtifactId}
                  onChange={(e) => handleResumeArtifactChange(e.target.value)}
                >
                  <option value="" disabled>Choose a Session...</option>
                  {userArtifacts.map(artifact => {
                    let displayName = artifact.manifest?.name || artifact.id;
                    if (displayName.startsWith('Annotation Session ')) {
                      displayName = displayName.substring('Annotation Session '.length);
                    }
                    const shortId = artifact.id.split('/').pop() || artifact.id;
                    return (
                      <option key={artifact.id} value={artifact.id}>
                        {shortId} - {displayName}
                      </option>
                    );
                  })}
                </select>
              </div>

              {resumeArtifactId && (
                <>
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="useLocalFolder"
                      checked={canUseLocal}
                      onChange={(e) => setCanUseLocal(e.target.checked)}
                      className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <label htmlFor="useLocalFolder" className="text-sm text-gray-700">
                      Add images from local folder to this session
                    </label>
                  </div>

                  {canUseLocal && (
                    <button
                      onClick={handleLocalFolderSelect}
                      className="w-full px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg hover:border-green-500 hover:bg-green-50 transition-all text-sm"
                    >
                      {localFolderHandle ? `${localFolderHandle.name} (${localFileCount} images)` : 'Choose Folder'}
                    </button>
                  )}

                  <div>
                    {label === '__new__' ? (
                      <>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Set Annotation Label
                        </label>
                          <input
                            type="text"
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                            placeholder="Type a label (e.g., nuclei, cells, mitochondria)"
                            value={newLabelValue}
                            onChange={(e) => setNewLabelValue(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            Only letters, numbers, dots, underscores, and hyphens allowed
                          </p>
                          <button
                            onClick={() => {
                              setLabel('');
                              setNewLabelValue('');
                            }}
                            className="text-sm text-gray-600 hover:text-gray-900 mt-2"
                          >
                            ← Back to label selection
                          </button>
                        </>
                      ) : (
                        <>
                          <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                            Set Annotation Label
                            {isLoadingLabels && (
                              <svg className="animate-spin h-4 w-4 text-green-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                            )}
                          </label>
                          <select
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            disabled={isLoadingLabels}
                          >
                            <option value="" disabled>Choose a label...</option>
                            {availableLabels.length > 0 && availableLabels.map(lbl => (
                              <option key={lbl} value={lbl}>{lbl}</option>
                            ))}
                            <option value="__new__">+ Create new label...</option>
                          </select>
                        </>
                      )}
                    </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Common Configuration */}
      {dataSourceType !== 'resume' && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Session Name
            </label>
            <input
              type="text"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              placeholder="e.g., Cell segmentation project"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              placeholder="Brief description of your annotation project"
              rows={2}
              value={sessionDescription}
              onChange={(e) => setSessionDescription(e.target.value)}
            />
          </div>
        </>
      )}

      {dataSourceType !== 'resume' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Set Annotation Label
          </label>
          <input
            type="text"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
            placeholder="Type a label (e.g., nuclei, cells, mitochondria)"
            value={label}
            onChange={(e) => setLabel(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
          />
          <p className="text-xs text-gray-500 mt-1">
            Only letters, numbers, dots, underscores, and hyphens allowed
          </p>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {error}
        </div>
      )}

      {(() => {
        const missingFields: string[] = [];
        if (!sessionName) missingFields.push('session name');
        if (!label) missingFields.push('annotation label');
        const sourceIncomplete =
          (dataSourceType === 'local' && !localFolderHandle) ||
          (dataSourceType === 'upload' && selectedFiles.length === 0) ||
          (dataSourceType === 'resume' && !resumeArtifactId);
        const isDisabled = missingFields.length > 0 || sourceIncomplete;
        const tooltipMsg = missingFields.length > 0
          ? `Please fill in: ${missingFields.join(', ')}`
          : sourceIncomplete
            ? dataSourceType === 'local' ? 'Please select a local folder'
            : dataSourceType === 'upload' ? 'Please select files to upload'
            : 'Please select a session to resume'
          : '';
        return (
          <div className="w-full relative group/startbtn">
            <button
              onClick={handleStartSession}
              disabled={isDisabled}
              className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed font-medium shadow-sm hover:shadow-md transition-all"
            >
              Start Annotation Session
            </button>
            {isDisabled && tooltipMsg && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover/startbtn:opacity-100 transition-opacity duration-0 pointer-events-none z-50 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" strokeWidth="2"/>
                  <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" strokeWidth="2"/>
                </svg>
                {tooltipMsg}
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );

  const renderCreatingStep = () => (
    <div className="text-center py-8">
      <div className="w-16 h-16 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
      <h3 className="text-lg font-semibold text-gray-800 mb-2">Starting Session...</h3>
      <p className="text-sm text-gray-600">
        {dataSourceType === 'upload' && uploadProgress > 0 && (
          <>Processing and uploading files: {uploadProgress}%</>
        )}
        {dataSourceType === 'upload' && uploadProgress === 0 && (
          <>Preparing upload...</>
        )}
        {dataSourceType === 'local' && (
          <>Mounting local folder...</>
        )}
        {dataSourceType === 'resume' && (
          <>Loading session...</>
        )}
      </p>

      {dataSourceType === 'upload' && uploadProgress > 0 && (
        <>
          <div className="mt-4 max-w-md mx-auto">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
          </div>

          {/* Upload stats */}
          {uploadStats.total > 0 && (
            <div className="mt-4 flex justify-center gap-4 text-sm">
              <span className="text-green-600 font-medium">
                ✓ Success: {uploadStats.success}
              </span>
              {uploadStats.failed > 0 && (
                <span className="text-red-600 font-medium">
                  ✗ Failed: {uploadStats.failed}
                </span>
              )}
              <span className="text-gray-600">
                Total: {uploadStats.total}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200 sticky top-0 bg-white z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl flex items-center justify-center mr-3">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-800">Start Annotation Session</h2>
            </div>
            {step !== 'creating' && (
              <button
                onClick={() => setShowSessionModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="p-6">
          {step === 'choose' && renderChooseStep()}
          {step === 'configure' && renderConfigureStep()}
          {step === 'creating' && renderCreatingStep()}
        </div>
      </div>
    </div>
  );
};

export default SessionModal;
