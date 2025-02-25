import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import JSZip from 'jszip';
import Editor from '@monaco-editor/react';
import { useHyphaStore } from '../store/hyphaStore';
import axios from 'axios';
import { LinearProgress } from '@mui/material';
import yaml from 'js-yaml';
import { Link, useNavigate } from 'react-router-dom';
import ModelValidator from './ModelValidator';
import RDFEditor from './RDFEditor';

interface FileNode {
  name: string;
  path: string;
  content?: string | ArrayBuffer;
  isDirectory: boolean;
  children?: FileNode[];
  edited?: boolean;
  size: number;
  handle?: JSZip.JSZipObject;
  loaded?: boolean;
  file?: File;
}

interface Manifest {
  version?: string;
  [key: string]: any;
}

interface UploadStatus {
  message: string;
  severity: 'info' | 'success' | 'error';
  progress?: number;
}

interface ValidationResult {
  success: boolean;
  details: string;
}

interface TestResult {
  name: string;
  success: boolean;
  details: Array<{
    name: string;
    status: string;
    errors: Array<{
      msg: string;
      loc: string[];
    }>;
    warnings: Array<{
      msg: string;
      loc: string[];
    }>;
  }>;
}

type SupportedTextFiles = '.txt' | '.yml' | '.yaml' | '.json' | '.md' | '.py' | '.js' | '.ts' | '.jsx' | '.tsx' | '.css' | '.html' | '.ijm';
type SupportedImageFiles = '.png' | '.jpg' | '.jpeg' | '.gif';

interface UploadProps {
  artifactId?: string;
}

// Add new interface for upload artifact
interface UploadArtifact {
  id: string;
  version: string;
  // Add other properties as needed
}

// Add type definition for manifest
interface RdfManifest {
  type: 'model' | 'application' | 'dataset';
  name: string;
  [key: string]: any;
}

// Add these constants near the top of the file, after the interfaces
const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB threshold for chunked reading

// Add helper function to find emoji for a given name and type
const findEmoji = (config: any, type: string, name: string): string => {
  const category = type === 'model' ? 'animal' :
                  type === 'application' ? 'object' :
                  type === 'dataset' ? 'fruit' : null;
  
  if (!category || !config?.id_parts?.[category]) return '🦒'; // Use giraffe emoji if not found
  
  const names = config.id_parts[category];
  const emojis = config.id_parts[`${category}_emoji`];
  const index = names.indexOf(name);
  return index >= 0 ? emojis[index] : '🦒'; // Use giraffe emoji if not found
};

// Add helper to extract noun from generated ID
const extractNounFromId = (id: string): string => {
  // Find the last adjective in the list of hyphen-separated parts
  const parts = id.split('-');
  const adjectives = parts.slice(0, -1).join('-'); // All but last part is adjective
  const noun = parts[parts.length - 1]; // Last part is noun
  return noun;
};

