import React, { useState, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { useHyphaStore } from '../store/hyphaStore';
import { Dialog as MuiDialog, Checkbox, FormControlLabel } from '@mui/material';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArtifactInfo } from '../types/artifact';
import { useDropzone } from 'react-dropzone';
import yaml from 'js-yaml';
import RDFEditor from './RDFEditor';
import gridBg from '../assets/grid.svg';

// Helper function to extract weight file paths from manifest
const extractWeightFiles = (manifest: any): string[] => {
  if (!manifest || !manifest.weights) return [];
  
  const weightFiles: string[] = [];
  Object.entries(manifest.weights).forEach(([_, weightInfo]: [string, any]) => {
    if (weightInfo && weightInfo.source) {
      // Handle paths that might start with ./ or just be filenames
      let path = weightInfo.source;
      if (path.startsWith('./')) {
        path = path.substring(2);
      }
      weightFiles.push(path);
    }
  });
  
  return weightFiles;
};

// Add this interface for size-only file info
interface SizeInfo {
  fileSize: number;
  type: 'size-only';
}

interface FileNode {
  name: string;
  path: string;
  content?: string | ArrayBuffer | SizeInfo;
  isDirectory: boolean;
  children?: FileNode[];
  edited?: boolean;
  isCommentsFile?: boolean;
  fileSize?: number;
}

// Add this interface for the tab type
interface ContentTab {
  id: 'files' | 'review';
  label: string;
  icon: React.ReactNode;
}

// Add this type definition near other interfaces
interface KeyboardShortcut {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  handler: () => void;
}

// Add interface for validation result
interface ValidationResult {
  success: boolean;
  errors: string[];
}

