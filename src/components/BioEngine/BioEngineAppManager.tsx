import React, { useState } from 'react';
import Editor from '@monaco-editor/react';
import yaml from 'js-yaml';

type ArtifactType = {
  id: string;
  name: string;
  type: string;
  workspace: string;
  parent_id: string;
  alias: string;
  description?: string;
  manifest?: any;
  supportedModes?: {
    cpu: boolean;
    gpu: boolean;
  };
  defaultMode?: string;
};

interface BioEngineAppManagerProps {
  serviceId: string;
  server: any;
  isLoggedIn: boolean;
  onArtifactUpdated?: () => void;
  ref?: React.Ref<{
    openCreateDialog: () => void;
    openEditDialog: (artifact: ArtifactType) => void;
  }>;
}

const BioEngineAppManager = React.forwardRef<
  {
    openCreateDialog: () => void;
    openEditDialog: (artifact: ArtifactType) => void;
  },
  BioEngineAppManagerProps
>(({
  serviceId,
  server,
  isLoggedIn,
  onArtifactUpdated
}, ref) => {
  // State management
  const [artifactManager, setArtifactManager] = useState<any>(null);

  // Create/Edit Dialog state
  const [createAppDialogOpen, setCreateAppDialogOpen] = useState(false);
  const [editingArtifact, setEditingArtifact] = useState<ArtifactType | null>(null);
  const [activeEditorTab, setActiveEditorTab] = useState(0);
  const [createAppLoading, setCreateAppLoading] = useState(false);
  const [createAppError, setCreateAppError] = useState<string | null>(null);

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // File management state
  const [files, setFiles] = useState<Array<{ name: string, content: string, language: string, lastModified?: string, size?: number, isEditable?: boolean }>>([]);
  const [editingFileName, setEditingFileName] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const [saveAsCopyLoading, setSaveAsCopyLoading] = useState(false);
  const [loadingArtifactFiles, setLoadingArtifactFiles] = useState(false);

  // Initialize artifact manager
  React.useEffect(() => {
    if (!isLoggedIn) return;

    const initArtifactManager = async () => {
      try {
        const manager = await server.getService('public/artifact-manager');
        setArtifactManager(manager);
      } catch (err) {
        console.error('Failed to initialize artifact manager:', err);
      }
    };

    initArtifactManager();
  }, [server, isLoggedIn]);

  // Default templates for new apps
  const getDefaultManifest = () => `id: my-new-app
name: My New App
description: A new BioEngine application
id_emoji: 🚀
type: application
# Optional: Add documentation and tutorial links
# documentation: https://example.com/docs
# tutorial: https://example.com/tutorial
# links:
#   - url: https://github.com/example/repo
#     label: Source Code
#     icon: 📦
#   - url: https://example.com/guide
#     label: User Guide
#     icon: 📖
deployment_config:
  name: MyNewApp
  num_replicas: 1
  ray_actor_options:
    num_cpus: 1
    num_gpus: 0
  modes:
    cpu:
      ray_actor_options:
        num_cpus: 1
        num_gpus: 0
    gpu:
      ray_actor_options:
        num_cpus: 1
        num_gpus: 1
deployment_class:
  class_name: MyNewApp
  python_file: main.py
  exposed_methods:
    ping:
      authorized_users: "*"
    process:
      authorized_users: "*"
  kwargs: {}
`;

  const getDefaultMainPy = () => `import time
from datetime import datetime

class MyNewApp:
    """A simple BioEngine application example."""
    
    def __init__(self):
        """Initialize the application."""
        self.start_time = time.time()
        print("MyNewApp initialized successfully!")
    
    def ping(self):
        """Simple ping method to test connectivity."""
        return {
            "status": "ok",
            "message": "Hello from MyNewApp!",
            "timestamp": datetime.now().isoformat(),
            "uptime": time.time() - self.start_time
        }
    
    def process(self, data=None):
        """Process some data - customize this for your use case."""
        if data is None:
            data = "No data provided"
        
        return {
            "status": "processed",
            "input": data,
            "output": f"Processed: {data}",
            "timestamp": datetime.now().isoformat()
        }
`;

  // Helper functions for file management
  const getFileLanguage = (fileName: string): string => {
    const extension = fileName.toLowerCase().split('.').pop() || '';
    const languageMap: Record<string, string> = {
      'yaml': 'yaml',
      'yml': 'yaml',
      'py': 'python',
      'js': 'javascript',
      'ts': 'typescript',
      'json': 'json',
      'md': 'markdown',
      'txt': 'plaintext',
      'sh': 'shell',
      'dockerfile': 'dockerfile',
      'ijm': 'plaintext',
      'cfg': 'plaintext',
      'conf': 'plaintext',
      'ini': 'plaintext'
    };
    return languageMap[extension] || 'plaintext';
  };

  const isEditableFile = (fileName: string): boolean => {
    const extension = fileName.toLowerCase().split('.').pop() || '';
    const editableExtensions = [
      'yaml', 'yml', 'py', 'js', 'ts', 'json', 'md', 'txt', 'sh', 'ijm',
      'cfg', 'conf', 'ini', 'dockerfile', 'requirements', 'gitignore'
    ];
    return editableExtensions.includes(extension) || fileName === 'Dockerfile' || fileName === 'requirements.txt';
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const updateFileContent = (fileName: string, content: string) => {
    setFiles(prevFiles =>
      prevFiles.map(file =>
        file.name === fileName ? { ...file, content } : file
      )
    );
  };

  const addNewFile = (fileName: string, content: string = '') => {
    const language = getFileLanguage(fileName);
    const isEditable = isEditableFile(fileName);
    setFiles(prevFiles => [...prevFiles, { name: fileName, content, language, isEditable }]);
  };

  const removeFile = (fileName: string) => {
    setFiles(prevFiles => prevFiles.filter(file => file.name !== fileName));
    const fileIndex = files.findIndex(file => file.name === fileName);
    if (fileIndex === activeEditorTab && files.length > 1) {
      setActiveEditorTab(0);
    }
  };

  const renameFile = (oldName: string, newName: string) => {
    if (oldName === newName || files.some(file => file.name === newName)) return;

    setFiles(prevFiles =>
      prevFiles.map(file =>
        file.name === oldName
          ? { ...file, name: newName, language: getFileLanguage(newName), isEditable: isEditableFile(newName) }
          : file
      )
    );
  };

  const isUserOwnedArtifact = (artifactId: string): boolean => {
    const userWorkspace = server.config.workspace;
    return userWorkspace && artifactId.startsWith(userWorkspace);
  };

  // Check if "Save as Copy" should be shown
  const shouldShowSaveAsCopy = (artifactId: string): boolean => {
    const isFromBioimageIoWorkspace = artifactId.startsWith('bioimage-io/');
    const userWorkspace = server.config.workspace;
    const isUserWorkspaceNotBioimageIo = userWorkspace !== 'bioimage-io';

    return isFromBioimageIoWorkspace && isUserWorkspaceNotBioimageIo;
  };

  // Delete artifact handler
  const handleDeleteArtifact = async () => {
    if (!editingArtifact || !artifactManager) return;

    setDeleteLoading(true);
    setDeleteError(null);

    try {
      await artifactManager.delete(editingArtifact.id);

      // Close dialogs and refresh
      setDeleteDialogOpen(false);
      setCreateAppDialogOpen(false);
      setEditingArtifact(null);
      setDeleteConfirmationText('');

      if (onArtifactUpdated) {
        onArtifactUpdated();
      }

      console.log('Successfully deleted artifact:', editingArtifact.id);
    } catch (err) {
      console.error('Failed to delete artifact:', err);
      setDeleteError(`Failed to delete artifact: ${err}`);
    } finally {
      setDeleteLoading(false);
    }
  };

  // Create App Dialog handlers
  const handleOpenCreateAppDialog = () => {
    setEditingArtifact(null);
    setFiles([
      { name: 'manifest.yaml', content: getDefaultManifest(), language: 'yaml', isEditable: true },
      { name: 'main.py', content: getDefaultMainPy(), language: 'python', isEditable: true }
    ]);
    setActiveEditorTab(0);
    setCreateAppError(null);
    setCreateAppDialogOpen(true);
  };

  const handleOpenEditAppDialog = async (artifact: ArtifactType) => {
    setEditingArtifact(artifact);
    setActiveEditorTab(0);
    setCreateAppError(null);
    setCreateAppLoading(true);
    setLoadingArtifactFiles(true);

    try {
      // Ensure artifactManager is available
      if (!artifactManager) {
        console.warn('ArtifactManager not available, trying to initialize...');
        try {
          const manager = await server.getService('public/artifact-manager');
          setArtifactManager(manager);
        } catch (err) {
          console.error('Failed to initialize artifact manager:', err);
          setCreateAppError('Failed to initialize artifact manager. Please try again.');
          setCreateAppLoading(false);
          return;
        }
      }

      const loadedFiles: Array<{ name: string, content: string, language: string, lastModified?: string, size?: number, isEditable?: boolean }> = [];

      // Always generate manifest.yaml from artifact.manifest metadata
      let manifestText = '';
      if (artifact.manifest) {
        let manifestObj: any = artifact.manifest;

        // Check if the manifest is URL-encoded string data
        if (typeof manifestObj === 'string' && manifestObj.includes('%')) {
          console.log('Detected URL-encoded manifest, decoding...');
          try {
            // Decode URL-encoded string and parse as query parameters
            const decoded = decodeURIComponent(manifestObj);
            console.log('Decoded manifest string:', decoded);

            // Parse query string format into object
            const params = new URLSearchParams(decoded);
            const parsedObj: any = {};
            params.forEach((value, key) => {
              try {
                // Try to parse values that look like JSON objects/arrays
                if (value.startsWith('{') || value.startsWith('[')) {
                  parsedObj[key] = JSON.parse(value.replace(/'/g, '"'));
                } else {
                  parsedObj[key] = value;
                }
              } catch {
                parsedObj[key] = value;
              }
            });
            manifestObj = parsedObj;
            console.log('Parsed manifest object from URL params:', manifestObj);
          } catch (parseErr) {
            console.warn('Failed to parse URL-encoded manifest:', parseErr);
            manifestObj = artifact.manifest;
          }
        }

        // Clean the manifest object to remove any non-serializable properties
        const cleanManifest = JSON.parse(JSON.stringify(manifestObj));

        manifestText = yaml.dump(cleanManifest, {
          indent: 2,
          lineWidth: 120,
          noRefs: true,
          skipInvalid: true,
          flowLevel: -1
        });
      } else {
        manifestText = getDefaultManifest();
      }

      // Add manifest.yaml as the first file
      loadedFiles.push({
        name: 'manifest.yaml',
        content: manifestText,
        language: 'yaml',
        isEditable: true
      });

      // Show dialog immediately with manifest.yaml while other files load
      setFiles(loadedFiles);
      setCreateAppDialogOpen(true);

      // Load other files in the background
      try {
        const currentArtifactManager = artifactManager || await server.getService('public/artifact-manager');
        const fileList = await currentArtifactManager.list_files({ artifact_id: artifact.id, _rkwargs: true });

        // Filter out manifest.yaml since we already have it, and load other files
        const filesToLoad = fileList.filter((file: any) =>
          file.name !== 'manifest.yaml' &&
          !file.name.endsWith('/') && // Skip directories
          file.name.length > 0
        );

        console.log('Files to load:', filesToLoad.map((f: any) => f.name));

        // Load content for each file
        for (const fileInfo of filesToLoad) {
          try {
            const isEditable = isEditableFile(fileInfo.name);
            const lastModified = fileInfo.last_modified ? new Date(fileInfo.last_modified).toLocaleString() : undefined;
            const size = fileInfo.size || 0;

            if (isEditable) {
              const fileUrl = await currentArtifactManager.get_file({
                artifact_id: artifact.id,
                file_path: fileInfo.name,
                _rkwargs: true
              });
              
              const response = await fetch(fileUrl);

              if (response.ok) {
                const content = await response.text();
                const newFile = {
                  name: fileInfo.name,
                  content: content,
                  language: getFileLanguage(fileInfo.name),
                  lastModified,
                  size,
                  isEditable: true
                };
                
                // Add file to the state immediately as it loads
                setFiles(prevFiles => [...prevFiles, newFile]);
              } else {
                console.warn(`Failed to fetch ${fileInfo.name}: ${response.status} ${response.statusText}`);
                // Add as non-editable if fetch failed
                const errorFile = {
                  name: fileInfo.name,
                  content: `// Failed to load file: ${response.status} ${response.statusText}\n// This might be a permission issue or the file might not exist.`,
                  language: 'plaintext',
                  lastModified,
                  size,
                  isEditable: false
                };
                setFiles(prevFiles => [...prevFiles, errorFile]);
              }
            } else {
              // Add binary/non-editable files to the list but don't load content
              const binaryFile = {
                name: fileInfo.name,
                content: `// Binary file - not editable\n// Size: ${formatFileSize(size)}\n// Last modified: ${lastModified || 'Unknown'}`,
                language: 'plaintext',
                lastModified,
                size,
                isEditable: false
              };
              setFiles(prevFiles => [...prevFiles, binaryFile]);
            }
          } catch (fileErr) {
            console.warn(`Error processing file ${fileInfo.name}:`, fileErr);
            // Add as error file
            const errorFile = {
              name: fileInfo.name,
              content: `// Error loading file: ${fileErr}\n// Please check the console for more details.`,
              language: 'plaintext',
              lastModified: fileInfo.last_modified ? new Date(fileInfo.last_modified).toLocaleString() : undefined,
              size: fileInfo.size || 0,
              isEditable: false
            };
            setFiles(prevFiles => [...prevFiles, errorFile]);
          }
        }

      } catch (listErr) {
        console.error('Failed to list or load files from artifact:', listErr);
        setCreateAppError(`Failed to load artifact files: ${listErr}. Using fallback files.`);
        
        // Fallback: try to load main.py individually
        try {
          const currentArtifactManager = artifactManager || await server.getService('public/artifact-manager');
          const mainPyUrl = await currentArtifactManager.get_file({ 
            artifact_id: artifact.id, 
            file_path: 'main.py', 
            _rkwargs: true 
          });
          const mainPyResponse = await fetch(mainPyUrl);
          
          if (mainPyResponse.ok) {
            const mainPyText = await mainPyResponse.text();
            const mainPyFile = {
              name: 'main.py',
              content: mainPyText,
              language: 'python',
              isEditable: true
            };
            setFiles(prevFiles => [...prevFiles, mainPyFile]);
          } else {
            throw new Error(`HTTP ${mainPyResponse.status}: ${mainPyResponse.statusText}`);
          }
        } catch (fileErr) {
          console.warn('Could not fetch main.py file, using default:', fileErr);
          const defaultMainPy = {
            name: 'main.py',
            content: getDefaultMainPy(),
            language: 'python',
            isEditable: true
          };
          setFiles(prevFiles => [...prevFiles, defaultMainPy]);
        }
      }

      // Ensure we have at least main.py - check current files state
      setFiles(prevFiles => {
        if (!prevFiles.some(f => f.name === 'main.py')) {
          return [...prevFiles, {
            name: 'main.py',
            content: getDefaultMainPy(),
            language: 'python',
            isEditable: true
          }];
        }
        return prevFiles;
      });

    } catch (err) {
      console.error('Failed to load artifact files for editing:', err);
      setCreateAppError(`Failed to load artifact files: ${err}`);
    } finally {
      setCreateAppLoading(false);
      setLoadingArtifactFiles(false);
    }
  };

  const handleCloseCreateAppDialog = () => {
    setCreateAppDialogOpen(false);
    setEditingArtifact(null);
    setFiles([]);
    setCreateAppError(null);
    setEditingFileName(null);
    setNewFileName('');
  };

  const handleCreateOrUpdateApp = async () => {
    if (!serviceId || !isLoggedIn || !artifactManager) return;

    setCreateAppLoading(true);
    setCreateAppError(null);

    try {
      const bioengineWorker = await server.getService(serviceId);

      // Find the manifest.yaml file
      const manifestFile = files.find(file => file.name === 'manifest.yaml');
      if (!manifestFile) {
        setCreateAppError('manifest.yaml file is required');
        return;
      }

      // Parse the manifest YAML to get the manifest object
      let manifestObj;
      try {
        manifestObj = yaml.load(manifestFile.content);
      } catch (yamlErr) {
        setCreateAppError(`Invalid YAML in manifest.yaml: ${yamlErr}`);
        return;
      }

      const filesToUpload = files.map(file => ({
        name: file.name,
        content: file.content,
        type: 'text'
      }));

      if (editingArtifact) {
        // For editing existing artifacts:
        // 1. Update the artifact's manifest metadata using artifactManager.edit
        // 2. Upload all files including the manifest.yaml

        // Update the manifest metadata
        await artifactManager.edit({ artifact_id: editingArtifact.id, manifest: manifestObj, _rkwargs: true });

        // Upload all files including manifest.yaml
        await bioengineWorker.create_artifact({ files: filesToUpload, artifact_id: editingArtifact.id, _rkwargs: true });

      } else {
        // For creating new artifacts, just use create_artifact with files
        await bioengineWorker.create_artifact({ files: filesToUpload, _rkwargs: true });
      }

      handleCloseCreateAppDialog();

      // Notify parent component if callback provided
      if (onArtifactUpdated) {
        onArtifactUpdated();
      }
    } catch (err) {
      console.error('Failed to create/update artifact:', err);
      setCreateAppError(`Failed to ${editingArtifact ? 'update' : 'create'} artifact: ${err}`);
    } finally {
      setCreateAppLoading(false);
    }
  };

  const handleSaveAsCopy = async () => {
    if (!serviceId || !isLoggedIn || !artifactManager) return;

    setSaveAsCopyLoading(true);
    setCreateAppError(null);

    try {
      const bioengineWorker = await server.getService(serviceId);

      // Find the manifest.yaml file
      const manifestFile = files.find(file => file.name === 'manifest.yaml');
      if (!manifestFile) {
        setCreateAppError('manifest.yaml file is required');
        return;
      }

      // Parse the manifest YAML and modify it for the copy
      let manifestObj: any;
      try {
        manifestObj = yaml.load(manifestFile.content);

        // Ensure the manifest ID is just the alias (not workspace/alias)
        if (manifestObj && manifestObj.id && typeof manifestObj.id === 'string' && manifestObj.id.includes('/')) {
          const idParts = manifestObj.id.split('/');
          manifestObj.id = idParts[idParts.length - 1]; // Get just the alias part
        }
      } catch (yamlErr) {
        setCreateAppError(`Invalid YAML in manifest.yaml: ${yamlErr}`);
        return;
      }

      // Update the manifest.yaml file with the modified content
      const updatedManifestContent = yaml.dump(manifestObj);
      const updatedFiles = files.map(file => ({
        name: file.name,
        content: file.name === 'manifest.yaml' ? updatedManifestContent : file.content,
        type: 'text'
      }));

      console.log('Creating copy of artifact in user workspace');
      await bioengineWorker.create_artifact({ files: updatedFiles, _rkwargs: true });

      handleCloseCreateAppDialog();

      // Notify parent component if callback provided
      if (onArtifactUpdated) {
        onArtifactUpdated();
      }
    } catch (err) {
      console.error('Failed to create artifact copy:', err);
      setCreateAppError(`Failed to create artifact copy: ${err}`);
    } finally {
      setSaveAsCopyLoading(false);
    }
  };

  // File management handlers
  const handleAddNewFile = () => {
    if (!newFileName.trim()) return;

    if (files.some(file => file.name === newFileName.trim())) {
      setCreateAppError(`File "${newFileName.trim()}" already exists`);
      return;
    }

    addNewFile(newFileName.trim());
    setActiveEditorTab(files.length);
    setNewFileName('');
    setCreateAppError(null);
  };

  const handleFileNameEdit = (fileName: string) => {
    setEditingFileName(fileName);
    setNewFileName(fileName);
  };

  const handleFileNameSave = () => {
    if (!editingFileName || !newFileName.trim()) return;

    if (newFileName.trim() !== editingFileName && files.some(file => file.name === newFileName.trim())) {
      setCreateAppError(`File "${newFileName.trim()}" already exists`);
      return;
    }

    renameFile(editingFileName, newFileName.trim());
    setEditingFileName(null);
    setNewFileName('');
    setCreateAppError(null);
  };

  const handleFileNameCancel = () => {
    setEditingFileName(null);
    setNewFileName('');
  };

  // Delete confirmation handlers for artifact deletion
  const handleOpenDeleteArtifactDialog = () => {
    setDeleteDialogOpen(true);
    setDeleteConfirmationText('');
  };

  const handleCloseDeleteArtifactDialog = () => {
    setDeleteDialogOpen(false);
    setDeleteConfirmationText('');
    setDeleteError(null);
  };

  // Expose methods for parent components
  React.useImperativeHandle(ref, () => ({
    openCreateDialog: handleOpenCreateAppDialog,
    openEditDialog: handleOpenEditAppDialog
  }), []);

  return (
    <>
      {/* Create/Edit App Dialog */}
      {createAppDialogOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-lg w-full max-w-6xl mx-4 h-5/6 flex flex-col border border-white/20">
            <div className="p-6 border-b border-gray-200/50 flex justify-between items-center">
              <div className="flex items-center">
                <div className="w-10 h-10 bg-gradient-to-r from-violet-500 to-purple-600 rounded-xl flex items-center justify-center mr-3">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-800">
                  {editingArtifact ? `Edit app: ${editingArtifact.manifest?.name || editingArtifact.alias}` : 'Create new app'}
                </h3>
              </div>
              <button
                onClick={handleCloseCreateAppDialog}
                className="text-gray-400 hover:text-gray-600 p-2 rounded-xl hover:bg-gray-100 transition-all duration-200"
                aria-label="Close dialog"
                title="Close dialog"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 flex flex-col min-h-0">
              {/* Tab Navigation with Add Button */}
              <div className="border-b border-gray-200 bg-gray-50 flex items-center">
                <div className="flex-1 flex overflow-x-auto">
                  {files.map((file, index) => (
                    <button
                      key={file.name}
                      onClick={() => setActiveEditorTab(index)}
                      className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${activeEditorTab === index
                        ? 'border-blue-500 text-blue-600 bg-white'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                        } ${!file.isEditable ? 'opacity-60' : ''}`}
                      title={file.isEditable ?
                        `${file.name}${file.size ? ` (${formatFileSize(file.size)})` : ''}${file.lastModified ? ` - Modified: ${file.lastModified}` : ''}` :
                        `${file.name} - Read-only${file.size ? ` (${formatFileSize(file.size)})` : ''}`
                      }
                    >
                      <div className="flex items-center gap-2">
                        {editingFileName === file.name ? (
                          <input
                            type="text"
                            value={newFileName}
                            onChange={(e) => setNewFileName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleFileNameSave();
                              if (e.key === 'Escape') handleFileNameCancel();
                            }}
                            onBlur={handleFileNameSave}
                            autoFocus
                            className="px-2 py-1 text-xs border border-gray-300 rounded"
                            aria-label="Edit filename"
                          />
                        ) : (
                          <div className="flex items-center gap-1">
                            {!file.isEditable && (
                              <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.314 16.5c-.77.833.192 2.5 1.732 2.5z" />
                              </svg>
                            )}
                            <span
                              onDoubleClick={() => file.isEditable && handleFileNameEdit(file.name)}
                              className={file.isEditable ? "cursor-pointer" : "cursor-default"}
                            >
                              {file.name}
                            </span>
                          </div>
                        )}
                        {file.name !== 'manifest.yaml' && files.length > 1 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              // When editing, just remove from local state (won't be included in update)
                              // When creating, remove from local state immediately
                              removeFile(file.name);
                            }}
                            className="ml-1 text-gray-400 hover:text-red-500"
                            aria-label={`Remove file ${file.name}`}
                            title={editingArtifact ? `Remove ${file.name} from app (will be excluded from update)` : `Remove ${file.name}`}
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </button>
                  ))}
                </div>

                {/* Add New File */}
                <div className="p-2 flex items-center gap-2 border-l border-gray-200">
                  <input
                    type="text"
                    placeholder="filename.ext"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddNewFile();
                    }}
                    className="px-2 py-1 text-xs border border-gray-300 rounded w-24"
                    aria-label="New filename"
                  />
                  <button
                    onClick={handleAddNewFile}
                    disabled={!newFileName.trim()}
                    className="p-1 text-blue-600 hover:text-blue-800 disabled:text-gray-400"
                    aria-label="Add new file"
                    title="Add new file"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Error Display */}
              {createAppError && (
                <div className="p-3 bg-red-50 border-b border-red-200">
                  <p className="text-sm text-red-600">{createAppError}</p>
                </div>
              )}

              {/* Loading indicator while files are being loaded */}
              {loadingArtifactFiles && editingArtifact && (
                <div className="p-3 bg-blue-50 border-b border-blue-200">
                  <div className="flex items-center">
                    <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-2"></div>
                    <p className="text-sm text-blue-700">Loading artifact files...</p>
                  </div>
                </div>
              )}

              {/* Editor Content */}
              <div className="flex-1 min-h-0">
                {files.length > 0 && files[activeEditorTab] && (
                  <div className="h-full flex flex-col">
                    {/* File info bar for non-editable files */}
                    {!files[activeEditorTab].isEditable && (
                      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-800">
                        <div className="flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.314 16.5c-.77.833.192 2.5 1.732 2.5z" />
                          </svg>
                          <span className="font-medium">Read-only file</span>
                          {files[activeEditorTab].size && (
                            <span>• Size: {formatFileSize(files[activeEditorTab].size!)}</span>
                          )}
                          {files[activeEditorTab].lastModified && (
                            <span>• Modified: {files[activeEditorTab].lastModified}</span>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex-1">
                      <Editor
                        height="100%"
                        language={files[activeEditorTab].language}
                        value={files[activeEditorTab].content}
                        onChange={(value) => {
                          if (files[activeEditorTab].isEditable) {
                            updateFileContent(files[activeEditorTab].name, value || '');
                          }
                        }}
                        options={{
                          minimap: { enabled: false },
                          scrollBeyondLastLine: false,
                          fontSize: 14,
                          lineNumbers: 'on',
                          wordWrap: 'on',
                          automaticLayout: true,
                          tabSize: 2,
                          insertSpaces: true,
                          readOnly: !files[activeEditorTab].isEditable,
                        }}
                        theme="light"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 bg-gray-50 flex justify-end space-x-3">
              <button
                onClick={handleCloseCreateAppDialog}
                disabled={createAppLoading}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>

              {/* Show "Delete" button only when editing an artifact owned by the user */}
              {editingArtifact && isUserOwnedArtifact(editingArtifact.id) && (
                <button
                  onClick={handleOpenDeleteArtifactDialog}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center"
                  title="Delete this app permanently"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete
                </button>
              )}

              {/* Show "Save as Copy" button only when editing an artifact from bioimage-io workspace and user is not in bioimage-io workspace */}
              {editingArtifact && shouldShowSaveAsCopy(editingArtifact.id) && (
                <button
                  onClick={handleSaveAsCopy}
                  disabled={saveAsCopyLoading || files.length === 0 || !files.some(f => f.name === 'manifest.yaml')}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
                  title="Create a copy of this app in your workspace"
                >
                  {saveAsCopyLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                      Creating Copy...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 00-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      Save as Copy
                    </>
                  )}
                </button>
              )}

              <button
                onClick={handleCreateOrUpdateApp}
                disabled={createAppLoading || files.length === 0 || !files.some(f => f.name === 'manifest.yaml')}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
              >
                {createAppLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                    {editingArtifact ? 'Updating...' : 'Creating...'}
                  </>
                ) : (
                  editingArtifact ? 'Update app' : 'Create app'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete App Confirmation Dialog */}
      {deleteDialogOpen && editingArtifact && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center mb-4">
              <svg className="w-6 h-6 text-red-600 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <h3 className="text-lg font-semibold text-gray-900">Delete App</h3>
            </div>

            <p className="text-gray-600 mb-4">
              This action cannot be undone. This will permanently delete the app and all its associated data.
            </p>

            <p className="text-sm text-gray-500 mb-2">
              To confirm, type the full artifact ID: <span className="font-mono bg-gray-100 px-1 rounded">{editingArtifact.id}</span>
            </p>

            <input
              type="text"
              value={deleteConfirmationText}
              onChange={(e) => setDeleteConfirmationText(e.target.value)}
              placeholder="Enter artifact ID to confirm"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent mb-4"
            />

            {deleteError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{deleteError}</p>
              </div>
            )}

            <div className="flex justify-end space-x-3">
              <button
                onClick={handleCloseDeleteArtifactDialog}
                disabled={deleteLoading}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                onClick={handleDeleteArtifact}
                disabled={deleteLoading || deleteConfirmationText !== editingArtifact.id}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
              >
                {deleteLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                    Deleting...
                  </>
                ) : (
                  'Delete App'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

export default BioEngineAppManager;
