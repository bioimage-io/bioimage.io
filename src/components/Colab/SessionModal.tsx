import React, { useState, useEffect } from 'react';

interface SessionModalProps {
  setShowSessionModal: (show: boolean) => void;
  setIsRunning: (running: boolean) => void;
  executeCode: ((code: string, callbacks?: any) => Promise<void>) | null;
  mountDirectory: ((mountPoint: string, dirHandle: FileSystemDirectoryHandle) => Promise<boolean>) | undefined;
  setAnnotationURL: (url: string) => void;
  setDataArtifactId: (id: string | null) => void;
  setSessionLabel: (label: string) => void;
  setImageFolderHandle: (handle: FileSystemDirectoryHandle | null) => void;
  server: any;
  user: any;
  artifactManager: any;
}

type DataSourceType = 'local' | 'upload' | 'resume';

const SessionModal: React.FC<SessionModalProps> = ({
  setShowSessionModal,
  setIsRunning,
  executeCode,
  mountDirectory,
  setAnnotationURL,
  setDataArtifactId,
  setSessionLabel,
  setImageFolderHandle,
  server,
  user,
  artifactManager,
}) => {
  // Step management
  const [step, setStep] = useState<'choose' | 'configure' | 'creating'>('choose');
  const [dataSourceType, setDataSourceType] = useState<DataSourceType>('local');

  // Common state
  const [sessionName, setSessionName] = useState(
    localStorage.getItem('colabSessionName') || ''
  );
  const [sessionDescription, setSessionDescription] = useState(
    localStorage.getItem('colabSessionDescription') || ''
  );
  const [label, setLabel] = useState(localStorage.getItem('colabSessionLabel') || '');
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
    localStorage.getItem('colabResumeArtifactId') || ''
  );
  const [userArtifacts, setUserArtifacts] = useState<any[]>([]);
  const [availableLabels, setAvailableLabels] = useState<string[]>([]);
  const [canUseLocal, setCanUseLocal] = useState(true);

  const supportedExtensions = ['.png', '.jpg', '.jpeg', '.tif', '.tiff'];

  // Check if browser is Chromium-based
  const isChromiumBrowser = () => {
    const userAgent = navigator.userAgent.toLowerCase();
    return userAgent.includes('chrome') || userAgent.includes('chromium') || userAgent.includes('edge');
  };

  // Fetch user's artifacts
  useEffect(() => {
    const fetchArtifacts = async () => {
      if (!artifactManager || !user) return;
      try {
        const artifacts = await artifactManager.list({
          parent_id: "bioimage-io/colab-annotations",
          stage: true,
          _rkwargs: true
        });
        const myArtifacts = artifacts.filter((a: any) =>
          a.manifest?.owner?.id === user.id || a.manifest?.created_by === user.id
        );
        setUserArtifacts(myArtifacts);
      } catch (e) {
        console.error("Failed to fetch artifacts", e);
      }
    };
    fetchArtifacts();
  }, [artifactManager, user]);

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
    if (artifactId && userArtifacts.length > 0) {
      const artifact = userArtifacts.find(a => a.id === artifactId);
      if (artifact?.manifest) {
        const labels = artifact.manifest.labels || [];
        setAvailableLabels(labels);
        if (labels.length > 0) setLabel(labels[0]);

        let name = artifact.manifest.name || '';
        if (name.startsWith('Annotation Session ')) {
          name = name.substring('Annotation Session '.length);
        }
        setSessionName(name);

        let description = artifact.manifest.description || '';
        description = description.replace(/\s*\(Owner:.*?\)\s*$/, '');
        setSessionDescription(description);
      }
    }
  };

  const uploadFilesToArtifact = async (artifactId: string): Promise<void> => {
    if (!artifactManager || selectedFiles.length === 0 || !executeCode) return;

    setUploadProgress(0);
    const totalFiles = selectedFiles.length;
    let successCount = 0;
    let failedCount = 0;

    // Process each file: read in pyodide, convert to PNG, upload
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const originalFileName = file.name;
      const baseName = originalFileName.substring(0, originalFileName.lastIndexOf('.')) || originalFileName;
      const outputFileName = `${baseName}.png`;

      try {
        // Read file as bytes
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        // Convert to base64 for transfer to Python
        const base64Input = btoa(String.fromCharCode(...Array.from(uint8Array)));

        const tempInputPath = `/tmp/upload_${i}_${originalFileName}`;
        const tempOutputPath = `/tmp/output_${i}.png`;

        const convertCode = `
from PIL import Image
import io
import base64

try:
    # Decode base64 input
    input_data = base64.b64decode('${base64Input}')

    # Write to temp file
    with open('${tempInputPath}', 'wb') as f:
        f.write(input_data)

    # Read image
    img = Image.open('${tempInputPath}')

    # Convert to RGB if needed
    if img.mode != 'RGB':
        if img.mode == 'RGBA':
            # Create white background
            background = Image.new('RGB', img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[3] if img.mode == 'RGBA' else None)
            img = background
        else:
            img = img.convert('RGB')

    # Save as PNG
    img.save('${tempOutputPath}', format='PNG')

    # Read back and encode as base64
    with open('${tempOutputPath}', 'rb') as f:
        png_bytes = f.read()

    print(base64.b64encode(png_bytes).decode('ascii'), end='')
except Exception as e:
    print(f"ERROR: {e}")
    raise
`;

        // Execute conversion code
        let pngBase64 = '';
        await executeCode(convertCode, {
          onOutput: (output: string) => {
            const trimmed = output.trim();
            if (trimmed && !trimmed.startsWith('ERROR:')) {
              pngBase64 = trimmed;
            }
          }
        });

        if (!pngBase64) {
          throw new Error('Failed to convert image to PNG');
        }

        // Convert base64 back to bytes
        const pngBytes = Uint8Array.from(atob(pngBase64), c => c.charCodeAt(0));

        // Upload to artifact
        const uploadUrl = await artifactManager.put_file(
          artifactId,
          { file_path: `input_images/${outputFileName}` }
        );

        const response = await fetch(uploadUrl, {
          method: 'PUT',
          body: pngBytes,
          headers: {
            'Content-Type': 'image/png'
          }
        });

        if (!response.ok) {
          throw new Error(`Upload failed with status ${response.status}`);
        }

        successCount++;
      } catch (err) {
        console.error(`Failed to process ${originalFileName}:`, err);
        failedCount++;
      }

      // Update progress
      setUploadProgress(Math.round(((i + 1) / totalFiles) * 100));
      setUploadStats({ success: successCount, failed: failedCount, total: totalFiles });
    }

    if (failedCount > 0) {
      throw new Error(`Upload completed with ${failedCount} failure(s) out of ${totalFiles} file(s)`);
    }
  };

  const handleStartSession = async () => {
    if (!user || !artifactManager || !executeCode) {
      setError('You must be logged in and Python kernel must be ready.');
      return;
    }

    // Validation
    if (!label) {
      setError('Please specify a label for annotations.');
      return;
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(label)) {
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
      // Save to localStorage
      localStorage.setItem('colabSessionName', sessionName);
      localStorage.setItem('colabSessionDescription', sessionDescription);
      localStorage.setItem('colabSessionLabel', label);

      const token = localStorage.getItem('token') || '';
      const serverUrl = server.config.publicBaseUrl;
      let targetArtifactId = '';
      let shouldMountLocal = false;

      // Handle different data source types
      if (dataSourceType === 'local') {
        console.log('Creating artifact for lazy upload (local folder)...');
        const manifest = {
          name: `Annotation Session ${sessionName}`,
          description: `${sessionDescription} (Owner: ${user.email})`,
          owner: { id: user.id, email: user.email },
          labels: [label],
          data_source: 'lazy_upload'
        };

        const artifact = await artifactManager.create({
          parent_id: "bioimage-io/colab-annotations",
          manifest,
          type: "dataset",
          stage: true,
          _rkwargs: true
        });
        targetArtifactId = artifact.id;
        shouldMountLocal = true;

      } else if (dataSourceType === 'upload') {
        console.log('Creating artifact for eager upload...');
        const manifest = {
          name: `Annotation Session ${sessionName}`,
          description: `${sessionDescription} (Owner: ${user.email})`,
          owner: { id: user.id, email: user.email },
          labels: [label],
          data_source: 'eager_upload'
        };

        const artifact = await artifactManager.create({
          parent_id: "bioimage-io/colab-annotations",
          manifest,
          type: "dataset",
          stage: true,
          _rkwargs: true
        });
        targetArtifactId = artifact.id;

        // Install Python packages first (needed for image processing)
        console.log('Installing Python packages for image processing...');
        const installCode = `
import micropip
await micropip.install(['Pillow'])
print("Pillow installed", end='')
`;

        let hasError = false;
        await executeCode(installCode, {
          onOutput: (output: any) => {
            if (output.type === 'error') hasError = true;
          },
        });

        if (hasError) throw new Error('Failed to install Python packages');

        console.log('Uploading files to artifact...');
        await uploadFilesToArtifact(targetArtifactId);

      } else if (dataSourceType === 'resume') {
        console.log('Resuming existing session...');
        targetArtifactId = resumeArtifactId;
        localStorage.setItem('colabResumeArtifactId', targetArtifactId);

        // Check if artifact has input_images
        try {
          const files = await artifactManager.list_files({
            artifact_id: targetArtifactId,
            dir_path: 'input_images',
            _rkwargs: true
          });
          shouldMountLocal = files.length === 0 && canUseLocal && localFolderHandle !== null;
        } catch {
          shouldMountLocal = canUseLocal && localFolderHandle !== null;
        }

        // Update labels if needed
        const artifact = userArtifacts.find(a => a.id === targetArtifactId);
        if (artifact) {
          const existingLabels = artifact.manifest.labels || [];
          if (!existingLabels.includes(label)) {
            const updatedManifest = {
              ...artifact.manifest,
              labels: [...existingLabels, label]
            };
            await artifactManager.edit({
              artifact_id: targetArtifactId,
              manifest: updatedManifest,
              stage: true,
              _rkwargs: true
            });
          }
        }
      }

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

      // Mount local folder if needed
      if (shouldMountLocal && mountDirectory && localFolderHandle) {
        console.log('Mounting local folder...');
        const mounted = await mountDirectory('/mnt', localFolderHandle);
        if (!mounted) throw new Error('Failed to mount directory');

        await executeCode(`
from pathlib import Path
files = list_image_files(Path("/mnt"))
print(f"Found {len(files)} images", end='')
`, {
          onOutput: (output: any) => {
            if (output.type === 'error') hasError = true;
          },
        });

        if (hasError) throw new Error('Failed to verify mounted folder');
      }

      // Register service
      console.log('Registering annotation service...');
      const registerCode = `
service_info, data_artifact = await register_service(
    server_url="${serverUrl}",
    token="${token}",
    name="${sessionName}",
    description="${sessionDescription} (Owner: ${user.email})",
    artifact_id="${targetArtifactId}",
    images_path="/mnt",
    label="${label}",
)
service_id = service_info.get("id", "unknown")
data_artifact_id = data_artifact.get("id", "unknown")
print("===SERVICE_ID_START===" + service_id + "===SERVICE_ID_END===", end='')
print("===DATA_ARTIFACT_ID_START===" + data_artifact_id + "===DATA_ARTIFACT_ID_END===", end='')
`;

      let allOutput = '';
      await executeCode(registerCode, {
        onOutput: (output: any) => {
          allOutput += output.content;
          if (output.type === 'error') hasError = true;
        },
      });

      if (hasError) throw new Error('Failed to register service');

      // Extract service ID and artifact ID
      const serviceIdMatch = allOutput.match(/===SERVICE_ID_START===(.*?)===SERVICE_ID_END===/);
      const artifactIdMatch = allOutput.match(/===DATA_ARTIFACT_ID_START===(.*?)===DATA_ARTIFACT_ID_END===/);

      const serviceId = serviceIdMatch?.[1]?.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').trim();
      const dataArtifactId = artifactIdMatch?.[1]?.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').trim();

      if (!serviceId || !dataArtifactId) {
        throw new Error('Failed to extract service information');
      }

      // Generate annotation URL
      const pluginCommitHash = '6a18797';
      const pluginUrl = `https://raw.githubusercontent.com/bioimage-io/bioimageio-colab/${pluginCommitHash}/plugins/bioimageio-colab-annotator.imjoy.html`;
      const configStr = JSON.stringify({
        serverUrl: serverUrl,
        imageProviderId: serviceId,
        label: label,
        // token: token,
      });
      const encodedConfig = encodeURIComponent(configStr);
      const annotatorUrl = `https://imjoy.io/lite?plugin=${pluginUrl}&config=${encodedConfig}`;

      console.log('Annotation URL:', annotatorUrl);
      console.log('Selected Label:', label);

      // Update parent component state
      setAnnotationURL(annotatorUrl);
      setDataArtifactId(dataArtifactId);
      setSessionLabel(label);
      // Only set image folder handle if we actually mounted a local folder
      if (shouldMountLocal && localFolderHandle) {
        setImageFolderHandle(localFolderHandle);
      }

      console.log('✓ Session started successfully!');
      console.log('  Data Artifact ID:', dataArtifactId);
      console.log('  Service ID:', serviceId);
      console.log('  Data Source:', dataSourceType);

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
              <p className="text-sm text-gray-600">Start immediately. Images uploaded as you annotate.</p>
              <span className="inline-block mt-2 text-xs font-medium text-purple-600">Recommended for large datasets</span>
            </div>
          </div>
        </button>

        {/* Option 2: Upload Files - Eager Upload */}
        <button
          onClick={() => {
            setDataSourceType('upload');
            setStep('configure');
          }}
          className="p-6 border-2 border-gray-200 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all text-left group"
        >
          <div className="flex items-start">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mr-4 group-hover:bg-blue-200">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-gray-800 mb-1">Upload to Cloud</h4>
              <p className="text-sm text-gray-600">Upload all images first. Fully backed up before starting.</p>
              <span className="inline-block mt-2 text-xs font-medium text-blue-600">Best for small to medium datasets</span>
            </div>
          </div>
        </button>

        {/* Option 3: Resume Session */}
        <button
          onClick={() => {
            setDataSourceType('resume');
            setStep('configure');
          }}
          disabled={userArtifacts.length === 0}
          className="p-6 border-2 border-gray-200 rounded-xl hover:border-green-500 hover:bg-green-50 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex items-start">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mr-4 group-hover:bg-green-200">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-gray-800 mb-1">Resume Previous Session</h4>
              <p className="text-sm text-gray-600">Continue working on an existing annotation project.</p>
              {userArtifacts.length > 0 && (
                <span className="inline-block mt-2 text-xs font-medium text-green-600">{userArtifacts.length} session(s) available</span>
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
                    Consider using "Upload to Cloud" instead or switch to a Chromium browser.
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

      {dataSourceType === 'upload' && (
        <div className="space-y-3">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-blue-600 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="text-sm text-blue-800 font-medium">Eager Upload Mode</p>
                <p className="text-xs text-blue-700 mt-1">
                  All selected images will be uploaded before annotation starts. Supports files and folders.
                </p>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select or Drag Images/Folders
            </label>

            {/* Drag and Drop Area */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-all ${
                isDragging
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
              }`}
            >
              <input
                type="file"
                multiple
                accept={supportedExtensions.join(',')}
                onChange={handleFileSelect}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                title="Click to select files or drag and drop"
              />

              <div className="pointer-events-none">
                <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                  <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <p className="mt-2 text-sm text-gray-600">
                  <span className="font-semibold">Click to browse</span> or drag files/folders here
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  Supported: PNG, JPG, JPEG, TIF, TIFF
                </p>
              </div>
            </div>

            {selectedFiles.length > 0 && (
              <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-700 font-medium">
                  {selectedFiles.length} file(s) selected
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  Total size: {Math.round(selectedFiles.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024 * 10) / 10} MB
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {dataSourceType === 'resume' && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Session to Resume
            </label>
            <select
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
              value={resumeArtifactId}
              onChange={(e) => handleResumeArtifactChange(e.target.value)}
            >
              <option value="">Choose a session...</option>
              {userArtifacts.map(artifact => {
                // Clean up the name by removing "Annotation Session " prefix
                let displayName = artifact.manifest?.name || artifact.id;
                if (displayName.startsWith('Annotation Session ')) {
                  displayName = displayName.substring('Annotation Session '.length);
                }

                // Get short artifact ID (last part after /)
                const shortId = artifact.id.split('/').pop() || artifact.id;

                return (
                  <option key={artifact.id} value={artifact.id}>
                    {shortId} - {displayName} ({artifact.manifest?.labels?.join(', ') || 'no labels'})
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
                  Also mount local folder for this session
                </label>
              </div>

              {canUseLocal && (
                <button
                  onClick={handleLocalFolderSelect}
                  className="w-full px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg hover:border-green-500 hover:bg-green-50 transition-all text-sm"
                >
                  {localFolderHandle ? `${localFolderHandle.name} (${localFileCount} images)` : 'Choose Folder (Optional)'}
                </button>
              )}

              {availableLabels.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Continue with Label
                  </label>
                  <select
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  >
                    {availableLabels.map(lbl => (
                      <option key={lbl} value={lbl}>{lbl}</option>
                    ))}
                  </select>
                </div>
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
              Description (Optional)
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

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Annotation Label
          <span className="text-xs text-gray-500 ml-2">(e.g., nuclei, cells, mitochondria)</span>
        </label>
        <input
          type="text"
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
          placeholder="e.g., nuclei"
          value={label}
          onChange={(e) => setLabel(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
          disabled={dataSourceType === 'resume' && availableLabels.length > 0}
        />
        <p className="text-xs text-gray-500 mt-1">
          Only letters, numbers, dots, underscores, and hyphens allowed
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {error}
        </div>
      )}

      <button
        onClick={handleStartSession}
        disabled={
          !label ||
          (dataSourceType === 'local' && !localFolderHandle) ||
          (dataSourceType === 'upload' && selectedFiles.length === 0) ||
          (dataSourceType === 'resume' && !resumeArtifactId)
        }
        className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed font-medium shadow-sm hover:shadow-md transition-all"
      >
        Start Annotation Session
      </button>
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
