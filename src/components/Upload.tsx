import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import JSZip from 'jszip';
import Editor from '@monaco-editor/react';
import { useHyphaStore } from '../store/hyphaStore';
import axios from 'axios';
import { LinearProgress } from '@mui/material';
import yaml from 'js-yaml';
import { Link, useNavigate } from 'react-router-dom';
import RDFEditor from './RDFEditor';
import TermsOfService from './TermsOfService';
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

// Universal binary file detection
const isKnownTextFile = (filename: string): boolean => {
  const textExtensions = [
    '.txt', '.yml', '.yaml', '.json', '.xml', '.csv', '.tsv',
    '.md', '.rst', '.tex',
    '.py', '.js', '.ts', '.jsx', '.tsx', '.css', '.html', '.htm',
    '.c', '.cpp', '.h', '.hpp', '.java', '.php', '.rb', '.go', '.rs',
    '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
    '.ijm', '.ini', '.cfg', '.conf', '.toml', '.log', '.sql', '.r', '.R', '.ipynb'
  ];
  return textExtensions.some(ext => filename.toLowerCase().endsWith(ext));
};

interface UploadProps {
  artifactId?: string;
}

interface UploadArtifact {
  id: string;
  version: string;
}

interface RdfManifest {
  type: 'model' | 'application' | 'dataset';
  name: string;
  [key: string]: any;
}

const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB

const findEmoji = (config: any, type: string, name: string): string => {
  const category = type === 'model' ? 'animal' :
                  type === 'application' ? 'object' :
                  type === 'dataset' ? 'fruit' : null;
  
  if (!category || !config?.id_parts?.[category]) return '🦒';
  
  const names = config.id_parts[category];
  const emojis = config.id_parts[`${category}_emoji`];
  const index = names.indexOf(name);
  return index >= 0 ? emojis[index] : '🦒';
};