const Upload: React.FC<UploadProps> = ({ artifactId }) => {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const { artifactManager, isLoggedIn, server, user } = useHyphaStore();
  const [uploadStatus, setUploadStatus] = useState<UploadStatus | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [showDragDrop, setShowDragDrop] = useState(!files.length);
  const navigate = useNavigate();
  const [isUploading, setIsUploading] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isValidated, setIsValidated] = useState(false);
  const [isUploaded, setIsUploaded] = useState(false);
  const [uploadedArtifact, setUploadedArtifact] = useState<UploadArtifact | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [generatedId, setGeneratedId] = useState<string | null>(null);
  const [generatedEmoji, setGeneratedEmoji] = useState<string | null>(null);

  useEffect(() => {
    if (artifactId) {
      loadArtifactFiles();
    }
  }, [artifactId]);

  useEffect(() => {
    if (files.some(f => f.edited)) {
      setIsValidated(false);
      setTestResult(null);
    }
  }, [files]);

  const isTextFile = (filename: string): boolean => {
    const textExtensions: SupportedTextFiles[] = [
      '.txt', '.yml', '.yaml', '.json', '.md', '.py', 
      '.js', '.ts', '.jsx', '.tsx', '.css', '.html',
      '.ijm'
    ];
    return textExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  };

  const isImageFile = (filename: string): boolean => {
    const imageExtensions: SupportedImageFiles[] = ['.png', '.jpg', '.jpeg', '.gif'];
    return imageExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getImageDataUrl = async (content: string | ArrayBufferLike, fileName: string): Promise<string> => {
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
      'txt': 'plaintext',
      'ijm': 'javascript'
    };
    return languageMap[extension] || 'plaintext';
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    // Check if we have a zip file or regular files
    const isZipFile = acceptedFiles.length === 1 && acceptedFiles[0].name.toLowerCase().endsWith('.zip');
    
    if (isZipFile) {
      await processZipFile(acceptedFiles[0]);
    } else {
      await processFilesAndFolders(acceptedFiles);
    }
  }, []);

  // Process a zip file (existing functionality)
  const processZipFile = async (zipFile: File) => {
    setUploadStatus({
      message: 'Processing zip file...',
      severity: 'info',
      progress: 0
    });
    
    const zip = new JSZip();
    
    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const loadedZip = await zip.loadAsync(zipFile);
      const fileNodes: FileNode[] = [];

      const totalFiles = Object.keys(loadedZip.files).length;
      let processedFiles = 0;

      setUploadStatus({
        message: 'Reading zip contents...',
        severity: 'info',
        progress: 5
      });

      for (const [path, file] of Object.entries(loadedZip.files)) {
        if (!file.dir) {
          const pathParts = path.split('/');
          const fileName = pathParts[pathParts.length - 1];
          
          const fileNode: FileNode = {
            name: fileName,
            path: path,
            isDirectory: false,
            size: (file as any)._data ? (file as any)._data.uncompressedSize : 0,
            handle: file
          };

          // Only load rdf.yaml content immediately
          if (fileName === 'rdf.yaml') {
            const content = await file.async('string');
            fileNode.content = content;
            fileNode.loaded = true;
          }

          fileNodes.push(fileNode);

          processedFiles++;
          setUploadStatus({
            message: `Processing files... (${processedFiles}/${totalFiles})`,
            severity: 'info',
            progress: 5 + ((processedFiles / totalFiles) * 95)
          });
        }
      }

      setFiles(fileNodes);
      setShowDragDrop(false);
      
      const rdfFile = fileNodes.find(file => file.path.endsWith('rdf.yaml'));
      if (rdfFile) {
        handleFileSelect(rdfFile);
      }

    } catch (error) {
      console.error('Error reading zip file:', error);
      setUploadStatus({
        message: 'Error reading zip file',
        severity: 'error'
      });
    }
  };

  // Process files and folders (new functionality)
  const processFilesAndFolders = async (acceptedFiles: File[]) => {
    setUploadStatus({
      message: 'Processing files...',
      severity: 'info',
      progress: 0
    });

    try {
      const fileNodes: FileNode[] = [];
      const totalFiles = acceptedFiles.length;
      
      // Sort files to prioritize rdf.yaml
      const sortedFiles = [...acceptedFiles].sort((a, b) => {
        if (a.name === 'rdf.yaml') return -1;
        if (b.name === 'rdf.yaml') return 1;
        return 0;
      });

      for (let i = 0; i < sortedFiles.length; i++) {
        const file = sortedFiles[i];
        // Ensure file has name property by using type assertion
        const relativePath = (file as File).webkitRelativePath || (file as File).name;
        const pathParts = relativePath.split('/');
        const fileName = pathParts[pathParts.length - 1];
        
        const fileNode: FileNode = {
          name: fileName,
          path: relativePath,
          isDirectory: false,
          size: file.size,
          file: file, // Store the actual File object instead of JSZip handle
          loaded: false
        };

        // Only load rdf.yaml content immediately
        if (fileName === 'rdf.yaml') {
          const content = await readFileContent(file);
          fileNode.content = content;
          fileNode.loaded = true;
        }

        fileNodes.push(fileNode);

        setUploadStatus({
          message: `Processing files... (${i + 1}/${totalFiles})`,
          severity: 'info',
          progress: ((i + 1) / totalFiles) * 100
        });
      }

      setFiles(fileNodes);
      setShowDragDrop(false);
      
      const rdfFile = fileNodes.find(file => file.path.endsWith('rdf.yaml'));
      if (rdfFile) {
        handleFileSelect(rdfFile);
      } else {
        // If no rdf.yaml found, show a warning
        setUploadStatus({
          message: 'Warning: No rdf.yaml file found. This is required for BioImage.io models.',
          severity: 'error'
        });
      }
    } catch (error) {
      console.error('Error processing files:', error);
      setUploadStatus({
        message: 'Error processing files',
        severity: 'error'
      });
    }
  };

  // Helper function to read file content
  const readFileContent = (file: File): Promise<string | ArrayBuffer> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result) {
          resolve(reader.result);
        } else {
          reject(new Error('Failed to read file'));
        }
      };
      reader.onerror = () => {
        reject(reader.error);
      };
      
      if (isImageFile(file.name)) {
        reader.readAsArrayBuffer(file);
      } else {
        reader.readAsText(file);
      }
    });
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    // Accept all files and directories
    noClick: false,
    noKeyboard: false,
    noDrag: false,
    multiple: true,
    // Support directory upload
    useFsAccessApi: false, // Set to false for broader browser compatibility
    // Accept all file types
    accept: {
      '*': ['.*'], // Accept all file types
    }
  });

  // Custom input props to enable directory upload
  const customInputProps = {
    ...getInputProps(),
    webkitdirectory: true,
    directory: true,
    mozdirectory: true
  };

  // Regular file input props (without directory selection)
  const fileInputProps = {
    ...getInputProps(),
    webkitdirectory: undefined,
    directory: undefined,
    mozdirectory: undefined
  };

  // Create refs for the file and folder inputs
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const folderInputRef = React.useRef<HTMLInputElement>(null);

  // Function to trigger file input click
  const handleFileButtonClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // Function to trigger folder input click
  const handleFolderButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (folderInputRef.current) {
      folderInputRef.current.click();
    }
  };

  const loadFileContent = async (file: FileNode) => {
    if (file.loaded) return file.content;

    try {
      if (file.handle) {
        // Handle JSZip file
        const isImage = file.name.match(/\.(png|jpg|jpeg|gif)$/i);
        const content = await file.handle.async(isImage ? 'arraybuffer' : 'string');
        
        setFiles(prevFiles => prevFiles.map(f => 
          f.path === file.path 
            ? { ...f, content, loaded: true }
            : f
        ));

        return content;
      } else if (file.file) {
        // Handle regular File object
        const content = await readFileContent(file.file);
        
        setFiles(prevFiles => prevFiles.map(f => 
          f.path === file.path 
            ? { ...f, content, loaded: true }
            : f
        ));

        return content;
      }
      
      return null;
    } catch (error) {
      console.error('Error loading file content:', error);
      throw error;
    }
  };

  const handleFileSelect = async (file: FileNode) => {
    setImageUrl(null);
    setSelectedFile(null);

    if (isTextFile(file.name) || isImageFile(file.name)) {
      if (file.loaded && file.content) {
        if (isImageFile(file.name)) {
          const url = await getImageDataUrl(file.content, file.name);
          setImageUrl(url);
        }
        setSelectedFile(file);
      } else {
        try {
          setUploadStatus({
            message: `Loading ${file.name}...`,
            severity: 'info'
          });

          const content = await loadFileContent(file);
          if (!content) return;
          
          const updatedFile = { ...file, content, loaded: true };
          
          if (isImageFile(file.name)) {
            const url = await getImageDataUrl(content, file.name);
            setImageUrl(url);
          }

          setSelectedFile(updatedFile);
          setUploadStatus(null);
        } catch (error) {
          setUploadStatus({
            message: `Error loading ${file.name}`,
            severity: 'error'
          });
        }
      }
    } else {
      setSelectedFile(file);
    }
  };

  const handleEditorChange = (value: string | undefined, file: FileNode) => {
    if (value === undefined || !file) return;
    
    // Only mark as edited if content actually changed
    const currentContent = typeof file.content === 'string' ? file.content : '';
    if (value !== currentContent) {
      setFiles(files.map(f => 
        f.path === file.path 
          ? { ...f, content: value, edited: true }
          : f
      ));
    }
  };

  const handleValidationComplete = (result: ValidationResult) => {
    setIsValidated(result.success);
    setUploadStatus({
      message: result.success ? 'Validation successful!' : 'Validation failed',
      severity: result.success ? 'success' : 'error',
      ...(uploadStatus?.progress !== undefined && { progress: uploadStatus.progress })
    });
    if (result.success && !uploadedArtifact && artifactId) {
      setUploadedArtifact({
        id: artifactId,
        version: 'stage'
      });
    }
  };

  const handleUpload = async () => {
    if (isUploading) return;
    
    if (!artifactManager || !user?.email) {
      setUploadStatus({
        message: 'Please login first',
        severity: 'error'
      });
      return;
    }

    try {
      setIsUploading(true);
      setUploadStatus({
        message: 'Reading manifest file...',
        severity: 'info'
      });

      const rdfFile = files.find(file => file.path.endsWith('rdf.yaml'));
      if (!rdfFile) {
        throw new Error('No rdf.yaml file found in the upload');
      }

      let manifest: RdfManifest;
      try {
        // Ensure rdf.yaml content is loaded
        let rdfContent: string;
        if (!rdfFile.loaded || !rdfFile.content) {
          // Load content if not already loaded
          if (rdfFile.handle) {
            // From zip file
            rdfContent = await rdfFile.handle.async('string');
          } else if (rdfFile.file) {
            // From regular file
            rdfContent = await readFileContent(rdfFile.file) as string;
          } else {
            throw new Error('Cannot load rdf.yaml content');
          }
        } else {
          rdfContent = typeof rdfFile.content === 'string' 
            ? rdfFile.content
            : new TextDecoder().decode(rdfFile.content);
        }
        
        manifest = yaml.load(rdfContent) as RdfManifest;

        // Set uploader email automatically
        manifest.uploader = {
          ...manifest.uploader,
          email: user.email
        };

        // Update the rdf.yaml content with the new manifest
        const updatedContent = yaml.dump(manifest);
        
        // Update the file in the files array
        const updatedFiles = files.map(file => 
          file.path.endsWith('rdf.yaml')
            ? { ...file, content: updatedContent }
            : file
        );
        setFiles(updatedFiles);

      } catch (error) {
        console.error('Error parsing rdf.yaml:', error);
        throw new Error('Invalid rdf.yaml format');
      }

      // Set alias pattern based on manifest type
      let aliasPattern: string;
      switch (manifest.type) {
        case 'model':
          aliasPattern = '{animal_adjective}-{animal}';
          break;
        case 'application':
          aliasPattern = '{object_adjective}-{object}';
          break;
        case 'dataset':
          aliasPattern = '{fruit_adjective}-{fruit}';
          break;
        default:
          aliasPattern = '{object_adjective}-{object}';
      }

      // Create new artifact with type-specific alias pattern
      const artifact = await artifactManager.create({
        parent_id: "bioimage-io/bioimage.io",
        alias: aliasPattern,
        type: manifest.type,
        manifest: manifest,
        config: {
          publish_to: "sandbox_zenodo"
        },
        version: "stage",
        _rkwargs: true,
        overwrite: true,
      });

      // Extract the ID part from the full artifact ID
      const fullId = artifact.id;
      const shortId = fullId.split('/').pop() || '';
      setGeneratedId(shortId);

      // Find the emoji for the generated id
      const noun = extractNounFromId(shortId);
      const collection = await artifactManager.read({
        artifact_id: 'bioimage-io/bioimage.io',
        _rkwargs: true
      });
      const emoji = findEmoji(collection.config, manifest.type, noun);
      setGeneratedEmoji(emoji);

      // Update the manifest with the id and emoji, preserving other fields
      const updatedManifest = {
        ...manifest,
        id: shortId,
        id_emoji: emoji,
        // If there's an existing config, preserve other config fields
        config: manifest.config ? {
          ...manifest.config,
          // Remove bioimageio section if it exists
          ...(manifest.config.bioimageio && {
            ...manifest.config,
            bioimageio: undefined
          })
        } : undefined
      };

      // Clean up undefined values
      if (updatedManifest.config === undefined) {
        delete updatedManifest.config;
      }

      // Update the rdf.yaml content in the files array and mark it as edited
      const updatedFiles = files.map(file => {
        if (file.path.endsWith('rdf.yaml')) {
          const updatedContent = yaml.dump(updatedManifest, {
            // Ensure consistent formatting
            indent: 2,
            lineWidth: -1, // Don't wrap long lines
            noRefs: true, // Don't use aliases
          });
          return {
            ...file,
            content: updatedContent,
            edited: true
          };
        }
        return file;
      });
      setFiles(updatedFiles);

      // Find the updated rdf file
      const updatedRdfFile = updatedFiles.find(file => file.path.endsWith('rdf.yaml'));
      if (!updatedRdfFile) {
        throw new Error('Failed to update rdf.yaml');
      }

      // Upload the updated rdf.yaml first
      setUploadStatus({
        message: 'Uploading updated manifest...',
        severity: 'info',
        progress: 0
      });

      const rdfPutUrl = await artifactManager.put_file({
        artifact_id: artifact.id,
        file_path: updatedRdfFile.path,
        _rkwargs: true,
      });

      await axios.put(rdfPutUrl, updatedRdfFile.content, {
        headers: {
          "Content-Type": ""
        }
      });

      // Update the artifact with the updated manifest
      await artifactManager.edit({
        artifact_id: fullId,
        manifest: updatedManifest,
        version: "stage",
        _rkwargs: true
      });

      // Upload remaining files
      const remainingFiles = updatedFiles.filter(file => !file.path.endsWith('rdf.yaml'));
      for (let index = 0; index < remainingFiles.length; index++) {
        const file = remainingFiles[index];
        setUploadStatus({
          message: `Uploading ${file.name}...`,
          severity: 'info',
          progress: ((index + 1) / (remainingFiles.length + 1)) * 100
        });

        try {
          // Get file content or handle
          let content: string | ArrayBuffer | null = null;
          let fileSize = 0;
          let isLargeFile = false;
          let fileObject: File | null = null;
          
          if (file.handle) {
            // From zip file
            const isImage = file.name.match(/\.(png|jpg|jpeg|gif)$/i);
            content = await file.handle.async(isImage ? 'arraybuffer' : 'string');
            fileSize = content instanceof ArrayBuffer ? content.byteLength : content.length;
          } else if (file.file) {
            // From regular file
            fileObject = file.file;
            fileSize = fileObject.size;
            
            // Check if this is a large file that needs chunked upload
            isLargeFile = fileSize > LARGE_FILE_THRESHOLD;
            
            if (!isLargeFile) {
              // For smaller files, load content as before
              if (!file.loaded || !file.content) {
                content = await readFileContent(file.file);
              } else {
                content = file.content;
              }
            }
            // For large files, we'll use the File object directly with chunked upload
          } else if (file.content) {
            // Already loaded content
            content = file.content;
            fileSize = content instanceof ArrayBuffer ? content.byteLength : content.length;
          }

          // Get the upload URL
          const putUrl = await artifactManager.put_file({
            artifact_id: artifact.id,
            file_path: file.path,
            _rkwargs: true,
          });

          if (isLargeFile && fileObject) {
            // Perform chunked upload for large files
            await uploadLargeFile(putUrl, fileObject, fileSize, (progress) => {
              setUploadStatus({
                message: `Uploading ${file.name}... (${Math.round(progress)}%)`,
                severity: 'info',
                progress: ((index + (progress / 100)) / remainingFiles.length) * 100
              });
            });
          } else if (content) {
            // Regular upload for smaller files
            const blob = new Blob([content], { type: "application/octet-stream" });
            await axios.put(putUrl, blob, {
              headers: {
                "Content-Type": ""
              },
              onUploadProgress: (progressEvent) => {
                const progress = progressEvent.total
                  ? (progressEvent.loaded / progressEvent.total) * 100
                  : 0;
                
                setUploadStatus({
                  message: `Uploading ${file.name}...`,
                  severity: 'info',
                  progress: ((index + (progress / 100)) / remainingFiles.length) * 100
                });
              }
            });
          } else {
            throw new Error(`No content available for ${file.name}`);
          }

          // Clear content from memory after successful upload
          setFiles(prevFiles => prevFiles.map(f => 
            f.path === file.path 
              ? { ...f, content: undefined, loaded: false }
              : f
          ));

        } catch (error) {
          console.error(`Error uploading ${file.name}:`, error);
          throw new Error(`Failed to upload ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // After successful upload, redirect to edit page
      navigate(`/edit/${encodeURIComponent(artifact.id)}`);

    } catch (error) {
      console.error('Upload failed:', error);
      setUploadStatus({
        message: error instanceof Error 
          ? `Upload failed: ${error.message}` 
          : 'Upload failed: Unknown error occurred',
        severity: 'error'
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSave = async () => {
    if (isUploading) return;
    
    if (!artifactManager || !uploadedArtifact) {
      setUploadStatus({
        message: 'No artifact to save to',
        severity: 'error'
      });
      return;
    }

    try {
      setIsUploading(true);
      
      // Filter files that have been edited
      const filesToUpload = files.filter(file => file.edited);
      
      // Upload only edited files sequentially with progress
      for (let index = 0; index < filesToUpload.length; index++) {
        const file = filesToUpload[index];
        setUploadStatus({
          message: `Saving ${file.name}...`,
          severity: 'info',
          progress: (index / filesToUpload.length) * 100
        });

        const putUrl = await artifactManager.put_file({
          artifact_id: uploadedArtifact.id,
          file_path: file.path,
          _rkwargs: true,
        });
        
        const blob = new Blob([file.content!], { type: "application/octet-stream" });
        await axios.put(putUrl, blob, {
          headers: {
            "Content-Type": ""
          },
          onUploadProgress: (progressEvent) => {
            const progress = progressEvent.total
              ? (progressEvent.loaded / progressEvent.total) * 100
              : 0;
            
            setUploadStatus({
              message: `Saving ${file.name}...`,
              severity: 'info',
              progress: ((index + (progress / 100)) / filesToUpload.length) * 100
            });
          }
        });
      }

      // Reset edited flags after successful save
      setFiles(files.map(file => ({ ...file, edited: false })));

      setUploadStatus({
        message: 'Changes saved successfully!',
        severity: 'success',
        progress: 100
      });

    } catch (error) {
      console.error('Save failed:', error);
      setUploadStatus({
        message: error instanceof Error 
          ? `Save failed: ${error.message}` 
          : 'Save failed: Unknown error occurred',
        severity: 'error'
      });
    } finally {
      setIsUploading(false);
    }
  };

  const getStatusColor = (severity: 'info' | 'success' | 'error') => {
    switch (severity) {
      case 'info':
        return 'text-blue-600';
      case 'success':
        return 'text-green-600';
      case 'error':
        return 'text-red-600';
      default:
        return 'text-gray-500';
    }
  };

  const loadArtifactFiles = async () => {
    if (!artifactManager || !artifactId) return;
    
    try {
      const fileList = await artifactManager.list_files({
        artifact_id: artifactId,
        _rkwargs: true
      });

      // Convert the file list to FileNode format
      const nodes: FileNode[] = await Promise.all(fileList.map(async (fileInfo: any) => {
        // Use a more explicit type assertion
        const file = fileInfo as { type: string; name: string };
        
        if (file.type === 'file') {
          return {
            name: file.name,
            path: file.name,
            isDirectory: false,
            size: 0,
            loaded: false
          };
        }
        return {
          name: file.name,
          path: file.name,
          isDirectory: true,
          size: 0,
          children: []
        };
      }));

      setFiles(nodes);
      setShowDragDrop(false);

      // Select rdf.yaml by default if it exists
      const rdfFile = nodes.find(file => file.path.endsWith('rdf.yaml'));
      if (rdfFile) {
        handleFileSelect(rdfFile);
      }
    } catch (error) {
      console.error('Error loading artifact files:', error);
    }
  };

  const getFirstErrorLine = (details: string) => {
    return details.split('\n')[0];
  };

  // Find the rdf file from the files array
  const getRdfFile = () => {
    return files.find(file => file.path.endsWith('rdf.yaml'));
  };

  // Replace the uploadLargeFile function with this implementation
  const uploadLargeFile = async (
    url: string, 
    file: File, 
    fileSize: number,
    onProgress: (progress: number) => void
  ): Promise<void> => {
    // For S3 which doesn't support range requests during upload, we'll use
    // a streaming approach where we read in chunks but upload in a single request
    
    try {
      // Create a custom Blob with a stream source that reads the file in chunks
      const reader = new FileReader();
      const xhr = new XMLHttpRequest();
      
      // Open the connection
      xhr.open('PUT', url, true);
      xhr.setRequestHeader('Content-Type', '');
      
      // Set up progress reporting
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percentComplete = (event.loaded / event.total) * 100;
          onProgress(percentComplete);
        }
      };
      
      // Set up completion and error handlers
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          console.log('Upload completed successfully');
        } else {
          throw new Error(`Upload failed with status ${xhr.status}`);
        }
      };
      
      xhr.onerror = () => {
        throw new Error('Network error occurred during upload');
      };
      
      // Start the upload with the entire file
      // This will stream from disk rather than loading the entire file into memory at once
      xhr.send(file);
      
      // Wait for the upload to complete
      return new Promise((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error('Network error occurred during upload'));
      });
    } catch (error) {
      console.error('Error during large file upload:', error);
      throw error;
    }
  };

  return (
    <div className="flex flex-col">
      {/* Add back button when viewing existing artifact */}
      {files.length > 0 && (<>
        {/* Add toggle sidebar button - only show when files are loaded */}
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
        </>
    )}
      {/* Show title section only when no files are loaded */}
      {showDragDrop && (
        <div className="bg-white border-b border-gray-80">
          <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8 text-center">
            <h1 className="text-2xl font-semibold text-gray-900">
              Contributing to the BioImage Model Zoo
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Upload and share your AI models with the bioimage analysis community
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        {files.length > 0 && (
          <div className={`${
            isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } lg:translate-x-0 w-80 bg-gray-50 border-r border-gray-200 flex flex-col 
          fixed lg:relative inset-y-0 
          transition-transform duration-300 ease-in-out 
          h-screen lg:h-[calc(100vh-64px)] z-40
          overflow-hidden`}>
            <div className="p-4 border-b border-gray-200 flex flex-col gap-2">
              {generatedId ? (
                <>
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-medium text-gray-900">
                      {files.find(f => f.path.endsWith('rdf.yaml'))?.content && 
                        yaml.load(files.find(f => f.path.endsWith('rdf.yaml'))?.content as string)?.name || 'Untitled'}
                    </h2>
                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                      stage
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 font-mono flex items-center gap-1">
                    {generatedEmoji && (
                      <span 
                        role="img" 
                        aria-label="model emoji"
                        className="w-5 h-5 flex items-center justify-center bg-gray-100 rounded-full text-sm"
                      >
                        {generatedEmoji}
                      </span>
                    )}
                    ID: 
                    <span className="bg-gray-100 px-2 py-0.5 rounded">
                      {generatedId}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="text-lg font-semibold text-gray-900">
                    Contributing to the Zoo
                  </h2>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 font-medium">Package Contents</span>
                  </div>
                </>
              )}
            </div>

            {/* Scrollable file list */}
            <div className="flex-1 overflow-y-auto min-h-[calc(100vh-200px)]">
              <div className="py-2 h-full">
                {files.map((file) => (
                  <div
                    key={file.path}
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
                      ) : file.name.endsWith('.py') ? (
                        <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      )}
                    </span>

                    {/* File Name with Star for rdf.yaml */}
                    <div className="flex items-center gap-2 flex-1">
                      <span className="truncate text-sm font-medium tracking-wide">
                        {file.name}
                      </span>
                      {file.name === 'rdf.yaml' && (
                        <svg className="w-4 h-4 text-yellow-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                      )}
                    </div>

                    {/* Edit Badge */}
                    {file.edited && (
                      <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full uppercase tracking-wider font-medium">
                        edited
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Main content area */}
        <div className="w-full flex flex-col overflow-hidden min-h-screen">
          {/* Status bar */}
          {files.length > 0 && (
            <div className="border-b border-gray-200 bg-white sticky top-0 z-50">
              {/* Container with padding */}
              <div className="p-2">
                {/* Flex container that stacks below 1024px */}
                <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                  {/* Status section */}
                  <div className="flex-grow min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {uploadStatus && (
                        <>
                          <span className="text-gray-400">•</span>
                          <span className={`${getStatusColor(uploadStatus.severity)} text-base truncate`}>
                            {uploadStatus.message}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Buttons section */}
                  <div className="flex gap-2 flex-shrink-0">
                    <ModelValidator
                      rdfContent={getRdfFile()?.content as string}
                      isDisabled={!getRdfFile() || !server}
                      onValidationComplete={handleValidationComplete}
                    />
                    {!uploadedArtifact && (
                      <button
                        onClick={handleUpload}
                        disabled={isUploading || !isLoggedIn || !isValidated}
                        className={`px-6 py-2 rounded-md font-medium transition-colors whitespace-nowrap flex items-center gap-2
                          ${isUploading || !isLoggedIn || !isValidated
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                      >
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                          </svg>
                          {!isLoggedIn 
                            ? 'Please login'
                            : isUploading 
                              ? 'Uploading...' 
                              : 'Upload'}
                        </>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Progress bar with increased top margin */}
              {uploadStatus?.progress !== undefined && (
                <div className="mt-2"> {/* Add margin container */}
                  <LinearProgress 
                    variant="determinate" 
                    value={uploadStatus.progress} 
                    sx={{ 
                      height: 4,
                      borderRadius: 0,
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Content area - update height calculation */}
          <div className="flex-1 overflow-auto min-h-[calc(100vh-145px)]">
            {showDragDrop ? (
              <div className="h-full flex items-center justify-center">
                <div className="mt-10 text-center max-w-2xl mx-auto">
                  {uploadStatus?.message && uploadStatus.severity === 'info' && uploadStatus.progress !== undefined ? (
                    // Show loading spinner while processing
                    <div className="flex flex-col items-center justify-center mb-8">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                      <div className="text-xl font-semibold text-gray-700 mb-2">{uploadStatus.message}</div>
                      <div className="w-64 bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                          style={{ width: `${uploadStatus.progress}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div 
                      {...getRootProps()} 
                      className="border-2 border-dashed border-gray-300 rounded-lg p-12 hover:bg-gray-50 transition-colors cursor-pointer mb-8"
                      onClick={handleFolderButtonClick}
                    >
                      {/* Hidden inputs for file and folder selection */}
                      <input {...fileInputProps} ref={fileInputRef} />
                      <input {...customInputProps} ref={folderInputRef} style={{ display: 'none' }} />
                      
                      <div className="mb-6">
                        <div className="w-16 h-16 mx-auto mb-4">
                          <svg className="w-full h-full text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                        </div>
                        {isDragActive ? (
                          <p className="text-lg text-blue-600 font-medium">Drop your files or folder here...</p>
                        ) : (
                          <>
                            <p className="text-lg text-gray-700 font-medium mb-2">
                              Drag & drop your model files here
                            </p>
                          </>
                        )}
                      </div>
                      <div className="text-sm text-gray-500 bg-blue-50 p-3 rounded-md border border-blue-100">
                        <p className="font-medium text-blue-700 mb-1">💡 Pro Tip for Large Files</p>
                        <p className="mb-3">For models with large files (&gt;3GB), please upload individual files instead of a ZIP archive to avoid memory issues in your browser.</p>
                        
                        {/* Added buttons here */}
                        <div className="flex flex-col sm:flex-row justify-center gap-3 mt-4">
                          <button
                            type="button"
                            onClick={handleFolderButtonClick}
                            className="px-4 py-2 bg-blue-100 border border-blue-200 rounded-md text-blue-700 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                          >
                            <span className="flex items-center gap-1">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                              </svg>
                              Select Files
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Only show View My Artifacts button when logged in */}
                  {isLoggedIn && (
                    <Link
                      to="/my-artifacts"
                      className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 bg-gray-50 px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                      View My Artifacts
                    </Link>
                  )}

                  <div className="space-y-4 text-left bg-gray-50 p-6 rounded-lg">
                    <h3 className="text-xl font-semibold text-gray-700 tracking-tight">
                      How to upload your model:
                    </h3>
                    <ol className="list-decimal list-inside space-y-3 text-gray-600 text-base">
                      <li className="leading-relaxed">Prepare your model package following the BioImage.io specification</li>
                      <li className="leading-relaxed">Ensure your package includes a valid <code className="bg-gray-200 px-1.5 py-0.5 rounded text-sm font-mono">rdf.yaml</code> file</li>
                      <li className="leading-relaxed">Upload using one of these methods:
                        <ul className="list-disc list-inside ml-6 mt-2 space-y-1 text-sm">
                          <li><strong>Folder upload:</strong> Drag & drop a folder containing all your model files (recommended for large files)</li>
                          <li><strong>Multiple files:</strong> Select all files individually</li>
                          <li><strong>ZIP archive:</strong> Compress all files into a ZIP (not recommended for files &gt;3GB)</li>
                        </ul>
                      </li>
                    </ol>
                    <div className="mt-4 bg-yellow-50 p-3 rounded-md border border-yellow-100 text-sm">
                      <p className="font-medium text-yellow-700">⚠️ Important Note for Large Files</p>
                      <p className="text-yellow-600">If your model contains large files (&gt;3GB), please upload a folder or individual files instead of a ZIP archive to avoid memory issues.</p>
                    </div>
                    <p className="text-sm text-gray-500 mt-6">
                      Need help? Check out our <a href="#" className="text-blue-600 hover:underline font-medium">documentation</a> or 
                      join our <a href="#" className="text-blue-600 hover:underline font-medium">community forum</a>.
                    </p>
                  </div>
                </div>
              </div>
            ) : selectedFile ? (
              <div className="h-full min-h-[calc(80vh-145px)]">
                {isImageFile(selectedFile.name) ? (
                  <div className="flex flex-col gap-4">
                    {imageUrl ? (
                      <img 
                        src={imageUrl}
                        alt={selectedFile.name} 
                        className="max-w-full h-auto"
                      />
                    ) : (
                      <div className="flex items-center justify-center h-40 bg-gray-50 rounded-lg">
                        <div className="text-gray-400">Loading image...</div>
                      </div>
                    )}
                  </div>
                ) : selectedFile.name.endsWith('rdf.yaml') ? (
                  <RDFEditor
                    content={typeof selectedFile.content === 'string' ? selectedFile.content : ''}
                    onChange={(value) => handleEditorChange(value, selectedFile)}
                    readOnly={false}
                    showModeSwitch={true}
                  />
                ) : isTextFile(selectedFile.name) ? (
                  <div className="flex flex-col gap-4">
                    <Editor
                      height="calc(100vh - 177px)" // 145px + 32px (p-4 top and bottom)
                      language={getEditorLanguage(selectedFile.name)}
                      value={typeof selectedFile.content === 'string' ? selectedFile.content : ''}
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
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-4">
                    <div className="bg-gray-50 p-6 rounded-lg">
                      <h3 className="font-medium text-lg mb-4">File Information</h3>
                      <div className="space-y-2">
                        <p><span className="font-medium">Name:</span> {selectedFile.name}</p>
                        <p><span className="font-medium">Size:</span> {formatFileSize(selectedFile.size)}</p>
                        <p><span className="font-medium">Type:</span> {selectedFile.name.split('.').pop()?.toUpperCase() || 'Unknown'}</p>
                      </div>
                      <p className="mt-4 text-sm text-gray-400">This file type cannot be previewed</p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500">
                Select a file to view or edit
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add overlay for mobile when sidebar is open */}
      {isSidebarOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-30"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Add this after the status bar and before the content area */}
      {files.length > 0 && (
        <div className="border-t border-gray-200 bg-white p-4 space-y-2">
          {generatedId && (
            <>
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-gray-900">
                  {files.find(f => f.path.endsWith('rdf.yaml'))?.content && 
                    yaml.load(files.find(f => f.path.endsWith('rdf.yaml'))?.content as string)?.name || 'Untitled'}
                </h3>
                <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                  stage
                </span>
              </div>
              <div className="text-xs text-gray-500 font-mono flex items-center gap-1">
                {generatedEmoji && (
                  <span 
                    role="img" 
                    aria-label="model emoji"
                    className="w-5 h-5 flex items-center justify-center bg-gray-100 rounded-full text-sm"
                  >
                    {generatedEmoji}
                  </span>
                )}
                ID: 
                <span className="bg-gray-100 px-2 py-0.5 rounded">
                  {generatedId}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default Upload; 