const Edit: React.FC = () => {
  // get edit version from url
  const { version } = useParams<{ version: string }>();
  const { artifactId } = useParams<{ artifactId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Determine where to navigate back to
  const getBackPath = () => {
    const referrerParam = searchParams.get('from');
    if (referrerParam) {
      return referrerParam;
    }
    
    // Check document.referrer for common paths
    const referrer = document.referrer;
    if (referrer.includes('/review')) {
      return '/review';
    }
    if (referrer.includes('/my-artifacts')) {
      return '/my-artifacts';
    }
    
    // Default fallback
    return '/my-artifacts';
  };
  const [files, setFiles] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const { artifactManager, isLoggedIn, server, user} = useHyphaStore();
  const [uploadStatus, setUploadStatus] = useState<{
    message: string;
    severity: 'info' | 'success' | 'error';
    progress?: number;
  } | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [unsavedChanges, setUnsavedChanges] = useState<{[key: string]: string}>({});
  const [activeTab, setActiveTab] = useState<'files' | 'review'>(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam?.startsWith('@')) {
      return 'files';
    }
    return (tabParam as 'files' | 'review') || 'files';
  });
  const [artifactInfo, setArtifactInfo] = useState<ArtifactInfo | null>(null);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showDeleteVersionDialog, setShowDeleteVersionDialog] = useState(false);
  const [isStaged, setIsStaged] = useState<boolean>(version === 'stage');
  const [showNewVersionDialog, setShowNewVersionDialog] = useState(false);
  const [newVersionData, setNewVersionData] = useState({
    copyFiles: true
  });
  const [isCreatingVersion, setIsCreatingVersion] = useState(false);
  const [copyProgress, setCopyProgress] = useState<{
    current: number;
    total: number;
    file: string;
  } | null>(null);

  const [isContentValid, setIsContentValid] = useState<boolean>(true);
  const [hasContentChanged, setHasContentChanged] = useState<boolean>(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    return window.innerWidth >= 1024; // 1024px is the lg breakpoint in Tailwind
  });
  const [isCollectionAdmin, setIsCollectionAdmin] = useState(false);
  const [lastVersion, setLastVersion] = useState<string | null>(null);
  const [artifactType, setArtifactType] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [editVersion, setEditVersion] = useState<string | undefined>(version);
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);
  useEffect(() => {
    setEditVersion(version);
  }, [version]);

  useEffect(() => {
    if (!isLoggedIn) {
      navigate('/');
    }
  }, [isLoggedIn, navigate]);

  useEffect(() => {
    if (artifactId && artifactManager && isLoggedIn) {
      loadArtifactFiles();
    }
  }, [artifactId, artifactManager, isLoggedIn]);

  useEffect(() => {
    if (artifactInfo?.versions && artifactInfo.versions.length > 0) {
      const lastVersionObj = artifactInfo.versions[artifactInfo.versions.length - 1];
      setLastVersion(lastVersionObj.version);
    } else {
      setLastVersion(null);
    }
  }, [artifactInfo]);

  const isTextFile = (filename: string): boolean => {
    const textExtensions = [
      '.txt', '.yml', '.yaml', '.json', '.md', '.py', 
      '.js', '.ts', '.jsx', '.tsx', '.css', '.html',
      '.ijm'
    ];
    return textExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  };

  const isImageFile = (filename: string): boolean => {
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif'];
    return imageExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getImageDataUrl = async (content: string | ArrayBuffer, fileName: string): Promise<string> => {
    if (typeof content === 'string') {
      const encoder = new TextEncoder();
      const uint8Array = encoder.encode(content);
      content = uint8Array.buffer as ArrayBuffer;
    }
    
    const extension = fileName.toLowerCase().split('.').pop() || '';
    const bytes = new Uint8Array(content as ArrayBuffer);
    const binary = bytes.reduce((data, byte) => data + String.fromCharCode(byte), '');
    const base64 = btoa(binary);
    
    const mimeType = `image/${extension === 'jpg' ? 'jpeg' : extension}`;
    return `data:${mimeType};base64,${base64}`;
  };

  const getEditorLanguage = (filename: string): string => {
    const extension = filename.toLowerCase().split('.').pop() || '';
    const languageMap: Record<string, string> = {
      'py': 'python',
      'js': 'javascript',
      'ts': 'typescript',
      'jsx': 'javascript',
      'tsx': 'typescript',
      'css': 'css',
      'html': 'html',
      'json': 'json',
      'yml': 'yaml',
      'yaml': 'yaml',
      'md': 'markdown',
      'txt': 'plaintext',
      'ijm': 'javascript'
    };
    return languageMap[extension] || 'plaintext';
  };

  const loadArtifactFiles = async () => {
    if (!artifactManager || !artifactId || !server) return;
    try {
      setIsLoadingFiles(true);
      setUploadStatus({
        message: 'Loading files...',
        severity: 'info'
      });
      if (!artifactId) {
        setUploadStatus({
          message: 'No artifact ID',
          severity: 'error'
        });
        setIsLoadingFiles(false);
        return;
      }
      // Get artifact info
      const artifact = await artifactManager.read({
        artifact_id: artifactId,
        version: editVersion,
        _rkwargs: true
      });
      console.log("DEBUG:", {artifact, editVersion})
      if(!editVersion) {
        // get the last value of .versions
        setEditVersion(artifact.versions[artifact.versions.length - 1].version);
      }
      
      // Set artifact type from manifest
      setArtifactType(artifact.manifest?.type || null);
      
      // Check collection admin status
      try {
        const collection = await artifactManager.read({
          artifact_id: 'ri-scale/ai-model-hub',
          _rkwargs: true
        });

        if (user) {
          // Check if user is in collection permissions or has admin role
          const isAdmin = (collection.config?.permissions && user.id in collection.config.permissions) ||
                         user.roles?.includes('admin');
          setIsCollectionAdmin(isAdmin);
        }
      } catch (error) {
        console.error('Error checking collection admin status:', error);
        setIsCollectionAdmin(false);
      }
    
      setArtifactInfo(artifact);

      // List all files using the correct version
      const fileList = await artifactManager.list_files({
        artifact_id: artifactId || '',
        version: isStaged ? 'stage' : 'latest', 
        _rkwargs: true
      });

      if (!fileList || fileList.length === 0) {
        setFiles([]);
        setUploadStatus({
          message: 'No files found',
          severity: 'error'
        });
        setIsLoadingFiles(false);
        return;
      }

      // Convert the file list to FileNode format without fetching content
      const nodes: FileNode[] = fileList.map((file: any) => ({
        name: file.name,
        path: file.name,
        isDirectory: file.type === 'directory',
        children: file.type === 'directory' ? [] : undefined,
        isCommentsFile: file.name === 'comments.json'
      }));

      setFiles(nodes);
      setUploadStatus({
        message: 'Files loaded successfully',
        severity: 'success'
      });
      setIsLoadingFiles(false);

      // Preserve the current tab state
      const currentTab = searchParams.get('tab');
      if (currentTab) {
        // If we're in review tab or have a specific file selected, maintain that state
        if (currentTab === 'review' || currentTab.startsWith('@')) {
          handleTabChange(currentTab === 'review' ? 'review' : 'files', 
            currentTab.startsWith('@') ? currentTab.substring(1) : undefined);
        }
      }

    } catch (error) {
      console.error('Error loading artifact files:', error);
      setUploadStatus({
        message: 'Error loading files',
        severity: 'error'
      });
      setIsLoadingFiles(false);
    }
  };

  const fetchFileContent = async (file: FileNode) => {
    if (!artifactManager || file.isDirectory) return;

    try {
      setUploadStatus({
        message: 'Loading file content...',
        severity: 'info'
      });

      const url = await artifactManager.get_file({
        artifact_id: artifactId || '',
        file_path: file.path,
        version: editVersion,
        _rkwargs: true
      });
      
      // For text or image files, download the full content
      if (isTextFile(file.name) || isImageFile(file.name)) {
        const response = await fetch(url);
        const content = isTextFile(file.name) ? 
          await response.text() : 
          await response.arrayBuffer();

        setUploadStatus({
          message: 'File loaded successfully',
          severity: 'success'
        });

        return content;
      } 
      // For unknown file types, just get the size using a HEAD request or Range request
      else {

        // If HEAD request fails or doesn't return content-length, try a Range request
        const rangeResponse = await fetch(url, {
          headers: {
            Range: 'bytes=0-1' // Just get the first byte to determine file existence and size
          }
        });
        
        // Get content-range header which contains the file size
        const contentRange = rangeResponse.headers.get('content-range');
        let size = 0;
        
        if (contentRange) {
          // content-range format is like "bytes 0-1/12345" where 12345 is the total size
          const match = contentRange.match(/bytes \d+-\d+\/(\d+)/);
          if (match) {
            size = parseInt(match[1], 10);
          }
        } else if (rangeResponse.headers.get('content-length')) {
          // If there's no content-range but there is content-length
          size = parseInt(rangeResponse.headers.get('content-length')!, 10);
        }
        
        setUploadStatus({
          message: 'File info loaded successfully',
          severity: 'success'
        });
        
        // Return a placeholder with size info
        return {
          fileSize: size,
          type: 'size-only' as const
        };
      }
    } catch (error) {
      console.error('Error fetching file content:', error);
      setUploadStatus({
        message: 'Error loading file content',
        severity: 'error'
      });
    }
  };

  const handleFileSelect = async (file: FileNode) => {
    // First check if the file still exists in our files array
    const fileExists = files.some(f => f.path === file.path);
    if (!fileExists) {
      setUploadStatus({
        message: `File ${file.name} no longer exists`,
        severity: 'error'
      });
      return;
    }

    // Only update URL if it's different from current selection
    const currentPath = searchParams.get('tab')?.substring(1);
    if (currentPath !== file.path) {
      handleTabChange('files', file.path);
    }
    
    setSelectedFile(file);
    setImageUrl(null);
    
    // Only fetch content if it hasn't been loaded yet
    if (!file.content) {
      const content = await fetchFileContent(file);
      if (content) {
        // Create updated file with content
        const updatedFile = { ...file, content };
        
        // Update selected file
        setSelectedFile(updatedFile);
        
        // Update file in files array while preserving other files
        setFiles(prevFiles => 
          prevFiles.map(f => 
            f.path === file.path ? updatedFile : f
          )
        );

        // If the file is an image, generate URL
        if (isImageFile(file.name) && (typeof content === 'string' || content instanceof ArrayBuffer)) {
          try {
            const url = await getImageDataUrl(content, file.name);
            setImageUrl(url);
          } catch (error) {
            console.error('Error generating image URL:', error);
          }
        }
      }
    } else if (isImageFile(file.name) && (typeof file.content === 'string' || file.content instanceof ArrayBuffer)) {
      // If content is already loaded and it's an image, just generate the image URL
      try {
        const url = await getImageDataUrl(file.content, file.name);
        setImageUrl(url);
      } catch (error) {
        console.error('Error generating image URL:', error);
      }
    }
  };

  // Update the validateRdfContent function
  const validateRdfContent = (content: string, artifactId: string, artifactEmoji: string | null, userEmail: string): ValidationResult => {
    try {
      const manifest = yaml.load(content) as any;
      const errors: string[] = [];

      // Check if id matches
      const shortId = artifactId.split('/').pop() || '';
      if (manifest.id !== shortId) {
        errors.push(`The 'id' field must be "${shortId}"`);
      }

      // Check if id_emoji matches
      if (manifest.id_emoji !== artifactEmoji) {
        errors.push(`The 'id_emoji' field must be "${artifactEmoji}"`);
      }

      // Only check uploader email if not a collection admin
      if (!isCollectionAdmin) {
        // Check uploader email only if it exists
        if (manifest.uploader?.email && manifest.uploader.email !== userEmail) {
          errors.push(`The uploader email must be "${userEmail}"`);
        }

        // Check legacy nickname fields
        if (manifest.config?.bioimageio?.nickname && manifest.config.bioimageio.nickname !== shortId) {
          errors.push(`Legacy nickname field 'config.bioimageio.nickname' must be "${shortId}"`);
        }
        if (manifest.config?.bioimageio?.nickname_icon && manifest.config.bioimageio.nickname_icon !== artifactEmoji) {
          errors.push(`Legacy nickname field 'config.bioimageio.nickname_icon' must be "${artifactEmoji}"`);
        }
      }

      return {
        success: errors.length === 0,
        errors
      };
    } catch (error) {
      return {
        success: false,
        errors: ['Invalid YAML format']
      };
    }
  };

  const handleEditorChange = (value: string | undefined, file: FileNode) => {
    if (!value || !file) return;
    
    // Create updated file with new content
    const updatedFile = { ...file, content: value, edited: true };
    
    // Update files array while preserving other files
    setFiles(prevFiles => 
      prevFiles.map(f => 
        f.path === file.path ? updatedFile : f
      )
    );
    
    // Update selected file
    setSelectedFile(updatedFile);
    
    // Store unsaved changes
    setUnsavedChanges(prev => ({
      ...prev,
      [file.path]: value
    }));

    // If this is the rdf.yaml file, mark content as changed and invalidate previous validation
    if (file.path.endsWith('rdf.yaml')) {
      setHasContentChanged(true);
      setIsContentValid(false);
    }
  };

  const handleSave = async (file: FileNode) => {
    if (!artifactManager || !unsavedChanges[file.path]) return;

    // Check if this is an RDF file with changes that haven't been validated
    if (file.path.endsWith('rdf.yaml') && hasContentChanged && !isContentValid) {
      // If it's an RDF file and has changes that haven't been validated, run validation first
      if (!user?.email) {
        setValidationErrors(['You must be logged in to save changes']);
        return;
      }

      // Get the latest content
      const content = unsavedChanges[file.path];
      
      // Validate the content
      const validation = validateRdfContent(
        content,
        artifactInfo?.id || "",
        artifactInfo?.manifest?.id_emoji || null,
        user.email
      );

      if (!validation.success) {
        // Show validation errors
        setValidationErrors(validation.errors);
        setUploadStatus({
          message: 'Validation failed. Please fix the errors before saving.',
          severity: 'error'
        });
        return;
      }
      
      // Mark content as valid if validation passes
      setIsContentValid(true);
      setHasContentChanged(false);
    }

    try {
      setUploadStatus({
        message: 'Saving changes...',
        severity: 'info'
      });

      // If user is collection admin and not in stage mode, create temporary stage
      let needsStageCleanup = false;
      if (isCollectionAdmin && !isStaged) {
        try {
          // Create temporary stage
          await artifactManager.edit({
            artifact_id: artifactId,
            stage: true,
            _rkwargs: true
          });
          needsStageCleanup = true;
        } catch (error) {
          console.error('Error creating temporary stage:', error);
          setUploadStatus({
            message: 'Error creating temporary stage',
            severity: 'error'
          });
          return;
        }
      }

      try {
        // For rdf.yaml, validate content before saving
        if (file.path.endsWith('rdf.yaml')) {
          if (!user?.email) {
            setValidationErrors(['You must be logged in to save changes']);
            return;
          }

          // Parse the YAML content
          let content = unsavedChanges[file.path];
          let manifest = yaml.load(content) as any;

          // Only add/update uploader info if not a collection admin and uploader is missing
          if (!isCollectionAdmin) {
            if (!manifest.uploader?.email) {
              manifest.uploader = {
                ...manifest.uploader,
                email: user.email
              };
              // Update the content with new uploader info
              content = yaml.dump(manifest);
              // Update unsaved changes with new content
              setUnsavedChanges(prev => ({
                ...prev,
                [file.path]: content
              }));
            }
          }

          // Proceed with full validation
          const validation = validateRdfContent(
            content,
            artifactInfo?.id || '',
            artifactInfo?.manifest?.id_emoji || null,
            user.email
          );

          if (!validation.success) {
            setValidationErrors(validation.errors);
            return;
          }

          try {
            // Get the existing manifest to preserve fields like status
            const existingManifest = artifactInfo?.manifest || {};
            // Merge the existing manifest with the new one from the editor
            const mergedManifest = {
              ...existingManifest,
              ...manifest
            };

            // Get the presigned URL for uploading
            const presignedUrl = await artifactManager.put_file({
              artifact_id: artifactId,
              file_path: file.path,
              _rkwargs: true
            });

            // Upload the file content
            const response = await fetch(presignedUrl, {
              method: 'PUT',
              body: content,
              headers: {
                'Content-Type': '' // important for s3
              }
            });

            if (!response.ok) {
              throw new Error('Failed to upload file');
            }

            // Update the manifest
            await artifactManager.edit({
              artifact_id: artifactId,
              manifest: mergedManifest, // Use the merged manifest
              _rkwargs: true
            });

            // Update local state
            if ('type' in mergedManifest) { // Use mergedManifest here
              setArtifactType(mergedManifest.type as string);
            }
            
            // Update artifactInfo with new manifest
            setArtifactInfo(prev => prev ? {
              ...prev,
              manifest: {
                ...prev.manifest,
                ...mergedManifest // Use mergedManifest here
              }
            } : null);

          } catch (error) {
            console.error('Error saving rdf.yaml:', error);
            setUploadStatus({
              message: 'Error saving rdf.yaml',
              severity: 'error'
            });
            return;
          }
        } else {
          // Handle non-rdf.yaml files
          const presignedUrl = await artifactManager.put_file({
            artifact_id: artifactId,
            file_path: file.path,
            _rkwargs: true
          });

          const response = await fetch(presignedUrl, {
            method: 'PUT',
            body: unsavedChanges[file.path],
            headers: {
              'Content-Type': '' // important for s3
            }
          });

          if (!response.ok) {
            throw new Error('Failed to upload file');
          }
        }

        // If we created a temporary stage, commit changes immediately
        if (needsStageCleanup) {
          try {
            await artifactManager.commit({
              artifact_id: artifactId,
              comment: `Updated ${file.path}`,
              _rkwargs: true
            });

            // Refresh artifact files to get the latest state
            await loadArtifactFiles();
          } catch (error) {
            console.error('Error committing changes:', error);
            setUploadStatus({
              message: 'Error committing changes',
              severity: 'error'
            });
            return;
          }
        }

        // Update the local state
        setFiles(files.map(f => 
          f.path === file.path 
            ? { ...f, content: unsavedChanges[file.path], edited: false }
            : f
        ));

        // Clear unsaved changes for this file
        setUnsavedChanges(prev => {
          const newState = { ...prev };
          delete newState[file.path];
          return newState;
        });

        setUploadStatus({
          message: needsStageCleanup ? 'Changes saved and committed' : 'Changes saved',
          severity: 'success'
        });

      } catch (error) {
        console.error('Error in save process:', error);
        setUploadStatus({
          message: 'Error saving changes',
          severity: 'error'
        });
      }
    } catch (error) {
      console.error('Error in save process:', error);
      setUploadStatus({
        message: 'Error saving changes',
        severity: 'error'
      });
    }
  };

  const handlePublish = async () => {
    try {
      setUploadStatus({
        message: 'Publishing artifact...',
        severity: 'info'
      });
      const artifact = await artifactManager?.commit({
        artifact_id: artifactId,
        comment: `Published by ${user?.email}`,
        _rkwargs: true
      });

      // add create_zip_file to download_weights
      const newConfig = {
        ...artifact.config,
        download_weights:{
          ...artifact.config.download_weights,
          create_zip_file: 1.0
        }
      };

      // update the manifest
      const newManifest = {
        ...artifact.manifest,
        status: 'published'
      };

      await artifactManager?.edit({
        artifact_id: artifactId,
        config: newConfig,
        manifest: newManifest,
        _rkwargs: true
      });

      setUploadStatus({
        message: 'Changes committed successfully',
        severity: 'success'
      });
      
      setShowPublishDialog(false);
      
      // Clear edited flags after successful commit
      setFiles(prevFiles => 
        prevFiles.map(f => ({
          ...f,
          edited: false
        }))
      );

      // Navigate back to the appropriate page after successful publish
      navigate(getBackPath());

    } catch (error) {
      console.error('Error publishing artifact:', error);
      setUploadStatus({
        message: 'Error publishing artifact',
        severity: 'error'
      });
    }
  };

  // Add helper function to get file size
  const getFileSize = (file: FileNode): number | undefined => {
    if (!file.content) return undefined;
    
    // If content is SizeInfo
    if (typeof file.content === 'object' && 'type' in file.content && file.content.type === 'size-only') {
      return file.content.fileSize;
    }
    
    // If content is ArrayBuffer
    if (file.content instanceof ArrayBuffer) {
      return file.content.byteLength;
    }
    
    // If content is string
    if (typeof file.content === 'string') {
      return file.content.length;
    }
    
    return undefined;
  };

  const renderFileContent = () => {
    if (!selectedFile) {
      return (
        <div className="h-[calc(100vh-145px)] flex items-center justify-center text-gray-500">
          Select a file to view or edit
        </div>
      );
    }

    if (!selectedFile.content) {
      return (
        <div className="h-[calc(100vh-145px)] flex flex-col items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#f39200] mb-4"></div>
          <div className="text-xl font-semibold text-gray-700">Loading file content...</div>
        </div>
      );
    }

    if (selectedFile.name.endsWith('rdf.yaml')) {
      return (
        <div className="h-[calc(100vh-145px)]">
          <RDFEditor
            content={unsavedChanges[selectedFile.path] ?? 
              (typeof selectedFile.content === 'string' ? selectedFile.content : '')}
            onChange={(value) => handleEditorChange(value, selectedFile)}
            readOnly={false}
            showModeSwitch={true}
          />
        </div>
      );
    }

    if (isImageFile(selectedFile.name)) {
      // Get file size and type information
      const fileSize = getFileSize(selectedFile);
      const fileType = selectedFile.name.split('.').pop()?.toUpperCase() || 'Unknown';
      
      // Check if this is a cover image
      const isCoverImage = artifactInfo?.manifest?.covers?.some(
        cover => cover === selectedFile.name
      );
      
      // Determine warning status for cover images
      const isTooBig = isCoverImage && imageDimensions && 
        (imageDimensions.width > 300 || imageDimensions.height > 160);
      
      return (
        <div className="flex flex-col items-center justify-center p-8">
          <div className="relative w-full max-w-4xl bg-white rounded-xl shadow-lg overflow-hidden">
            {/* File info badge */}
            <div className="absolute top-4 right-4 bg-black/70 backdrop-blur-sm text-white px-3 py-1.5 rounded-lg text-sm font-medium z-10 flex items-center gap-2">
              <span>{fileType}</span>
              <span>•</span>
              <span>{imageDimensions ? `${imageDimensions.width}×${imageDimensions.height}` : '...'}</span>
              <span>•</span>
              <span>{fileSize !== undefined ? formatFileSize(fileSize) : 'Unknown'}</span>
            </div>
            
            {/* Cover image warning */}
            {isCoverImage && (
              <div className={`absolute top-16 right-4 px-3 py-1.5 rounded-lg text-sm font-medium z-10 flex items-center gap-2 ${
                isTooBig ? 'bg-red-100 text-red-800' : 'bg-orange-100 text-orange-800'
              }`}>
                {isTooBig ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span>Cover image too large (max: 300×160)</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>Cover image (max: 300×160)</span>
                  </>
                )}
              </div>
            )}
            
            {/* Image container */}
            <div 
              className="relative aspect-video flex items-center justify-center p-4 bg-gray-50"
              style={{ backgroundImage: `url(${gridBg})` }}
            >
              {imageUrl ? (
                <img 
                  src={imageUrl}
                  alt={selectedFile.name}
                  className="max-w-full max-h-[70vh] h-auto object-contain rounded-lg"
                  onLoad={() => checkImageDimensions(imageUrl, selectedFile.name)}
                />
              ) : (
                <div className="flex items-center justify-center h-40 w-full">
                  <div className="text-gray-400 flex flex-col items-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#f39200] mb-2"></div>
                    <span>Loading image...</span>
                  </div>
                </div>
              )}
            </div>
            
            {/* File name footer */}
            <div className="px-4 py-3 bg-gray-50 border-t">
              <p className="text-sm text-gray-600 font-medium truncate">
                {selectedFile.name}
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (isTextFile(selectedFile.name)) {
      return (
        <div className="flex flex-col gap-4 p-4">
          <Editor
            height="calc(100vh - 177px)"
            language={getEditorLanguage(selectedFile.name)}
            value={unsavedChanges[selectedFile.path] ?? 
              (typeof selectedFile.content === 'string' ? selectedFile.content : '')}
            onChange={(value: string | undefined) => handleEditorChange(value ?? '', selectedFile)}
            options={{
              minimap: { enabled: false },
              scrollBeyondLastLine: true,
              wordWrap: 'on',
              lineNumbers: 'on',
              renderWhitespace: 'selection',
              folding: true,
              readOnly: false // Explicitly set readOnly to false
            }}
          />
        </div>
      );
    }

    // For binary or other unknown file types
    const fileSize = getFileSize(selectedFile);
    
    return (
      <div className="h-[calc(100vh-113px)] flex items-center justify-center">
        <div className="bg-gray-50 p-6 rounded-lg max-w-md w-full mx-4">
          <h3 className="font-medium text-lg mb-4">File Information</h3>
          <div className="space-y-2">
            <p><span className="font-medium">Name:</span> {selectedFile.name}</p>
            <p><span className="font-medium">Size:</span> {fileSize !== undefined ? formatFileSize(fileSize) : 'Unknown'}</p>
            <p><span className="font-medium">Type:</span> {selectedFile.name.split('.').pop()?.toUpperCase() || 'Unknown'}</p>
          </div>
          <p className="mt-4 text-sm text-gray-400">This file type cannot be previewed</p>
        </div>
      </div>
    );
  };

  // Define available tabs
  const tabs: ContentTab[] = [
    {
      id: 'files',
      label: 'Files',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      )
    }
  ];

  // Update renderContent to use activeTab
  const renderContent = () => {
    return renderFileContent();
  };

  // Update the navigation button
  const renderSidebarNav = () => (
    <>
      {/* Only show New Version button if not in staging mode */}
      {!isStaged && (
        <div className="p-4 border-b bg-white space-y-2">
          <button
            onClick={() => setShowNewVersionDialog(true)}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors bg-white text-gray-700 border hover:bg-gray-50 focus:ring-2 focus:ring-[#f39200]"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            New Version
          </button>
          <button
            onClick={() => setShowDeleteVersionDialog(true)}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors bg-white text-red-600 border border-red-200 hover:bg-red-50"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete This Version
          </button>
        </div>
      )}
    </>
  );

  // Update the publish confirmation dialog
  const renderPublishDialog = () => (
    <MuiDialog 
      open={showPublishDialog} 
      onClose={() => setShowPublishDialog(false)}
      maxWidth="sm"
      fullWidth
    >
      <div className="p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          Confirm Publication
        </h3>
        <div className="space-y-6">
          {/* Add reviewer responsibility section */}
          <div className="bg-[#fff7ed] border border-orange-200 rounded-lg p-4 text-sm text-orange-800">
            <h4 className="font-medium mb-2">Reviewer's Responsibility</h4>
            <ul className="list-disc pl-4 space-y-1">
              <li>Verify that the model meets RI-SCALE Model Hub technical specifications</li>
              <li>Check that documentation is clear and complete</li>
              <li>Ensure all required files are present and valid</li>
              <li>Test model functionality with provided sample data</li>
            </ul>
          </div>

          <div className="text-sm text-gray-500 space-y-4">
            <p>
              You are about to publish this artifact to:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li>The RI-SCALE Model Hub website</li>
              <li>Zenodo (with DOI assignment)</li>
            </ul>
            <p className="text-red-600 font-medium">
              ⚠️ Warning: This action cannot be undone. Once published, the artifact cannot be withdrawn from either platform.
            </p>
          </div>
        </div>
        <div className="mt-6 flex gap-3 justify-end">
          <button
            onClick={() => setShowPublishDialog(false)}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#f39200]"
          >
            Cancel
          </button>
          <button
            onClick={handlePublish}
            className={`px-4 py-2 text-sm font-medium text-white border border-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#f39200] bg-[#f39200] hover:bg-[#d98200]`}
          >
            Confirm & Publish
          </button>
        </div>
      </div>
    </MuiDialog>
  );

  // Update URL when tab changes
  const handleTabChange = (tab: 'files' | 'review', filePath?: string) => {
    setActiveTab(tab);
    const newParams = new URLSearchParams(searchParams);
    
    if (tab === 'files' && filePath) {
      newParams.set('tab', `@${filePath}`);
    } else {
      newParams.set('tab', tab);
    }
    
    // Use replace instead of push to avoid adding to browser history
    setSearchParams(newParams, { replace: true });
  };

  // Update the effect to handle @ prefix in URL
  useEffect(() => {
    if (artifactId && files.length > 0) {
      const tabParam = searchParams.get('tab');
      
      if (tabParam?.startsWith('@')) {
        // Extract file path from tab parameter
        const filePath = tabParam.substring(1);
        const fileToSelect = files.find(f => f.path === filePath);
        
        if (fileToSelect) {
          setActiveTab('files');
          handleFileSelect(fileToSelect);
        }
      } else {
        setActiveTab(tabParam as 'files' | 'review' || 'files');
        
        // If no specific file is selected and rdf.yaml exists, select it
        if (!selectedFile) {
          const rdfFile = files.find(file => file.path.endsWith('rdf.yaml'));
          if (rdfFile) {
            handleFileSelect(rdfFile);
          }
        }
      }
    }
  }, [artifactId, files, searchParams]); // Remove selectedFile from dependencies

  // Add this effect to handle tab state when staged status changes
  useEffect(() => {
    if (!isStaged && activeTab === 'review') {
      handleTabChange('files');
    }
  }, [isStaged]);

  // Add file upload handler
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (!artifactManager || !artifactId) return;

    // If collection admin and not in stage mode, create temporary stage
    let needsStageCleanup = false;
    if (isCollectionAdmin && !isStaged) {
      try {
        await artifactManager.edit({
          artifact_id: artifactId,
          stage: true,
          _rkwargs: true
        });
        needsStageCleanup = true;
      } catch (error) {
        console.error('Error creating temporary stage:', error);
        setUploadStatus({
          message: 'Error creating temporary stage',
          severity: 'error'
        });
        return;
      }
    }

    // Get the manifest to check for weight files
    let weightFilePaths: string[] = [];
    try {
      // Find the rdf.yaml file
      const rdfFile = files.find(file => file.path.endsWith('rdf.yaml'));
      if (rdfFile) {
        // Load content if needed
        let rdfContent: string;
        if (!rdfFile.content) {
          const content = await fetchFileContent(rdfFile);
          if (typeof content === 'string') {
            rdfContent = content;
          } else {
            throw new Error('Failed to load rdf.yaml content');
          }
        } else {
          rdfContent = typeof rdfFile.content === 'string' 
            ? rdfFile.content 
            : new TextDecoder().decode(rdfFile.content as ArrayBuffer);
        }
        
        // Parse the manifest and extract weight files
        const manifest = yaml.load(rdfContent) as any;
        if (manifest && manifest.type === 'model') {
          weightFilePaths = extractWeightFiles(manifest);
        }
      }
    } catch (error) {
      console.error('Error checking for weight files:', error);
    }

    for (const file of acceptedFiles) {
      try {
        setUploadStatus({
          message: `Uploading ${file.name}...`,
          severity: 'info'
        });

        // Check if this is a weight file
        const isWeightFile = weightFilePaths.some((weightPath: string) => {
          const normalizedFilePath = file.name.startsWith('./') ? file.name.substring(2) : file.name;
          return normalizedFilePath === weightPath ||
                 normalizedFilePath.endsWith(`/${weightPath}`) ||
                 weightPath.endsWith(`/${normalizedFilePath}`);
        });

        // Get presigned URL for upload
        const putConfig: {
          artifact_id: string;
          file_path: string;
          download_weight?: number;
          _rkwargs: boolean;
        } = {
          artifact_id: artifactId,
          file_path: file.name,
          _rkwargs: true
        };
        
        if (isWeightFile) {
          putConfig.download_weight = 1;
        }
        
        const presignedUrl = await artifactManager.put_file(putConfig);

        // Upload file content
        const response = await fetch(presignedUrl, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': '' // important for s3
          }
        });

        if (!response.ok) {
          throw new Error('Failed to upload file');
        }

        // If collection admin and not in stage mode, commit changes immediately
        if (isCollectionAdmin && !isStaged) {
          try {
            await artifactManager.commit({
              artifact_id: artifactId,
              comment: `Added ${file.name}`,
              _rkwargs: true
            });
          } catch (error) {
            console.error('Error committing changes:', error);
            setUploadStatus({
              message: 'Error committing changes',
              severity: 'error'
            });
            continue;
          }
        }

        // Add file to local state
        const content = await file.text();
        const newFile: FileNode = {
          name: file.name,
          path: file.name,
          content,
          isDirectory: false,
          edited: false // Set to false since we've already committed if needed
        };

        setFiles(prev => [...prev, newFile]);
        setSelectedFile(newFile);

        setUploadStatus({
          message: `${file.name} uploaded successfully${isWeightFile ? ' (marked as weight file)' : ''}`,
          severity: 'success'
        });
        
        // If we uploaded a weight file, refresh to update artifact info with new download_weights
        if (isWeightFile) {
          loadArtifactFiles();
        }
      } catch (error) {
        console.error('Error uploading file:', error);
        setUploadStatus({
          message: `Error uploading ${file.name}`,
          severity: 'error'
        });
      }
    }
  }, [artifactId, artifactManager, files, isCollectionAdmin, isStaged]);

  const { getRootProps, getInputProps } = useDropzone({ 
    onDrop,
    noClick: true,
    noKeyboard: true
  });

  const handleDeleteFile = async (file: FileNode) => {
    if (!artifactManager || !artifactId) return;

    try {
      setUploadStatus({
        message: `Deleting ${file.name}...`,
        severity: 'info'
      });

      // If collection admin and not in stage mode, create temporary stage
      let needsStageCleanup = false;
      if (isCollectionAdmin && !isStaged) {
        try {
          await artifactManager.edit({
            artifact_id: artifactId,
            stage: true,
            _rkwargs: true
          });
          needsStageCleanup = true;
        } catch (error) {
          console.error('Error creating temporary stage:', error);
          setUploadStatus({
            message: 'Error creating temporary stage',
            severity: 'error'
          });
          return;
        }
      }

      await artifactManager.remove_file({
        artifact_id: artifactId,
        file_path: file.path,
        _rkwargs: true
      });

      // If collection admin and not in stage mode, commit changes immediately
      if (isCollectionAdmin && !isStaged) {
        try {
          await artifactManager.commit({
            artifact_id: artifactId,
            comment: `Deleted ${file.name}`,
            _rkwargs: true
          });
        } catch (error) {
          console.error('Error committing changes:', error);
          setUploadStatus({
            message: 'Error committing changes',
            severity: 'error'
          });
          return;
        }
      }

      // Clear selected file if it was the deleted one
      if (selectedFile?.path === file.path) {
        setSelectedFile(null);
        setImageUrl(null);
        // Clear any unsaved changes for this file
        setUnsavedChanges(prev => {
          const newState = { ...prev };
          delete newState[file.path];
          return newState;
        });
      }

      // Refresh the file list from the server
      await loadArtifactFiles();

      setUploadStatus({
        message: `${file.name} deleted successfully`,
        severity: 'success'
      });
    } catch (error) {
      console.error('Error deleting file:', error);
      setUploadStatus({
        message: `Error deleting ${file.name}`,
        severity: 'error'
      });
    }
    setShowDeleteConfirm(null);
  };

  // Modify the file list rendering to include delete button and drag-drop zone
  const renderFileList = () => (
    <div {...getRootProps()} className="flex-1 overflow-y-auto">
      {/* Add Files section with + File button */}
      <div className="mt-4">
        <div className="flex items-center justify-between px-4 mb-2">
          <h3 className="text-sm font-medium text-gray-700">Files</h3>
          {isStaged && (
            <label className="p-1 rounded-md hover:bg-gray-100 cursor-pointer text-gray-600 transition-colors">
              <input
                type="file"
                multiple
                title="Upload files"
                aria-label="Upload files"
                onChange={(e) => {
                  if (e.target.files) {
                    onDrop(Array.from(e.target.files));
                  }
                }}
                className="hidden"
              />
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </label>
          )}
        </div>
      </div>
      <div className="py-2">
        {isLoadingFiles ? (
          <div className="flex flex-col items-center justify-center h-48">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#f39200] mb-4"></div>
            <div className="text-xl font-semibold text-gray-700">Loading files...</div>
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48">
            <div className="text-xl font-semibold text-gray-700">No files found</div>
            <div className="text-sm text-gray-500 mt-2">This artifact doesn't contain any files</div>
          </div>
        ) : (
          files.map((file) => (
            <div
              key={file.path}
              onClick={() => handleFileSelect(file)}
              className={`group relative flex items-center px-4 py-2 cursor-pointer hover:bg-gray-100 border-l-2 transition-colors ${
                selectedFile?.path === file.path 
                  ? 'bg-white border-[#f39200] text-gray-900' 
                  : 'border-transparent text-gray-600'
              }`}
            >
              {/* File icon and name */}
              <div className="flex items-center flex-1 min-w-0">
                {/* File Icon */}
                <span className="flex-shrink-0">
                  {file.name.endsWith('.yaml') || file.name.endsWith('.yml') ? (
                    <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  ) : file.name.match(/\.(png|jpg|jpeg|gif)$/i) ? (
                    <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  )}
                </span>

                {/* File Name with Star for rdf.yaml */}
                <div className="flex items-center gap-2 flex-1">
                  <span className="truncate text-sm font-medium tracking-wide ml-2">
                    {file.name}
                  </span>
                  {file.name === 'rdf.yaml' && (
                    <svg className="w-4 h-4 text-[#f39200] flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  )}
                </div>

                {/* Edit badge */}
                {(file.edited || unsavedChanges[file.path]) && (
                  <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full uppercase tracking-wider font-medium">
                    edited
                  </span>
                )}

                {/* Download weight badge - updated to check both config.download_weights and staging */}
                {(
                  // Check in config.download_weights for published versions
                  (artifactInfo?.config?.download_weights && artifactInfo.config.download_weights[file.path] > 0) ||
                  // Check in staging array for staged files
                  (isStaged && artifactInfo?.staging && artifactInfo.staging.some(
                    (item: {path: string; download_weight: number}) => 
                      item.path === file.path && item.download_weight > 0
                  ))
                ) && (
                  <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full uppercase tracking-wider font-medium ml-1">
                    weight
                  </span>
                )}

                {/* Action buttons - hidden by default, shown on group hover */}
                <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                  {/* Download button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const downloadUrl = `https://hypha.aicell.io/ri-scale/artifacts/${artifactId?.split('/').pop()}/files/${file.path}${editVersion && editVersion !== 'latest' ? `?version=${editVersion}` : ''}`;
                      window.open(downloadUrl, '_blank');
                    }}
                    title="Download file"
                    aria-label="Download file"
                    className="p-1 hover:bg-orange-100 rounded transition-colors"
                  >
                    <svg className="w-4 h-4 text-[#f39200]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                  
                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDeleteConfirm(file.path);
                    }}
                    title="Delete file"
                    aria-label="Delete file"
                    className="p-1 hover:bg-red-100 rounded transition-colors"
                  >
                    <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  // Update the handleValidationComplete function
  const handleValidationComplete = (result: ValidationResult) => {
    setUploadStatus({
      message: result.success ? 'Validation successful!' : 'Validation failed',
      severity: result.success ? 'success' : 'error'
    });
    
    setIsContentValid(result.success);
    setHasContentChanged(false);

    // If validation failed and we're viewing rdf.yaml in form mode,
    // find the RDFEditor and switch it to YAML mode
    if (!result.success && selectedFile?.path.endsWith('rdf.yaml')) {
      const rdfEditor = document.querySelector('[data-testid="rdf-editor"]');
      if (rdfEditor) {
        // Find and click the YAML mode button
        const yamlModeButton = rdfEditor.querySelector('[data-testid="yaml-mode-button"]');
        if (yamlModeButton instanceof HTMLButtonElement) {
          yamlModeButton.click();
        }
      }
    }

    // If validation successful, check for type changes in rdf.yaml
    if (result.success) {
      const rdfFile = files.find(file => file.path.endsWith('rdf.yaml'));
      if (rdfFile) {
        try {
          // Get latest content including unsaved changes
          const content = unsavedChanges[rdfFile.path] ?? 
            (typeof rdfFile.content === 'string' ? rdfFile.content : '');
          
          // Parse YAML to get type
          const rdfData = yaml.load(content);
          if (rdfData && typeof rdfData === 'object' && 'type' in rdfData) {
            setArtifactType(rdfData.type as string);
          }
        } catch (error) {
          console.error('Error parsing rdf.yaml:', error);
        }
      }
    }
  };

  // Update the renderActionButtons function
  const renderActionButtons = () => {
    // Get the latest content for rdf.yaml, including unsaved changes
    const getLatestRdfContent = () => {
      const rdfFile = files.find(file => file.path.endsWith('rdf.yaml'));
      if (!rdfFile) return '';
      return unsavedChanges[rdfFile.path] ?? 
        (typeof rdfFile.content === 'string' ? rdfFile.content : '');
    };

    const isRdfFile = selectedFile?.path.endsWith('rdf.yaml');
    const shouldDisableActions = isRdfFile && (!isContentValid || hasContentChanged);

    return (
      <div className="flex flex-wrap gap-2 w-full sm:w-auto">
      
        {/* Save button */}
        {selectedFile && isTextFile(selectedFile.name) && (
          <button
            onClick={() => handleSave(selectedFile)}
            disabled={!unsavedChanges[selectedFile.path] || uploadStatus?.severity === 'info'}
            title={`Save (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+S)`}
            className={`px-4 py-2 rounded-md font-medium transition-colors flex items-center justify-center gap-2 w-full sm:w-auto
              ${!unsavedChanges[selectedFile.path] || uploadStatus?.severity === 'info'
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-[#fff7ed] text-gray-700 hover:bg-orange-100 border border-gray-300'}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
            Save
          </button>
        )}
      </div>
    );
  };

  // Add delete confirmation dialog
  const renderDeleteConfirmDialog = () => (
    showDeleteConfirm && (
      <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
          <h3 className="text-lg font-medium text-gray-900 mb-4">
            Delete File
          </h3>
          <p className="text-gray-500 mb-6">
            Are you sure you want to delete "{files.find(f => f.path === showDeleteConfirm)?.name}"? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowDeleteConfirm(null)}
              className="px-4 py-2 rounded-md text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                const file = files.find(f => f.path === showDeleteConfirm);
                if (file) handleDeleteFile(file);
              }}
              className="px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    )
  );

  // Add function to handle new version creation
  const handleCreateNewVersion = async () => {
    if (!artifactManager || isCreatingVersion) return;
    
    setIsCreatingVersion(true);
    
    try {
      setUploadStatus({
        message: 'Creating new version...',
        severity: 'info'
      });
      
      // Create the new version first
      const newArtifact = await artifactManager.edit({
        artifact_id: artifactId,
        type: artifactType,
        stage: true,
        version: 'new',
        _rkwargs: true
      });
      console.log('new version created', newArtifact);
      // get the latest version, the last one
      const latestVersion = newArtifact.versions[newArtifact.versions.length - 1].version;

      // If user wants to copy files, do the copy process
      if (newVersionData.copyFiles) {
        try {
          // Get the file list from the previous version
          setUploadStatus({
            message: 'Getting file list from previous version...',
            severity: 'info'
          });

          const fileList = await artifactManager.list_files({
            artifact_id: artifactId,
            version: latestVersion,
            _rkwargs: true
          });

          if (!fileList || fileList.length === 0) {
            setUploadStatus({
              message: 'No files found in previous version to copy.',
              severity: 'info'
            });
          } else {
            // Filter out directories, only copy files
            const filesToCopy = fileList.filter((file: any) => file.type !== 'directory');
            
            setUploadStatus({
              message: `Found ${filesToCopy.length} files to copy. Starting copy process...`,
              severity: 'info'
            });

            // Copy files one by one
            for (let i = 0; i < filesToCopy.length; i++) {
              const file = filesToCopy[i];
              
              // Update progress
              setCopyProgress({
                current: i + 1,
                total: filesToCopy.length,
                file: file.name
              });

              try {
                // Get download URL for the file from previous version
                const downloadUrl = await artifactManager.get_file({
                  artifact_id: artifactId,
                  file_path: file.name,
                  version: latestVersion,
                  _rkwargs: true
                });

                // Download the file content
                const response = await fetch(downloadUrl);
                if (!response.ok) {
                  throw new Error(`Failed to download ${file.name}`);
                }
                
                const fileContent = await response.blob();

                // Get presigned URL for uploading to new version
                const presignedUrl = await artifactManager.put_file({
                  artifact_id: artifactId,
                  file_path: file.name,
                  _rkwargs: true
                });

                // Upload the file to new version
                const uploadResponse = await fetch(presignedUrl, {
                  method: 'PUT',
                  body: fileContent,
                  headers: {
                    'Content-Type': '' // important for s3
                  }
                });

                if (!uploadResponse.ok) {
                  throw new Error(`Failed to upload ${file.name}`);
                }

                console.log(`Successfully copied ${file.name} (${i + 1}/${filesToCopy.length})`);
              } catch (fileError) {
                console.error(`Error copying ${file.name}:`, fileError);
                // Continue with other files even if one fails
                setUploadStatus({
                  message: `Warning: Failed to copy ${file.name}. Continuing with other files...`,
                  severity: 'error'
                });
              }
            }

            // Clear copy progress
            setCopyProgress(null);

            setUploadStatus({
              message: 'Files copied successfully. Redirecting to edit mode...',
              severity: 'success'
            });
          }
        } catch (copyError) {
          console.error('Error copying files:', copyError);
          setCopyProgress(null);
          setUploadStatus({
            message: 'Warning: New version created but failed to copy files. You can upload files manually.',
            severity: 'error'
          });
        }
      } else {
        setUploadStatus({
          message: 'New version created successfully. Redirecting to edit mode...',
          severity: 'success'
        });
      }

      // Close the dialog
      setShowNewVersionDialog(false);

      // Redirect to the staging version after a short delay
      setTimeout(() => {
        const stagePath = `/edit/${encodeURIComponent(artifactId || '')}/stage`;
        navigate(stagePath);
      }, 1500);

    } catch (error) {
      console.error('Error creating new version:', error);
      setUploadStatus({
        message: 'Error creating new version',
        severity: 'error'
      });
    } finally {
      setIsCreatingVersion(false);
    }
  };

  // Add new version dialog component
  const renderNewVersionDialog = () => (
    <MuiDialog 
      open={showNewVersionDialog} 
      onClose={() => setShowNewVersionDialog(false)}
      maxWidth="md"
      fullWidth
    >
      <div className="p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          Create New Version
        </h3>
        
        {/* Show progress during creation */}
        {isCreatingVersion && (
          <div className="mb-6 bg-[#fff7ed] border border-orange-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <svg className="animate-spin w-5 h-5 text-[#f39200] mt-0.5 flex-shrink-0" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <div className="flex-1">
                <h4 className="font-medium text-orange-900 mb-2">Creating New Version</h4>
                
                {/* Show current status */}
                <div className="text-sm text-orange-800 mb-3">
                  {uploadStatus?.message || 'Processing...'}
                </div>

                {/* Show file copying progress */}
                {copyProgress && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm text-orange-800">
                      <span>Copying files ({copyProgress.current}/{copyProgress.total})</span>
                      <span>{Math.round((copyProgress.current / copyProgress.total) * 100)}%</span>
                    </div>
                    
                    {/* Progress bar */}
                    <div className="w-full bg-orange-200 rounded-full h-2">
                      <div 
                        className="bg-[#f39200] h-2 rounded-full transition-all duration-300"
                        style={{ width: `${(copyProgress.current / copyProgress.total) * 100}%` }}
                      />
                    </div>
                    
                    {/* Current file being copied */}
                    <div className="text-xs text-orange-700 truncate">
                      Current file: {copyProgress.file}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Warning and guidance section - only show when not creating */}
        {!isCreatingVersion && (
          <div className="space-y-4 mb-6">
            <div className="bg-[#fff7ed] border border-orange-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-[#f39200] mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-sm text-orange-800">
                  <h4 className="font-semibold mb-2">When should you create a new version?</h4>
                  <div className="space-y-2">
                    <p><strong>✅ Create new version when:</strong></p>
                    <ul className="list-disc pl-4 space-y-1">
                      <li>Model weight files have changed</li>
                      <li>Model architecture or functionality has been modified</li>
                      <li>Breaking changes to the model interface</li>
                      <li>Significant improvements that warrant a version bump</li>
                    </ul>
                    
                    <p className="mt-3"><strong>❌ You don't need a new version for:</strong></p>
                    <ul className="list-disc pl-4 space-y-1">
                      <li>Editing the RDF.yaml metadata file</li>
                      <li>Updating cover images or documentation</li>
                      <li>Fixing typos in descriptions</li>
                      <li>Adding or updating tags and citations</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="text-sm text-amber-800">
                  <h4 className="font-semibold mb-1">File Copying Process</h4>
                  <p>If you choose to copy files, we will download all files from version <span className="font-mono bg-amber-100 px-1 rounded">{editVersion || 'latest'}</span> and upload them to the new version. This process may take several minutes depending on file sizes.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Options - only show when not creating */}
        {!isCreatingVersion && (
          <div className="space-y-4">
            <FormControlLabel
              control={
                <Checkbox
                  checked={newVersionData.copyFiles}
                  onChange={(e) => setNewVersionData(prev => ({ ...prev, copyFiles: e.target.checked }))}
                />
              }
              label={
                <div className="ml-2">
                  <div className="font-medium">Copy existing files to new version</div>
                  <div className="text-sm text-gray-500">
                    This will download and copy all files from the current version to the new version. 
                    Uncheck if you plan to upload completely new files.
                  </div>
                </div>
              }
            />
          </div>
        )}

        <div className="mt-6 flex gap-3 justify-end">
          <button
            onClick={() => setShowNewVersionDialog(false)}
            disabled={isCreatingVersion}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={handleCreateNewVersion}
            disabled={isCreatingVersion}
            className="px-4 py-2 text-sm font-medium text-white bg-[#f39200] border border-transparent rounded-md hover:bg-[#d98200] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isCreatingVersion ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Creating...
              </>
            ) : (
              'Create New Version'
            )}
          </button>
        </div>
      </div>
    </MuiDialog>
  );

  // Add this handleValidate function before setupKeyboardShortcuts
  const handleValidate = () => {
    if (!selectedFile || !selectedFile.path.endsWith('rdf.yaml')) {
      return; // Only validate RDF files
    }

    if (!user?.email) {
      setValidationErrors(['You must be logged in to validate changes']);
      return;
    }

    // Get the latest content including unsaved changes
    const content = unsavedChanges[selectedFile.path] ?? 
      (typeof selectedFile.content === 'string' ? selectedFile.content : '');
    
    // Validate the content
    const validation = validateRdfContent(
      content,
      artifactInfo?.id || '',
      artifactInfo?.manifest?.id_emoji || '',
      user.email
    );

    // Update validation state and show results
    setIsContentValid(validation.success);
    setHasContentChanged(false);
    
    if (!validation.success) {
      setValidationErrors(validation.errors);
      setUploadStatus({
        message: 'Validation failed. Please fix the errors.',
        severity: 'error'
      });
    } else {
      setUploadStatus({
        message: 'Validation successful!',
        severity: 'success'
      });
    }
  };

  // Update setupKeyboardShortcuts to include handleValidate in dependencies
  const setupKeyboardShortcuts = useCallback(() => {
    const shortcuts: KeyboardShortcut[] = [
      {
        key: 's',
        ctrlKey: true,
        metaKey: true,
        handler: () => {
          if (selectedFile && isTextFile(selectedFile.name)) {
            handleSave(selectedFile);
          }
        }
      },
      {
        key: 'v',
        ctrlKey: true,
        metaKey: true,
        handler: () => {
          if (selectedFile?.path.endsWith('rdf.yaml')) {
            handleValidate();
          }
        }
      }
    ];

    const handleKeyDown = (e: KeyboardEvent) => {
      shortcuts.forEach(shortcut => {
        if (
          e.key === shortcut.key &&
          (!shortcut.ctrlKey || e.ctrlKey) &&
          (!shortcut.metaKey || e.metaKey)
        ) {
          e.preventDefault();
          shortcut.handler();
        }
      });
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedFile, handleSave, handleValidate, unsavedChanges, files]); // Add handleValidate

  // Add this useEffect to set up the keyboard shortcuts
  useEffect(() => {
    const cleanup = setupKeyboardShortcuts();
    return cleanup;
  }, [setupKeyboardShortcuts]);

  // Add this function near the top of the component
  const handleCopyId = () => {
    const id = artifactInfo?.id.split('/').pop() || '';
    navigator.clipboard.writeText(id);
    // Optionally add some visual feedback
    setUploadStatus({
      message: 'ID copied to clipboard',
      severity: 'success'
    });
  };

  // Add download function
  const handleDownload = () => {
    if (!artifactInfo) return;
    
    const id = artifactInfo.id.split('/').pop() || '';
    const versionParam = isStaged ? '?version=stage' : '';
    const downloadUrl = `https://hypha.aicell.io/ri-scale/artifacts/${id}/create-zip-file${versionParam}`;
    
    window.open(downloadUrl, '_blank');
  };

  // Add ValidationErrorDialog
  const ValidationErrorDialog: React.FC<{
    open: boolean;
    errors: string[];
    onClose: () => void;
  }> = ({ open, errors, onClose }) => (
    <MuiDialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <div className="p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          Invalid RDF.yaml Content
        </h3>
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <ul className="list-disc pl-4 space-y-2 text-red-700">
              {errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </div>
          <p className="text-sm text-gray-500">
            Please fix these issues before saving. The ID and emoji fields must match the artifact's assigned values.
          </p>
        </div>
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </MuiDialog>
  );

  // Add this function before renderFileContent
  const checkImageDimensions = (url: string, fileName: string) => {
    const img = new Image();
    img.onload = () => {
      setImageDimensions({ width: img.width, height: img.height });
    };
    img.src = url;
  };

  // Add handler for deleting a version
  const handleDeleteVersion = async () => {
    if (!artifactManager || !artifactId || !editVersion) return;

    try {
      setUploadStatus({
        message: 'Deleting version...',
        severity: 'info'
      });

      await artifactManager.delete({
        artifact_id: artifactId,
        version: editVersion,
        delete_files: true,
        recursive: true,
        _rkwargs: true
      });

      setUploadStatus({
        message: 'Version deleted successfully',
        severity: 'success'
      });

      // Close the dialog
      setShowDeleteVersionDialog(false);

      // Navigate back to the appropriate page
      navigate(getBackPath());
    } catch (error) {
      setShowDeleteVersionDialog(false);
      alert(`Error deleting version: ${error}`);
      console.error('Error deleting version:', error);
      setUploadStatus({
        message: 'Error deleting version',
        severity: 'error'
      });
    }
  };

  // Add this function before renderFileContent
  const renderDeleteVersionDialog = () => (
    <MuiDialog 
      open={showDeleteVersionDialog} 
      onClose={() => setShowDeleteVersionDialog(false)}
      maxWidth="sm"
      fullWidth
    >
      <div className="p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          Delete Version
        </h3>
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-red-800 mb-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <h4 className="font-medium">Warning: This action cannot be undone</h4>
            </div>
            <p className="text-sm text-red-700">
              You are about to permanently delete version {editVersion} of this artifact. This will remove all files and metadata associated with this version.
            </p>
          </div>
        </div>
        <div className="mt-6 flex gap-3 justify-end">
          <button
            onClick={() => setShowDeleteVersionDialog(false)}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:ring-2 focus:ring-[#f39200]"
          >
            Cancel
          </button>
          <button
            onClick={handleDeleteVersion}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 focus:ring-2 focus:ring-red-500"
          >
            Delete Version
          </button>
        </div>
      </div>
    </MuiDialog>
  );

  return (
    <div className="flex flex-col">
      {/* Header - make it fixed for small screens */}
      <div className="bg-white px-4 py-2 flex justify-between items-center sticky top-0 border-b border-gray-200">
        <div className="flex items-center gap-2">
          {/* Toggle sidebar button */}
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 rounded-md text-gray-500 hover:bg-gray-100 lg:hidden"
            aria-label="Toggle sidebar"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Back button */}
          <button
            onClick={() => navigate(getBackPath())}
            className="flex items-center text-gray-600 hover:text-gray-900"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span className="hidden sm:inline">
              {getBackPath().includes('/review') ? 'Back to Review Artifacts' : 'Back to My Artifacts'}
            </span>
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative lg:w-full">
        {/* Sidebar - update z-index */}
        <div className={`
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} 
          w-80 bg-gray-50 border-r border-gray-200 flex flex-col 
          fixed lg:relative 
          top-[48px] lg:top-0 bottom-0 left-0
          transition-transform duration-300 ease-in-out 
          z-20
          overflow-hidden
        `}>

          {/* Artifact Info Box - always visible */}
          <div className="border-t border-gray-200 bg-white p-4 space-y-2">
            {artifactInfo ? (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-base text-gray-900 truncate max-w-[180px]" title={artifactInfo.manifest.name}>
                    {artifactInfo.manifest.name}
                  </p>
                  <span className="text-xs bg-[#fff7ed] text-[#f39200] border border-orange-200 px-2 py-1 rounded-full">
                    {isStaged ? 'stage' : (lastVersion || '')}
                  </span>
                </div>
                <div className="text-xs text-gray-500 font-mono mt-2 flex items-center gap-1">
                  {artifactInfo.manifest.id_emoji && (
                    <span 
                      role="img" 
                      aria-label="model emoji"
                      className="w-5 h-5 flex items-center justify-center bg-gray-100 rounded-full text-sm"
                    >
                      {artifactInfo.manifest.id_emoji}
                    </span>
                  )}
                  <code className="bg-gray-100 px-2 py-0.5 rounded select-all">
                    {artifactInfo.id.split('/').pop()}
                  </code>
                  <button
                    onClick={handleCopyId}
                    className="p-1 hover:bg-gray-100 rounded-md transition-colors"
                    title="Copy ID"
                  >
                    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                  </button>
                  <button
                    onClick={handleDownload}
                    className="p-1 hover:bg-gray-100 rounded-md transition-colors"
                    title="Download artifact"
                  >
                    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                </div>
                {/* Add status badge if artifact is staged */}
                {artifactInfo.staging !== null && (
                  <div className="mt-2">
                    <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full">
                      status: {(artifactInfo.manifest as any)?.status || 'staged'}
                    </span>
                  </div>
                )}
               
              </>
            ) : (
              <div className="text-sm text-gray-500">Loading artifact info...</div>
            )}
          </div>
          {/* Navigation buttons */}
          {renderSidebarNav()}

          {/* Files list - always visible */}
          {renderFileList()}

        </div>

        {/* Main content area */}
        <div className="w-full flex flex-col overflow-hidden min-h-[80vh]">
          {/* Status bar - only show when not in review tab */}
          {files.length > 0 && activeTab !== 'review' && (
            <div className="border-b border-gray-200 bg-white sticky top-0 z-10">
              <div className={`p-2 ${uploadStatus?.progress !== undefined ? 'pb-0' : ''}`}>
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  {/* Status section - add max width for large screens */}
                  <div className="flex-grow min-w-0 lg:max-w-[50%]">
                    {copyProgress ? (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-[#f39200] truncate">
                            Copying files ({copyProgress.current}/{copyProgress.total}): {copyProgress.file}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        {uploadStatus && (
                          <div className="flex items-center gap-2">
                            <span className={`text-base truncate ${
                              uploadStatus.severity === 'error' ? 'text-red-600' :
                              uploadStatus.severity === 'success' ? 'text-green-600' :
                              'text-[#f39200]'
                            }`}>
                              {uploadStatus.message}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Buttons section - add relative positioning and higher z-index */}
                  <div className="flex flex-wrap gap-2 lg:justify-end lg:flex-nowrap relative z-50">
                    {renderActionButtons()}
                  </div>
                </div>
              </div>

              {/* Progress bar at the bottom edge */}
              {uploadStatus?.progress !== undefined && (
                <div className="w-full bg-gray-100 h-1 mt-1">
                  <div 
                    className="bg-[#f39200] h-1 transition-all duration-300"
                    style={{ width: `${uploadStatus.progress}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Content area - update height calculation */}
          <div className="flex-1 overflow-auto min-h-[calc(80vh-145px)]">
            {renderContent()}
          </div>
        </div>
      </div>

      {/* Publish Confirmation Dialog */}
      {renderPublishDialog()}

      {renderDeleteConfirmDialog()}

      {renderNewVersionDialog()}

      {/* Add Delete Version Dialog */}
      {renderDeleteVersionDialog()}

      {/* Add ValidationErrorDialog */}
      <ValidationErrorDialog
        open={validationErrors.length > 0}
        errors={validationErrors}
        onClose={() => setValidationErrors([])}
      />

      {/* Update overlay for mobile */}
      {isSidebarOpen && (
        <div 
          className="lg:hidden fixed inset-0 top-[48px] bg-black bg-opacity-50 z-10"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
    </div>
  );
};

export default Edit;