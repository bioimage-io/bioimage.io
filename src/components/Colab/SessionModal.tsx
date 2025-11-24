import React, { useState, useEffect } from 'react';

interface SessionModalProps {
  setShowSessionModal: (show: boolean) => void;
  imageFolderHandle: FileSystemDirectoryHandle | null;
  setAnnotationsFolderHandle: (handle: FileSystemDirectoryHandle) => void;
  updateFileList: (
    dirHandle: FileSystemDirectoryHandle,
    setFileList: React.Dispatch<React.SetStateAction<string[]>>,
    setLoading: React.Dispatch<React.SetStateAction<boolean>>
  ) => Promise<void>;
  setAnnotationsList: React.Dispatch<React.SetStateAction<string[]>>;
  setIsLoadingAnnotations: React.Dispatch<React.SetStateAction<boolean>>;
  setIsRunning: (running: boolean) => void;
  executeCode: ((code: string, callbacks?: any) => Promise<void>) | null;
  mountDirectory: ((mountPoint: string, dirHandle: FileSystemDirectoryHandle) => Promise<boolean>) | undefined;
  syncFileSystem: ((mountPath: string) => Promise<{success: boolean; error?: string}>) | undefined;
  supportedFileTypes: string[];
  setAnnotationURL: (url: string) => void;
  server: any;
  user: any;
}