const extractNounFromId = (id: string): string => {
  const parts = id.split('-');
  const noun = parts[parts.length - 1];
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
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [showingTos, setShowingTos] = useState(false);

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
    const isZipFile = acceptedFiles.length === 1 && acceptedFiles[0].name.toLowerCase().endsWith('.zip');
    if (isZipFile) {
      await processZipFile(acceptedFiles[0]);
    } else {
      await processFilesAndFolders(acceptedFiles);
    }
  }, []);

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
      setUploadStatus({
        message: `Successfully loaded ${totalFiles} files`,
        severity: 'info',
        progress: 100
      });
      
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

  const processFilesAndFolders = async (acceptedFiles: File[]) => {
    setUploadStatus({
      message: 'Processing files...',
      severity: 'info',
      progress: 0
    });

    try {
      const fileNodes: FileNode[] = [];
      const totalFiles = acceptedFiles.length;
      const isDirectoryUpload = acceptedFiles.length > 0 && 
                               acceptedFiles[0].webkitRelativePath && 
                               acceptedFiles[0].webkitRelativePath.includes('/');
      
      const sortedFiles = [...acceptedFiles].sort((a, b) => {
        if (a.name === 'rdf.yaml') return -1;
        if (b.name === 'rdf.yaml') return 1;
        return 0;
      });

      for (let i = 0; i < sortedFiles.length; i++) {
        const file = sortedFiles[i];
        let relativePath = '';
        
        if (isDirectoryUpload && file.webkitRelativePath) {
          relativePath = file.webkitRelativePath;
        } else {
          relativePath = file.name;
        }
        
        const pathParts = relativePath.split('/');
        const fileName = pathParts[pathParts.length - 1];
        
        const fileNode: FileNode = {
          name: fileName,
          path: relativePath,
          isDirectory: false,
          size: file.size,
          file: file,
          loaded: false
        };

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
      setUploadStatus({
        message: `Successfully loaded ${totalFiles} files`,
        severity: 'info',
        progress: 100
      });
      
      const rdfFile = fileNodes.find(file => file.path.endsWith('rdf.yaml'));
      if (rdfFile) {
        handleFileSelect(rdfFile);
      } else {
        setUploadStatus({
          message: 'Warning: No rdf.yaml file found. This is required for RI-SCALE Model Hub models.',
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
      
      if (!isKnownTextFile(file.name)) {
        reader.readAsArrayBuffer(file);
      } else {
        reader.readAsText(file);
      }
    });
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    noClick: false,
    noKeyboard: false,
    noDrag: false,
    multiple: true,
    useFsAccessApi: false,
    accept: {
      '*': ['.*'],
    }
  });

  const customInputProps = {
    ...getInputProps(),
    webkitdirectory: "true",
    directory: "true",
    mozdirectory: "true",
    multiple: true
  };

  const fileInputProps = {
    ...getInputProps(),
    webkitdirectory: undefined,
    directory: undefined,
    mozdirectory: undefined
  };

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const folderInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileButtonClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFolderButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (folderInputRef.current) {
      folderInputRef.current.click();
    }
  };

  const handleZipButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (fileInputRef.current) {
      fileInputRef.current.accept = '.zip';
      fileInputRef.current.click();
      setTimeout(() => {
        if (fileInputRef.current) {
          fileInputRef.current.accept = '';
        }
      }, 100);
    }
  };

  const loadFileContent = async (file: FileNode) => {
    if (file.loaded) return file.content;

    try {
      if (file.handle) {
        const isBinary = !isKnownTextFile(file.name);
        const content = await file.handle.async(isBinary ? 'arraybuffer' : 'string');
        
        setFiles(prevFiles => prevFiles.map(f => 
          f.path === file.path 
            ? { ...f, content, loaded: true }
            : f
        ));

        return content;
      } else if (file.file) {
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
    setImageDimensions(null);

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
      setShowingTos(true);
      setUploadStatus({
        message: 'Please review and agree to our Terms of Service to continue',
        severity: 'info'
      });
      return;
    } catch (error) {
      console.error('Upload failed:', error);
      setUploadStatus({
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        severity: 'error'
      });
      setIsUploading(false);
    }
  };

  const handleAgreeAndUpload = async () => {
    try {
      setShowingTos(false);
      
      setUploadStatus({
        message: 'Reading manifest file...',
        severity: 'info'
      });

      const rdfFile = files.find(file => file.path.endsWith('rdf.yaml'));
      if (!rdfFile) {
        throw new Error('No rdf.yaml file found in the upload');
      }

      let manifest: RdfManifest;
      let weightFilePaths: string[] = [];
      
      try {
        let rdfContent: string;
        if (!rdfFile.loaded || !rdfFile.content) {
          if (rdfFile.handle) {
            rdfContent = await rdfFile.handle.async('string');
          } else if (rdfFile.file) {
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
        weightFilePaths = manifest.type === 'model' ? extractWeightFiles(manifest) : [];

        manifest.uploader = {
          ...manifest.uploader,
          email: user.email
        };

        const updatedContent = yaml.dump(manifest);
        
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

      const artifact = await artifactManager.create({
        parent_id: "ri-scale/ai-model-hub",
        alias: aliasPattern,
        type: manifest.type,
        manifest: manifest,
        config: {
          publish_to: "sandbox_zenodo"
        },
        stage: true,
        _rkwargs: true,
        overwrite: true,
      });

      const fullId = artifact.id;
      const shortId = fullId.split('/').pop() || '';
      setGeneratedId(shortId);

      const noun = extractNounFromId(shortId);
      const collection = await artifactManager.read({
        artifact_id: 'ri-scale/ai-model-hub',
        _rkwargs: true
      });
      const emoji = findEmoji(collection.config, manifest.type, noun);
      setGeneratedEmoji(emoji);

      const updatedManifest = {
        ...manifest,
        id: shortId,
        id_emoji: emoji,
        config: manifest.config ? {
          ...manifest.config,
          ...(manifest.config.bioimageio && {
            ...manifest.config,
            bioimageio: undefined
          })
        } : undefined
      };

      if (updatedManifest.config === undefined) {
        delete updatedManifest.config;
      }

      const updatedFiles = files.map(file => {
        if (file.path.endsWith('rdf.yaml')) {
          const updatedContent = yaml.dump(updatedManifest, {
            indent: 2,
            lineWidth: -1,
            noRefs: true,
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

      const updatedRdfFile = updatedFiles.find(file => file.path.endsWith('rdf.yaml'));
      if (!updatedRdfFile) {
        throw new Error('Failed to update rdf.yaml');
      }

      setUploadStatus({
        message: 'Uploading updated manifest...',
        severity: 'info',
        progress: 0
      });

      let rdfUploadPath = updatedRdfFile.path;
      if (rdfUploadPath.includes('/')) {
        rdfUploadPath = 'rdf.yaml';
      }

      const rdfPutUrl = await artifactManager.put_file({
        artifact_id: artifact.id,
        file_path: rdfUploadPath,
        _rkwargs: true,
      });

      await axios.put(rdfPutUrl, updatedRdfFile.content, {
        headers: {
          "Content-Type": ""
        }
      });

      await artifactManager.edit({
        artifact_id: fullId,
        manifest: updatedManifest,
        stage: true,
        _rkwargs: true
      });

      const remainingFiles = updatedFiles.filter(file => !file.path.endsWith('rdf.yaml'));
      for (let index = 0; index < remainingFiles.length; index++) {
        const file = remainingFiles[index];
        setUploadStatus({
          message: `Uploading ${file.name}...`,
          severity: 'info',
          progress: ((index + 1) / (remainingFiles.length + 1)) * 100
        });

        try {
          let content: string | ArrayBuffer | null = null;
          let fileSize = 0;
          let isLargeFile = false;
          let fileObject: File | null = null;
          
          if (file.handle) {
            const isBinary = !isKnownTextFile(file.name);
            content = await file.handle.async(isBinary ? 'arraybuffer' : 'string');
            fileSize = content instanceof ArrayBuffer ? content.byteLength : content.length;
          } else if (file.file) {
            fileObject = file.file;
            fileSize = fileObject.size;
            isLargeFile = fileSize > LARGE_FILE_THRESHOLD;
            
            if (!isLargeFile) {
              if (!file.loaded || !file.content) {
                content = await readFileContent(file.file);
              } else {
                content = file.content;
              }
            }
          } else if (file.content) {
            content = file.content;
            fileSize = content instanceof ArrayBuffer ? content.byteLength : content.length;
          }

          const isWeightFile = weightFilePaths.some((weightPath: string) => {
            const normalizedFilePath = file.path.startsWith('./') ? file.path.substring(2) : file.path;
            return normalizedFilePath === weightPath || 
                   normalizedFilePath.endsWith(`/${weightPath}`) ||
                   weightPath.endsWith(`/${normalizedFilePath}`);
          });
          
          let uploadPath = file.path;
          if (uploadPath.includes('/')) {
            uploadPath = file.name;
          }
          
          const putConfig: {
            artifact_id: any;
            file_path: string;
            download_weight?: number;
            _rkwargs: boolean;
          } = {
            artifact_id: artifact.id,
            file_path: uploadPath,
            _rkwargs: true,
          }
          if (isWeightFile) {
            putConfig.download_weight = 1;
          }
          const putUrl = await artifactManager.put_file(putConfig);

          if (isLargeFile && fileObject) {
            await uploadLargeFile(putUrl, fileObject, fileSize, (progress) => {
              setUploadStatus({
                message: `Uploading ${file.name}... (${Math.round(progress)}%)`,
                severity: 'info',
                progress: ((index + (progress / 100)) / remainingFiles.length) * 100
              });
            });
          } else if (content) {
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

      navigate(`/edit/${encodeURIComponent(artifact.id)}/stage`);

    } catch (error) {
      console.error('Upload failed:', error);
      setUploadStatus({
        message: error instanceof Error 
          ? `Upload failed: ${error.message}` 
          : 'Upload failed: Unknown error occurred',
        severity: 'error'
      });
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

      const nodes: FileNode[] = await Promise.all(fileList.map(async (fileInfo: any) => {
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

      const rdfFile = nodes.find(file => file.path.endsWith('rdf.yaml'));
      if (rdfFile) {
        handleFileSelect(rdfFile);
      }
    } catch (error) {
      console.error('Error loading artifact files:', error);
    }
  };

  const uploadLargeFile = async (
    url: string, 
    file: File, 
    fileSize: number,
    onProgress: (progress: number) => void
  ): Promise<void> => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url, true);
      xhr.setRequestHeader('Content-Type', '');
      
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percentComplete = (event.loaded / event.total) * 100;
          onProgress(percentComplete);
        }
      };
      
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
      
      xhr.send(file);
      
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

  const checkImageDimensions = (url: string, fileName: string) => {
    const img = new Image();
    img.onload = () => {
      setImageDimensions({ width: img.width, height: img.height });
    };
    img.src = url;
  };

  return (
    <div className="flex flex-col">
      {files.length > 0 && (
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
      )}
      
      {showDragDrop && (
        <div className="bg-white border-b border-gray-100">
          <div className="p-6 text-center">
            <h1 className="text-2xl font-bold text-gray-900">
              Contribution
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Upload and share your AI models with the research community.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {files.length > 0 && (
          <div className={`${
            isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } lg:translate-x-0 w-80 bg-[#f9fafb] border-r border-gray-200 flex flex-col 
          fixed lg:relative inset-y-0 
          transition-transform duration-300 ease-in-out 
          h-screen lg:h-[calc(100vh-64px)] z-40
          overflow-hidden`}>
            <div className="p-4 border-b border-gray-200 flex flex-col gap-2">
              {generatedId ? (
                <>
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-medium text-gray-900 truncate">
                      {files.find(f => f.path.endsWith('rdf.yaml'))?.content && 
                        (yaml.load(files.find(f => f.path.endsWith('rdf.yaml'))?.content as string) as RdfManifest)?.name || 'Untitled'}
                    </h2>
                    <span className="text-xs bg-blue-50 text-[#f39200] border border-[#f39200] px-2 py-1 rounded-full">
                      stage
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 font-mono flex items-center gap-1">
                    {generatedEmoji && (
                      <span className="w-5 h-5 flex items-center justify-center bg-gray-100 rounded-full text-sm">
                        {generatedEmoji}
                      </span>
                    )}
                    ID: <span className="bg-gray-100 px-2 py-0.5 rounded">{generatedId}</span>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">
                    Package Contents
                  </h2>
                </>
              )}
            </div>

            <div className="flex-1 overflow-y-auto min-h-[calc(100vh-200px)]">
              <div className="py-2 h-full">
                {files.map((file) => (
                  <div
                    key={file.path}
                    onClick={() => handleFileSelect(file)}
                    className={`cursor-pointer px-4 py-2.5 hover:bg-gray-100 transition-colors flex items-center gap-3 border-l-2
                      ${selectedFile?.path === file.path ? 'bg-white border-[#f39200] text-gray-900' : 'border-transparent text-gray-600'}`}
                  >
                     <span className="flex-shrink-0">
                      {file.name.endsWith('.yaml') || file.name.endsWith('.yml') ? (
                        <span className="text-xs font-mono font-bold text-gray-400">YML</span>
                      ) : file.name.match(/\.(png|jpg|jpeg|gif)$/i) ? (
                         <span className="text-xs font-mono font-bold text-gray-400">IMG</span>
                      ) : (
                         <span className="text-xs font-mono font-bold text-gray-400">FILE</span>
                      )}
                    </span>

                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="truncate text-sm font-medium">
                        {file.name}
                      </span>
                      {file.name === 'rdf.yaml' && (
                         <span className="text-[#f39200] text-xs">★</span>
                      )}
                    </div>

                    {file.edited && (
                      <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full uppercase tracking-wider font-medium">
                        edited
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="w-full flex flex-col overflow-hidden min-h-screen">
          {files.length > 0 && (
            <div className="border-b border-gray-200 bg-white sticky top-0 z-50">
              <div className="p-2">
                <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                  <div className="flex-grow min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {uploadStatus && (
                        <>
                          <span className="text-gray-400">•</span>
                          <span className={`${getStatusColor(uploadStatus.severity)} text-sm font-medium truncate`}>
                            {uploadStatus.message}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 flex-shrink-0">
                    {!uploadedArtifact && (
                      <button
                        onClick={handleUpload}
                        disabled={isUploading || !isLoggedIn || !isValidated}
                        className={`px-4 py-2 rounded-md font-bold text-sm transition-colors whitespace-nowrap flex items-center gap-2
                          ${isUploading || !isLoggedIn || !isValidated
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-[#f39200] text-white hover:bg-[#d98200]'}`}
                      >
                         {!isLoggedIn 
                            ? 'Login to Upload'
                            : isUploading 
                              ? 'Uploading...' 
                              : 'Upload Package'}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {uploadStatus?.progress !== undefined && (
                <div className="mt-2">
                  <LinearProgress 
                    variant="determinate" 
                    value={uploadStatus.progress} 
                    sx={{ 
                      height: 2,
                      borderRadius: 0,
                      backgroundColor: '#f3f4f6',
                      '& .MuiLinearProgress-bar': {
                        backgroundColor: '#f39200'
                      }
                    }}
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex-1 overflow-auto min-h-[calc(100vh-145px)] bg-white">
            {showingTos ? (
              <div className="relative p-6">
                <div className="mb-8 border-b border-gray-200 pb-6">
                    <h2 className="text-xl font-bold text-gray-900 mb-2">Terms of Service Agreement</h2>
                    <p className="text-gray-500">Please review and accept the terms to proceed with your upload.</p>
                </div>
                
                <div className="max-w-4xl mx-auto">
                    <TermsOfService />
                    
                    <div className="flex justify-end gap-4 mt-8 pt-6 border-t border-gray-200 sticky bottom-0 bg-white p-4">
                        <button
                            onClick={() => setShowingTos(false)}
                            className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 font-medium hover:bg-gray-50 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleAgreeAndUpload}
                            className="px-6 py-2 bg-[#f39200] text-white rounded-md font-bold hover:bg-[#d98200] transition-colors shadow-sm"
                        >
                            I Agree & Continue Upload
                        </button>
                    </div>
                </div>
              </div>
            ) : showDragDrop ? (
              <div className="h-full flex items-center justify-center p-8">
                <div className="mt-10 text-center max-w-2xl mx-auto w-full">
                  {uploadStatus?.message && uploadStatus.severity === 'info' && uploadStatus.progress !== undefined ? (
                    <div className="flex flex-col items-center justify-center mb-8">
                       <div className="animate-spin rounded-full h-10 w-10 border-2 border-gray-100 border-t-[#f39200] mb-4"></div>
                      <div className="text-lg font-medium text-gray-900 mb-2">{uploadStatus.message}</div>
                      <div className="w-64 bg-gray-100 rounded-full h-1.5 mt-2">
                        <div 
                          className="bg-[#f39200] h-1.5 rounded-full transition-all duration-300" 
                          style={{ width: `${uploadStatus.progress}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div 
                      {...getRootProps()} 
                      onClick={handleFileButtonClick}
                      className="border-2 border-dashed border-gray-300 rounded-xl p-16 hover:bg-gray-50 hover:border-[#f39200] transition-all cursor-pointer mb-8 group"
                    >
                      <input {...fileInputProps} ref={fileInputRef} />
                      <input {...customInputProps} ref={folderInputRef} style={{ display: 'none' }} />
                      
                      <div className="mb-6">
                        <div className="w-16 h-16 mx-auto mb-4 text-gray-300 group-hover:text-[#f39200] transition-colors">
                          <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                        </div>
                        {isDragActive ? (
                          <p className="text-xl text-[#f39200] font-bold">Drop your files here...</p>
                        ) : (
                          <>
                            <p className="text-xl text-gray-900 font-bold mb-2">
                              Drag & drop your model package content here
                            </p>
                            <p className="text-gray-500">or click to select files</p>
                          </>
                        )}
                      </div>
                      <div className="text-left text-sm text-gray-600 bg-gray-50 p-4 rounded-lg border border-gray-200 mt-8">
                        <div className="flex flex-col sm:flex-row justify-center gap-3 mt-2">
                          <button
                            type="button"
                            onClick={handleFolderButtonClick}
                            className="px-4 py-2 bg-white border border-gray-300 rounded-md text-gray-700 font-medium hover:border-[#f39200] hover:text-[#f39200] transition-colors"
                          >
                             Select Folder (Recommended)
                          </button>
                          <button
                            type="button"
                            onClick={handleZipButtonClick}
                            className="px-4 py-2 bg-white border border-gray-300 rounded-md text-gray-700 font-medium hover:border-[#f39200] hover:text-[#f39200] transition-colors"
                          >
                             Select Zip File
                          </button>
                        </div>
                        <p className="mt-4 text-center text-xs text-gray-400">For large models (&gt;3GB), please upload a folder or individual files instead of ZIP.</p>
                      </div>
                    </div>
                  )}

                  {isLoggedIn && (
                    <Link
                      to="/my-artifacts"
                      className="inline-flex items-center gap-2 text-gray-500 hover:text-[#f39200] transition-colors font-medium text-sm"
                    >
                      View My Artifacts →
                    </Link>
                  )}
                </div>
              </div>
            ) : selectedFile ? (
              <div className="h-full min-h-[calc(80vh-145px)]">
                {isImageFile(selectedFile.name) ? (
                  <div className="flex flex-col items-center justify-center p-8 bg-gray-50 h-full">
                    <div className="relative w-full max-w-4xl bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                      <div className="absolute top-4 right-4 bg-black/80 text-white px-3 py-1 rounded text-xs font-mono z-10">
                        {selectedFile.name.split('.').pop()?.toUpperCase()} • {imageDimensions ? `${imageDimensions.width}×${imageDimensions.height}` : '...'} • {formatFileSize(selectedFile.size)}
                      </div>
                      
                      <div 
                        className="relative aspect-video flex items-center justify-center p-4 bg-gray-50"
                        style={{ backgroundImage: `url(${gridBg})` }}
                      >
                        {imageUrl ? (
                          <img 
                            src={imageUrl}
                            alt={selectedFile.name}
                            className="max-w-full max-h-[70vh] h-auto object-contain shadow-sm"
                            onLoad={() => checkImageDimensions(imageUrl!, selectedFile.name)}
                          />
                        ) : (
                           <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-[#f39200]"></div>
                        )}
                      </div>
                      
                      <div className="px-4 py-3 bg-white border-t border-gray-100">
                        <p className="text-sm font-mono text-gray-600 truncate">
                          {selectedFile.name}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : selectedFile.name.endsWith('rdf.yaml') ? (
                  <RDFEditor
                    content={typeof selectedFile.content === 'string' ? selectedFile.content : ''}
                    onChange={(value) => handleEditorChange(value, selectedFile)}
                    readOnly={false}
                    showModeSwitch={true}
                  />
                ) : isTextFile(selectedFile.name) ? (
                  <div className="flex flex-col gap-4 h-full">
                    <Editor
                      height="100%"
                      language={getEditorLanguage(selectedFile.name)}
                      value={typeof selectedFile.content === 'string' ? selectedFile.content : ''}
                      onChange={(value) => handleEditorChange(value, selectedFile)}
                      options={{
                        minimap: { enabled: false },
                        scrollBeyondLastLine: true,
                        wordWrap: 'on',
                        lineNumbers: 'on',
                        renderWhitespace: 'selection',
                        folding: true,
                        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
                        fontSize: 14,
                      }}
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-4 bg-gray-50">
                    <div className="bg-white p-8 rounded-lg border border-gray-200 shadow-sm text-center">
                      <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <span className="text-gray-400 font-bold text-xl">?</span>
                      </div>
                      <h3 className="font-medium text-gray-900 mb-2">Binary File</h3>
                      <p className="text-sm text-gray-500 mb-4">{selectedFile.name}</p>
                      <span className="inline-block px-3 py-1 bg-gray-100 rounded-full text-xs font-mono text-gray-600">
                        {formatFileSize(selectedFile.size)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400 bg-gray-50">
                <div className="text-center">
                   <p>Select a file from the sidebar to view or edit</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {isSidebarOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-30"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
    </div>
  );
};

export default Upload;