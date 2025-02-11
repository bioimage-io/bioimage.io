import React, { useState, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { useHyphaStore } from '../store/hyphaStore';
import { LinearProgress, Dialog as MuiDialog, TextField, FormControlLabel, Checkbox } from '@mui/material';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArtifactInfo } from '../types/artifact';
import { useDropzone } from 'react-dropzone';
import ModelTester from './ModelTester';
import ModelValidator from './ModelValidator';
import ReviewPublishArtifact from './ReviewPublishArtifact';
import StatusBadge from './StatusBadge';
import yaml from 'js-yaml';

interface FileNode {
  name: string;
  path: string;
  content?: string | ArrayBuffer;
  isDirectory: boolean;
  children?: FileNode[];
  edited?: boolean;
  isCommentsFile?: boolean;
}

// Add this interface for the tab type
interface ContentTab {
  id: 'files' | 'review';
  label: string;
  icon: React.ReactNode;
}

// Add this interface near the top with other interfaces
interface PublishData {
  version?: string;
  comment: string;
}

// Add this type definition near other interfaces
interface KeyboardShortcut {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  handler: () => void;
}

const Edit: React.FC = () => {
  const { artifactId } = useParams<{ artifactId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [showComments, setShowComments] = useState(false);
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
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isStaged, setIsStaged] = useState<boolean>(false);
  const [showNewVersionDialog, setShowNewVersionDialog] = useState(false);
  const [newVersionData, setNewVersionData] = useState({
    copyFiles: true
  });
  const [copyProgress, setCopyProgress] = useState<{
    current: number;
    total: number;
    file: string;
  } | null>(null);
  const [publishData, setPublishData] = useState<PublishData>({
    version: '',
    comment: ''
  });
  const [isContentValid, setIsContentValid] = useState<boolean>(true);
  const [hasContentChanged, setHasContentChanged] = useState<boolean>(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isCollectionAdmin, setIsCollectionAdmin] = useState(false);
  const [lastVersion, setLastVersion] = useState<string | null>(null);
  const [artifactType, setArtifactType] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

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
    const textExtensions = ['.txt', '.yml', '.yaml', '.json', '.md', '.py', '.js', '.ts', '.jsx', '.tsx', '.css', '.html'];
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
      content = encoder.encode(content).buffer;
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
      'txt': 'plaintext'
    };
    return languageMap[extension] || 'plaintext';
  };

  const loadArtifactFiles = async () => {
    if (!artifactManager || !artifactId || !server) return;
    
    try {
      setUploadStatus({
        message: 'Loading files...',
        severity: 'info'
      });

      // Get artifact info
      const artifact = await artifactManager.read({
        artifact_id: artifactId,
        _rkwargs: true
      });
      
      // Set artifact type from manifest
      setArtifactType(artifact.manifest?.type || null);
      
      // Check collection admin status
      try {
        const collection = await artifactManager.read({
          artifact_id: 'bioimage-io/bioimage.io',
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
      
      // Set isStaged based on artifact staging status
      const staged = artifact.staging !== null;
      setIsStaged(staged);
      setArtifactInfo(artifact);

      // List all files using the correct version
      const fileList = await artifactManager.list_files({
        artifact_id: artifactId,
        version: staged ? 'stage' : null,
        _rkwargs: true
      });

      if (!fileList || fileList.length === 0) {
        setUploadStatus({
          message: 'No files found',
          severity: 'error'
        });
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
        artifact_id: artifactId,
        file_path: file.path,
        version: isStaged ? 'stage' : null,
        _rkwargs: true
      });
      
      const response = await fetch(url);
      const content = isTextFile(file.name) ? 
        await response.text() : 
        await response.arrayBuffer();

      setUploadStatus({
        message: 'File loaded successfully',
        severity: 'success'
      });

      return content;
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

        if (isImageFile(file.name)) {
          try {
            const url = await getImageDataUrl(content, file.name);
            setImageUrl(url);
          } catch (error) {
            console.error('Error generating image URL:', error);
          }
        }
      }
    } else if (isImageFile(file.name)) {
      // If content is already loaded, just generate the image URL
      try {
        const url = await getImageDataUrl(file.content, file.name);
        setImageUrl(url);
      } catch (error) {
        console.error('Error generating image URL:', error);
      }
    }
  };

  const validateRdfContent = (content: string, artifactId: string, artifactEmoji: string): {
    isValid: boolean;
    errors: string[];
  } => {
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

      // Check if legacy nickname fields match if they exist
      if (manifest.config?.bioimageio?.nickname && manifest.config.bioimageio.nickname !== shortId) {
        errors.push(`Legacy nickname field 'config.bioimageio.nickname' must be "${shortId}"`);
      }
      if (manifest.config?.bioimageio?.nickname_icon && manifest.config.bioimageio.nickname_icon !== artifactEmoji) {
        errors.push(`Legacy nickname field 'config.bioimageio.nickname_icon' must be "${artifactEmoji}"`);
      }

      return {
        isValid: errors.length === 0,
        errors
      };
    } catch (error) {
      return {
        isValid: false,
        errors: ['Invalid YAML format']
      };
    }
  };

  const handleEditorChange = (value: string | undefined, file: FileNode) => {
    if (!value || !file) return;
    
    // Store unsaved changes in state
    setUnsavedChanges(prev => ({
      ...prev,
      [file.path]: value
    }));

    // Mark file as edited in files array
    setFiles(prevFiles => 
      prevFiles.map(f => 
        f.path === file.path 
          ? { ...f, edited: true }
          : f
      )
    );

    // Mark content as changed and invalidate previous validation
    setHasContentChanged(true);
    setIsContentValid(false);
  };

  const handleSave = async (file: FileNode) => {
    if (!artifactManager || !unsavedChanges[file.path]) return;

    // For rdf.yaml, validate content before saving
    if (file.path.endsWith('rdf.yaml')) {
      const validation = validateRdfContent(
        unsavedChanges[file.path],
        artifactInfo?.id || '',
        artifactInfo?.manifest?.id_emoji || ''
      );

      if (!validation.isValid) {
        setValidationErrors(validation.errors);
        return;
      }
    }

    try {
      setUploadStatus({
        message: 'Saving changes...',
        severity: 'info'
      });

      // Get the presigned URL for uploading
      const presignedUrl = await artifactManager.put_file({
        artifact_id: artifactId,
        file_path: file.path,
        _rkwargs: true
      });

      // Upload the file content
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

      // If this is rdf.yaml, update the artifact's manifest
      if (file.path.endsWith('rdf.yaml')) {
        try {
          const rdfContent = unsavedChanges[file.path];
          const rdfData = yaml.load(rdfContent);
          
          if (rdfData && typeof rdfData === 'object') {
            // Update artifact with new manifest data
            await artifactManager.edit({
              artifact_id: artifactId,
              manifest: rdfData,
              version: 'stage',
              _rkwargs: true
            });

            // Update local state
            if ('type' in rdfData) {
              setArtifactType(rdfData.type as string);
            }
            
            // Update artifactInfo with new manifest
            setArtifactInfo(prev => prev ? {
              ...prev,
              manifest: {
                ...prev.manifest,
                ...rdfData
              }
            } : null);
          }
        } catch (error) {
          console.error('Error updating manifest:', error);
          setUploadStatus({
            message: 'Error updating manifest from rdf.yaml',
            severity: 'error'
          });
          return; // Return early on manifest update error
        }
      }

      // Update the local state - but don't set edited: true since we just saved
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
        message: 'Changes saved',
        severity: 'success'
      });
    } catch (error) {
      console.error('Error saving changes:', error);
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
        version: publishData.version?.trim() || null,
        comment: publishData.comment || 'Published to Model Zoo',
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

      // Navigate back to My Artifacts after successful publish
      navigate('/my-artifacts');

    } catch (error) {
      console.error('Error publishing artifact:', error);
      setUploadStatus({
        message: 'Error publishing artifact',
        severity: 'error'
      });
    }
  };

  const renderFileContent = () => {
    if (!selectedFile) {
      return (
        <div className="h-[calc(100vh-113px)] flex items-center justify-center text-gray-500">
          Select a file to view or edit
        </div>
      );
    }

    if (!selectedFile.content) {
      return (
        <div className="h-[calc(100vh-113px)] flex flex-col items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <div className="text-xl font-semibold text-gray-700">Loading file content...</div>
        </div>
      );
    }

    if (isImageFile(selectedFile.name)) {
      return (
        <div className="flex flex-col items-center justify-center p-8">
          {imageUrl ? (
            <img 
              src={imageUrl}
              alt={selectedFile.name} 
              className="max-w-full h-auto"
            />
          ) : (
            <div className="flex items-center justify-center h-40 bg-gray-50 rounded-lg w-full">
              <div className="text-gray-400">Loading image...</div>
            </div>
          )}
        </div>
      );
    }

    if (isTextFile(selectedFile.name)) {
      return (
        <div className="flex flex-col gap-4 p-4">
          <Editor
            height="calc(100vh - 145px)"
            language={getEditorLanguage(selectedFile.name)}
            value={unsavedChanges[selectedFile.path] ?? 
              (typeof selectedFile.content === 'string' ? selectedFile.content : '')}
            onChange={(value) => handleEditorChange(value, selectedFile)}
            options={{
              minimap: { enabled: false },
              scrollBeyondLastLine: true,
              wordWrap: 'on',
              lineNumbers: 'on',
              renderWhitespace: 'selection',
              folding: true
            }}
          />
        </div>
      );
    }

    return (
      <div className="h-[calc(100vh-113px)] flex items-center justify-center">
        <div className="bg-gray-50 p-6 rounded-lg max-w-md w-full mx-4">
          <h3 className="font-medium text-lg mb-4">File Information</h3>
          <div className="space-y-2">
            <p><span className="font-medium">Name:</span> {selectedFile.name}</p>
            <p><span className="font-medium">Size:</span> {formatFileSize(selectedFile.content instanceof ArrayBuffer ? selectedFile.content.byteLength : selectedFile.content.length)}</p>
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
    },
    {
      id: 'review',
      label: 'Review',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      )
    }
  ];

  // Update renderContent to use activeTab
  const renderContent = () => {
    if (activeTab === 'review') {
      return (
        <ReviewPublishArtifact
          artifactInfo={artifactInfo}
          artifactId={artifactId!}
          isStaged={isStaged}
          isCollectionAdmin={isCollectionAdmin}
          onPublish={handlePublish}
          isContentValid={isContentValid}
          hasContentChanged={hasContentChanged}
        />
      );
    }
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
          className="w-full flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors bg-white text-gray-700 border hover:bg-gray-50"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          New Version
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
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
            <h4 className="font-medium mb-2">Reviewer's Responsibility</h4>
            <ul className="list-disc pl-4 space-y-1">
              <li>Verify that the model meets BioImage.io technical specifications</li>
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
              <li>The BioImage Model Zoo website</li>
              <li>Zenodo (with DOI assignment)</li>
            </ul>
            <p className="text-red-600 font-medium">
              ⚠️ Warning: This action cannot be undone. Once published, the artifact cannot be withdrawn from either platform.
            </p>
          </div>

          {/* Version and Comment fields */}
          <div className="space-y-4">
            <div>
              <TextField
                label="Version (optional)"
                value={publishData.version}
                onChange={(e) => setPublishData(prev => ({ ...prev, version: e.target.value }))}
                fullWidth
                size="small"
                helperText="Leave empty to auto-increment the latest version"
              />
              <div className="mt-2">
                <span className="text-xs text-gray-500">Existing versions: </span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {artifactInfo?.versions && artifactInfo.versions.length > 0 ? (
                    artifactInfo.versions.map((v) => (
                      <span key={v.version} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">
                        {v.version}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-gray-500 italic">No versions published yet</span>
                  )}
                </div>
              </div>
            </div>
            <TextField
              label="Comment"
              value={publishData.comment}
              onChange={(e) => setPublishData(prev => ({ ...prev, comment: e.target.value }))}
              required
              fullWidth
              multiline
              rows={3}
              size="small"
              helperText="Describe the changes in this publication"
              error={!publishData.comment.trim()}
            />
          </div>
        </div>
        <div className="mt-6 flex gap-3 justify-end">
          <button
            onClick={() => setShowPublishDialog(false)}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          <button
            onClick={handlePublish}
            disabled={!publishData.comment.trim()}
            className={`px-4 py-2 text-sm font-medium text-white border border-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
              ${!publishData.comment.trim() 
                ? 'bg-gray-300 cursor-not-allowed' 
                : 'bg-blue-600 hover:bg-blue-700'}`}
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

    for (const file of acceptedFiles) {
      try {
        setUploadStatus({
          message: `Uploading ${file.name}...`,
          severity: 'info'
        });

        // Get presigned URL for upload
        // TODO: If the file is a model weights file, we need to change the download weight
        const presignedUrl = await artifactManager.put_file({
          artifact_id: artifactId,
          file_path: file.name,
          _rkwargs: true
        });

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

        // Add file to local state
        const content = await file.text();
        const newFile: FileNode = {
          name: file.name,
          path: file.name,
          content,
          isDirectory: false,
          edited: true
        };

        setFiles(prev => [...prev, newFile]);
        setSelectedFile(newFile);

        setUploadStatus({
          message: `${file.name} uploaded successfully`,
          severity: 'success'
        });
      } catch (error) {
        console.error('Error uploading file:', error);
        setUploadStatus({
          message: `Error uploading ${file.name}`,
          severity: 'error'
        });
      }
    }
  }, [artifactId, artifactManager]);

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

      await artifactManager.remove_file({
        artifact_id: artifactId,
        file_path: file.path,
        _rkwargs: true
      });

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

      // Refresh the file list from the server instead of just updating local state
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
        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <div className="text-xl font-semibold text-gray-700">Loading files...</div>
          </div>
        ) : (
          files.map((file) => (
            <div
              key={file.path}
              className="group relative"
            >
              <div
                onClick={() => handleFileSelect(file)}
                className={`cursor-pointer px-4 py-2.5 hover:bg-gray-100 transition-colors flex items-center gap-3
                  ${selectedFile?.path === file.path ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}
              >
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

                <div className="flex items-center gap-2 flex-1">
                  <span className="truncate text-sm font-medium tracking-wide">
                    {file.name}
                  </span>
                  {(file.edited || unsavedChanges[file.path]) && (
                    <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full uppercase tracking-wider font-medium">
                      edited
                    </span>
                  )}
                </div>

                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDeleteConfirm(file.path);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded transition-opacity"
                >
                  <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  // Add this handler function near other handlers
  const handleValidationComplete = (result: ValidationResult) => {
    setUploadStatus({
      message: result.success ? 'Validation successful!' : 'Validation failed',
      severity: result.success ? 'success' : 'error'
    });
    
    setIsContentValid(result.success);
    setHasContentChanged(false);

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
      <div className="flex gap-2">
        {selectedFile && isTextFile(selectedFile.name) && (
          <button
            onClick={() => handleSave(selectedFile)}
            disabled={!unsavedChanges[selectedFile.path] || uploadStatus?.severity === 'info'}
            title={`Save (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+S)`}
            className={`px-6 py-2 rounded-md font-medium transition-colors whitespace-nowrap flex items-center gap-2
              ${!unsavedChanges[selectedFile.path] || uploadStatus?.severity === 'info'
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-300'}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            Save
          </button>
        )}

        {isRdfFile && (
          <div title={`Run Validator (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+R)`}>
            <ModelValidator
              rdfContent={getLatestRdfContent()}
              isDisabled={!server}
              onValidationComplete={handleValidationComplete}
              data-testid="model-validator-button"
            />
          </div>
        )}

        {isStaged && artifactType === 'model' && (
          <ModelTester
            artifactId={artifactId}
            modelUrl={`https://hypha.aicell.io/bioimage-io/artifacts/${artifactId.split('/').pop()}/create-zip-file?version=stage`}
            isDisabled={!server}
          />
        )}

        {/* Review & Publish button - only show when staged */}
        {isStaged && (
          <button
            onClick={() => handleTabChange('review')}
            disabled={shouldDisableActions}
            className={`px-6 py-2 rounded-md font-medium transition-colors whitespace-nowrap flex items-center gap-2
              ${shouldDisableActions
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : activeTab === 'review'
                  ? 'bg-blue-700 text-white'
                  : 'bg-blue-600 text-white hover:bg-blue-700'}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Review & Publish
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
    try {
      setUploadStatus({
        message: 'Creating new version...',
        severity: 'info'
      });
      // Create new version via edit
      const artifact = await artifactManager.edit({
        artifact_id: artifactId,
        version: "stage",
        _rkwargs: true
      });
      console.log(artifact);

      if (newVersionData.copyFiles) {
        // Get list of existing files
        const existingFiles = await artifactManager.list_files({
          artifact_id: artifactId,
          version: "latest",
          _rkwargs: true
        });
        // Filter out directories, only keep files
        const filesToCopy = existingFiles.filter(file => file.type === 'file');

        // Set up progress tracking
        setCopyProgress({
          current: 0,
          total: filesToCopy.length,
          file: ''
        });

        // Copy files one by one
        for (let i = 0; i < filesToCopy.length; i++) {
          const file = filesToCopy[i];
          setCopyProgress({
            current: i + 1,
            total: filesToCopy.length,
            file: file.name
          });

          try {
            // Get download URL for the file
            const downloadUrl = await artifactManager.get_file({
              artifact_id: artifactId,
              file_path: file.name,
              _rkwargs: true
            });

            // Get upload URL for the new version
            // TODO: If the file is a model weights file, we need to change the download weight
            const uploadUrl = await artifactManager.put_file({
              artifact_id: artifactId,
              file_path: file.name,
              _rkwargs: true
            });

            // Download and upload the file
            const response = await fetch(downloadUrl);
            if (!response.ok) {
              throw new Error(`Failed to download file: ${file.name}`);
            }
            const blob = await response.blob();
            
            const uploadResponse = await fetch(uploadUrl, {
              method: 'PUT',
              body: blob
            });
            
            if (!uploadResponse.ok) {
              throw new Error(`Failed to upload file: ${file.name}`);
            }
          } catch (error) {
            console.error(`Error copying file ${file.name}:`, error);
            setUploadStatus({
              message: `Error copying file ${file.name}`,
              severity: 'error'
            });
            // Continue with next file instead of stopping completely
            continue;
          }
        }
        
        setCopyProgress(null);
      }

      // Only close dialog and reload after all operations are complete
      setShowNewVersionDialog(false);
      
      // Reload artifact files
      await loadArtifactFiles();
      
      setUploadStatus({
        message: 'New version created successfully',
        severity: 'success'
      });
    } catch (error) {
      console.error('Error creating new version:', error);
      setUploadStatus({
        message: 'Error creating new version',
        severity: 'error'
      });
    }
  };

  // Add new version dialog component
  const renderNewVersionDialog = () => (
    <MuiDialog 
      open={showNewVersionDialog} 
      onClose={() => setShowNewVersionDialog(false)}
      maxWidth="sm"
      fullWidth
    >
      <div className="p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          Create New Version
        </h3>
        <div className="space-y-4">
          <FormControlLabel
            control={
              <Checkbox
                checked={newVersionData.copyFiles}
                onChange={(e) => setNewVersionData(prev => ({ ...prev, copyFiles: e.target.checked }))}
              />
            }
            label="Copy existing files to new version"
          />
        </div>
        <div className="mt-6 flex gap-3 justify-end">
          <button
            onClick={() => setShowNewVersionDialog(false)}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreateNewVersion}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700"
          >
            Create
          </button>
        </div>
      </div>
    </MuiDialog>
  );

  // Add this function inside the Edit component, before the return statement
  const setupKeyboardShortcuts = useCallback(() => {
    const shortcuts: KeyboardShortcut[] = [
      {
        key: 's',
        ctrlKey: true,
        metaKey: true, // for Mac
        handler: (e: KeyboardEvent) => {
          e.preventDefault();
          if (selectedFile && isTextFile(selectedFile.name)) {
            handleSave(selectedFile);
          }
        }
      },
      {
        key: 'r',
        ctrlKey: true,
        metaKey: true, // for Mac
        handler: (e: KeyboardEvent) => {
          e.preventDefault();
          if (selectedFile?.path.endsWith('rdf.yaml')) {
            // Get latest content including unsaved changes
            const rdfFile = files.find(file => file.path.endsWith('rdf.yaml'));
            if (!rdfFile) return;
            
            // Trigger validation via button click
            const validator = document.querySelector('[data-testid="model-validator-button"]');
            if (validator instanceof HTMLButtonElement) {
              validator.click();
            }
          }
        }
      }
    ];

    const handleKeyDown = (e: KeyboardEvent) => {
      shortcuts.forEach(shortcut => {
        if (
          e.key.toLowerCase() === shortcut.key &&
          (!shortcut.ctrlKey || e.ctrlKey) &&
          (!shortcut.metaKey || e.metaKey)
        ) {
          shortcut.handler(e);
        }
      });
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedFile, handleSave, unsavedChanges, files]); // Add other dependencies as needed

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

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header - remove border-b since content will scroll under it */}
      <div className="bg-white px-4 py-2 flex justify-between items-center sticky top-0 z-30">
        <div className="flex items-center gap-2">
          {/* Toggle sidebar button - moved to the left */}
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="lg:hidden p-2 rounded-md text-gray-500 hover:bg-gray-100"
            aria-label="Toggle sidebar"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isSidebarOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>

          {/* Back button */}
          <button
            onClick={() => navigate('/my-artifacts')}
            className="flex items-center text-gray-600 hover:text-gray-900"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to My Artifacts
          </button>
        </div>

        {/* Empty div to maintain flex justify-between */}
        <div></div>
      </div>

      <div className="flex flex-1">
        {/* Sidebar - update to be sticky and remove h-full */}
        <div className={`${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 w-80 bg-gray-50 border-r border-gray-200 flex flex-col sticky top-[49px] max-h-[calc(100vh-49px)] lg:static z-20 transition-transform duration-300 ease-in-out`}>

          {/* Artifact Info Box - always visible */}
          <div className="border-t border-gray-200 bg-white p-4 space-y-2">
            {artifactInfo ? (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-gray-900">
                    {artifactInfo.manifest.name}
                  </h3>
                  <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                    {artifactInfo.staging !== null ? 'stage' : (lastVersion ? `v${lastVersion}` : '')}
                  </span>
                </div>
                <div className="text-xs text-gray-500 font-mono mt-2 flex items-center gap-2">
                  {artifactInfo.manifest.id_emoji && (
                    <span 
                      role="img" 
                      aria-label="model emoji"
                      className="w-5 h-5 flex items-center justify-center bg-gray-100 rounded-full text-sm"
                    >
                      {artifactInfo.manifest.id_emoji}
                    </span>
                  )}
                  <span>ID: </span>
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
                </div>
                {/* Add status badge if artifact is staged */}
                {artifactInfo.staging !== null && artifactInfo.manifest?.status && (
                  <div className="mt-2">
                    <StatusBadge status={artifactInfo.manifest.status} size="small" />
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

        {/* Main content area - add w-full */}
        <div className="w-full">
          {/* Status bar - make it sticky */}
          {activeTab === 'files' && (
            <div className="border-b border-gray-200 bg-white sticky top-[49px] z-20">
              {/* Container with padding except bottom when progress bar is shown */}
              <div className={`p-4 ${uploadStatus?.progress !== undefined ? 'pb-0' : ''}`}>
                {/* Flex container that stacks below 1024px */}
                <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                  {/* Status section */}
                  <div className="flex-grow min-w-0">
                    {copyProgress ? (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-blue-600">
                            Copying files ({copyProgress.current}/{copyProgress.total}): {copyProgress.file}
                          </span>
                        </div>
                        <LinearProgress 
                          variant="determinate" 
                          value={(copyProgress.current / copyProgress.total) * 100} 
                          sx={{ mt: 1, height: 4, borderRadius: 2 }}
                        />
                      </>
                    ) : (
                      <>
                        {uploadStatus && (
                          <div className="flex items-center gap-2">
                            <span className={`text-base ${
                              uploadStatus.severity === 'error' ? 'text-red-600' :
                              uploadStatus.severity === 'success' ? 'text-green-600' :
                              'text-blue-600'
                            }`}>
                              {uploadStatus.message}
                            </span>
                          </div>
                        )}
                        {uploadStatus?.progress !== undefined && (
                          <LinearProgress 
                            variant="determinate" 
                            value={uploadStatus.progress} 
                            sx={{ mt: 1, height: 4, borderRadius: 2 }}
                          />
                        )}
                      </>
                    )}
                  </div>

                  {/* Buttons section */}
                  <div className="flex gap-2 flex-shrink-0">
                    {renderActionButtons()}
                  </div>
                </div>
              </div>

              {/* Progress bar at the bottom edge */}
              {uploadStatus?.progress !== undefined && (
                <LinearProgress 
                  variant="determinate" 
                  value={uploadStatus.progress} 
                  sx={{ 
                    height: 4,
                    borderRadius: 0,
                    marginTop: 1,
                  }}
                />
              )}
            </div>
          )}

          {/* Content area - add w-full */}
          <div className="w-full">
            {renderContent()}
          </div>
        </div>
      </div>

      {/* Publish Confirmation Dialog */}
      {renderPublishDialog()}

      {renderDeleteConfirmDialog()}

      {renderNewVersionDialog()}

      {/* Add ValidationErrorDialog */}
      <ValidationErrorDialog
        open={validationErrors.length > 0}
        errors={validationErrors}
        onClose={() => setValidationErrors([])}
      />

      {/* Add overlay for mobile when sidebar is open */}
      {files.length > 0 && isSidebarOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-10"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
    </div>
  );
};

export default Edit; 