const SessionModal: React.FC<SessionModalProps> = ({
  setShowSessionModal,
  imageFolderHandle,
  setAnnotationsFolderHandle,
  updateFileList,
  setAnnotationsList,
  setIsLoadingAnnotations,
  setIsRunning,
  executeCode,
  mountDirectory,
  syncFileSystem,
  supportedFileTypes,
  setAnnotationURL,
  server,
  user,
}) => {
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [sessionName, setSessionName] = useState(
    localStorage.getItem('colabSessionName') || ''
  );
  const [sessionDescription, setSessionDescription] = useState(
    localStorage.getItem('colabSessionDescription') || ''
  );
  const [error, setError] = useState<string | null>(null);

  const handleCreateSession = async () => {
    if (!imageFolderHandle || !executeCode) {
      setError('Image folder not mounted or kernel not ready');
      return;
    }

    setIsCreatingSession(true);
    setError(null);

    try {
      // Save session details to localStorage
      localStorage.setItem('colabSessionName', sessionName);
      localStorage.setItem('colabSessionDescription', sessionDescription);

      // Create annotations folder
      const annotationsFolder = await imageFolderHandle.getDirectoryHandle('annotations', {
        create: true,
      });
      setAnnotationsFolderHandle(annotationsFolder);
      await updateFileList(annotationsFolder, setAnnotationsList, setIsLoadingAnnotations);
      console.log('Created annotations folder:', annotationsFolder.name);

      setIsRunning(true);

      // Get token from server
      const token = localStorage.getItem('token') || '';
      const serverUrl = server?.config?.server_url || 'https://hypha.aicell.io';

      // Load and execute the Python service code
      console.log('Loading Python service code...');
      const serviceCodeResponse = await fetch(`${process.env.PUBLIC_URL}/colab_service.py`);
      const serviceCode = await serviceCodeResponse.text();

      console.log('Executing Python service code...');
      await executeCode(serviceCode, {
        onOutput: (output: any) => {
          console.log('[Python Output]', output.content);
        },
      });

      // Install required packages if not already installed
      console.log('Installing required Python packages...');
      const installCode = `
import micropip
await micropip.install(['hypha-rpc', 'tifffile', 'imageio', 'numpy', 'scikit-image'])

# Note: kaibu_utils will be imported inline when needed, or we'll use scikit-image as fallback
print("Required packages installed successfully")
`;

      await executeCode(installCode, {
        onOutput: (output: any) => {
          console.log('[Install Output]', output.content);
        },
      });

      // Mount the image folder to pyodide virtual filesystem
      if (mountDirectory && imageFolderHandle) {
        console.log('Mounting folder to Python virtual filesystem...');
        console.log('  Folder name:', imageFolderHandle.name);
        console.log('  Mount point: /mnt');
        const mounted = await mountDirectory('/mnt', imageFolderHandle);
        if (!mounted) {
          throw new Error('Failed to mount directory to Python environment');
        }
        console.log('✓ Successfully mounted folder to /mnt');

        // Verify mount by listing directory in Python
        console.log('Verifying mount...');
        await executeCode(`
import os
print("Mount verification:")
print(f"  /mnt exists: {os.path.exists('/mnt')}")
print(f"  /mnt is directory: {os.path.isdir('/mnt')}")
if os.path.exists('/mnt'):
    items = os.listdir('/mnt')
    print(f"  Items in /mnt: {len(items)}")
    print(f"  Items: {items[:10]}")
print(f"  /mnt/annotations exists: {os.path.exists('/mnt/annotations')}")
if os.path.exists('/mnt/annotations'):
    print(f"  /mnt/annotations is directory: {os.path.isdir('/mnt/annotations')}")
`, {
          onOutput: (output: any) => {
            console.log('[Mount Verification]', output.content);
          },
        });
      } else {
        console.warn('Mount directory function not available or no folder handle');
      }

      // Register the service with Hypha
      console.log('Registering service with Hypha...');
      // Default to TIFF files - the most common format for bioimage analysis
      const defaultSupportedTypes = ['.tif', '.tiff', '.TIF', '.TIFF'];
      const supportedFileTypesJson = JSON.stringify(defaultSupportedTypes);

      const registerCode = `
import asyncio
import json

# Note: In browser environment, file access is done through FileSystem API
# The service will be adapted to work with browser file handles

print("\\n" + "="*50)
print("REGISTERING DATA PROVIDER SERVICE")
print("="*50)

service_info = await register_service(
    "${serverUrl}",
    "${token}",
    '${supportedFileTypesJson}',
    "${sessionName}",
    "${sessionDescription}",
    None,
    "/mnt",
    "/mnt/annotations"
)

print("\\n" + "="*50)
print("SERVICE REGISTRATION COMPLETE")
print("="*50 + "\\n")

# Extract and print the actual service ID returned by Hypha
actual_service_id = service_info.get("id", "unknown")
print("===SERVICE_ID_START===")
print(actual_service_id)
print("===SERVICE_ID_END===")
service_info
`;

      let serviceId = '';
      let allOutput = '';

      await executeCode(registerCode, {
        onOutput: (output: any) => {
          console.log('[Register Output]', output.content);
          // Accumulate all output
          allOutput += output.content;
        },
      });

      // After execution, extract service ID from accumulated output
      if (allOutput.includes('===SERVICE_ID_START===') && allOutput.includes('===SERVICE_ID_END===')) {
        const startMarker = '===SERVICE_ID_START===';
        const endMarker = '===SERVICE_ID_END===';
        const startIdx = allOutput.indexOf(startMarker) + startMarker.length;
        const endIdx = allOutput.indexOf(endMarker);
        const extractedId = allOutput.substring(startIdx, endIdx).trim();
        // Remove any ANSI codes
        serviceId = extractedId.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').trim();
        console.log('Extracted service ID:', serviceId);
      }

      if (!serviceId) {
        throw new Error('Failed to extract service ID from registration. Check console for details.');
      }

      console.log('Using service ID:', serviceId);

      // Generate annotation URL
      const pluginUrl =
        'https://raw.githubusercontent.com/bioimage-io/bioimageio-colab/e765431/plugins/bioimageio-colab-annotator.imjoy.html';
      const configStr = JSON.stringify({
        serverUrl: serverUrl,
        imageProviderId: serviceId,
        token: token,
      });
      const encodedConfig = encodeURIComponent(configStr);
      const annotatorUrl = `https://imjoy.io/lite?plugin=${pluginUrl}&config=${encodedConfig}`;

      console.log('Annotation URL:', annotatorUrl);
      setAnnotationURL(annotatorUrl);

      // Set up periodic refresh of annotations list
      console.log('Setting up annotation monitoring...');
      const refreshInterval = setInterval(async () => {
        try {
          // First, sync the filesystem from Python VFS to native browser filesystem
          if (syncFileSystem) {
            const syncResult = await syncFileSystem('/mnt');
            if (syncResult.success) {
              console.log('[Refresh] FileSystem synced');
            } else if (syncResult.error) {
              console.log('[Refresh] Sync not available:', syncResult.error);
            }
          }

          // Then get fresh handle to annotations folder to force browser to see latest files
          if (imageFolderHandle) {
            const freshAnnotationsFolder = await imageFolderHandle.getDirectoryHandle('annotations', {
              create: false,
            });
            await updateFileList(freshAnnotationsFolder, setAnnotationsList, setIsLoadingAnnotations);
            console.log('[Refresh] Updated annotations list');
          }
        } catch (error) {
          console.error('Error refreshing annotations:', error);
        }
      }, 2000); // Refresh every 2 seconds

      // Store interval ID so it can be cleared later if needed
      (window as any).__colabRefreshInterval = refreshInterval;
      console.log('Annotation monitoring active - checking every 2 seconds');

      // Start event loop to keep service running
      console.log('Starting event loop...');
      executeCode(
        `
import asyncio
from js import console
try:
    loop = asyncio.get_event_loop()
    # Create a never-ending task to keep the service alive
    async def keep_alive():
        while True:
            await asyncio.sleep(60)
            console.log("Service still running...")

    asyncio.create_task(keep_alive())
    console.log("Event loop task created, service is now running")
    console.log("Ready to receive annotation requests!")
except Exception as e:
    console.log(f"Event loop setup: {e}")
`,
        {
          onOutput: (output: any) => {
            console.log('[Python Service]', output.content);
          },
        }
      );

      console.log('✓ Session created successfully!');
      console.log('Annotation URL:', annotatorUrl);

      setShowSessionModal(false);
    } catch (error) {
      console.error('Error creating session:', error);
      setError(
        `Failed to create session: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setIsCreatingSession(false);
      setIsRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
      <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-lg max-w-md w-full mx-4 border border-white/20">
        <div className="p-6 border-b border-gray-200/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl flex items-center justify-center mr-3">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-800">Create Annotation Session</h3>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Session Name *
            </label>
            <input
              type="text"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="e.g., Cell Segmentation Project"
              disabled={isCreatingSession}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
            <textarea
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
              rows={4}
              value={sessionDescription}
              onChange={(e) => setSessionDescription(e.target.value)}
              placeholder="Describe what this annotation session is for..."
              disabled={isCreatingSession}
            ></textarea>
          </div>

          <div className="flex items-center p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <input type="checkbox" checked disabled className="mr-2" />
            <span className="text-sm text-blue-700">
              Public session (visible to all logged-in users)
            </span>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-600 text-sm flex items-center">
                <svg
                  className="w-4 h-4 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {error}
              </p>
            </div>
          )}
        </div>

        <div className="p-6 pt-0 border-t border-gray-200/50 flex justify-end space-x-3">
          <button
            type="button"
            onClick={() => setShowSessionModal(false)}
            disabled={isCreatingSession}
            className="px-6 py-3 text-gray-600 bg-white border-2 border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 shadow-sm hover:shadow-md transition-all duration-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreateSession}
            disabled={!sessionName.trim() || isCreatingSession}
            className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed flex items-center shadow-sm hover:shadow-md transition-all duration-200"
          >
            {isCreatingSession ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                Creating...
              </>
            ) : (
              'Create'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionModal;
