import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import JSZip from 'jszip';
import Editor from '@monaco-editor/react';
import { useHyphaStore } from '../store/hyphaStore';
import axios from 'axios';
import { Snackbar, LinearProgress, Alert, Slider } from '@mui/material';
import yaml from 'js-yaml';

interface FileNode {
  name: string;
  path: string;
  content: string | ArrayBuffer;
  isDirectory: boolean;
  children?: FileNode[];
  edited?: boolean;
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

type SupportedTextFiles = '.txt' | '.yml' | '.yaml' | '.json' | '.md' | '.py' | '.js' | '.ts' | '.jsx' | '.tsx' | '.css' | '.html';
type SupportedImageFiles = '.png' | '.jpg' | '.jpeg' | '.gif';

const Upload: React.FC = () => {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const { artifactManager, isLoggedIn } = useHyphaStore();
  const [uploadStatus, setUploadStatus] = useState<UploadStatus | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [showDragDrop, setShowDragDrop] = useState(!files.length);

  const isTextFile = (filename: string): boolean => {
    const textExtensions: SupportedTextFiles[] = ['.txt', '.yml', '.yaml', '.json', '.md', '.py', '.js', '.ts', '.jsx', '.tsx', '.css', '.html'];
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

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const zipFile = acceptedFiles[0];
    const zip = new JSZip();
    
    try {
      const loadedZip = await zip.loadAsync(zipFile);
      const fileNodes: FileNode[] = [];

      for (const [path, file] of Object.entries(loadedZip.files)) {
        if (!file.dir) {
          const pathParts = path.split('/');
          const fileName = pathParts[pathParts.length - 1];
          
          const isImage = fileName.match(/\.(png|jpg|jpeg|gif)$/i);
          const content = await file.async(isImage ? 'arraybuffer' : 'string');

          fileNodes.push({
            name: fileName,
            path: path,
            content: content,
            isDirectory: false
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
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: {
      'application/zip': ['.zip']
    }
  });

  const handleFileSelect = async (file: FileNode) => {
    setSelectedFile(file);
    setImageUrl(null);
    
    if (isImageFile(file.name)) {
      try {
        const url = await getImageDataUrl(file.content, file.name);
        setImageUrl(url);
      } catch (error) {
        console.error('Error generating image URL:', error);
      }
    }
  };

  const handleEditorChange = (value: string | undefined, file: FileNode) => {
    if (value) {
      setFiles(files.map(f => 
        f.path === file.path 
          ? { ...f, content: value, edited: true }
          : f
      ));
    }
  };

  const handleUpload = async () => {
    if (!artifactManager) {
      setUploadStatus({
        message: 'Artifact manager not connected',
        severity: 'error'
      });
      return;
    }

    try {
      setUploadStatus({
        message: 'Reading manifest file...',
        severity: 'info'
      });

      const rdfFile = files.find(file => file.path.endsWith('rdf.yaml'));
      if (!rdfFile) {
        throw new Error('No rdf.yaml file found in the upload');
      }

      let manifest: Manifest;
      try {
        const content = typeof rdfFile.content === 'string' 
          ? rdfFile.content
          : new TextDecoder().decode(rdfFile.content);
        manifest = yaml.load(content) as Manifest;
        if (manifest?.version) {
          manifest.version = `${manifest.version}`;
        }
      } catch (error) {
        console.error('Error parsing rdf.yaml:', error);
        throw new Error('Invalid rdf.yaml format');
      }

      setUploadStatus({
        message: 'Creating artifact...',
        severity: 'info'
      });

      

      const artifact = await artifactManager.create({
        parent_id: "bioimage-io/bioimage.io",
        alias: "{zenodo_conceptrecid}",
        manifest: manifest,
        config: {
          publish_to: "sandbox_zenodo"
        },
        version: "stage",
        _rkwargs: true,
        overwrite: true,
      });
      console.log(`Artifact created: ${artifact.id}`);

      // Upload files sequentially with progress
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        setUploadStatus({
          message: `Uploading ${file.name}...`,
          severity: 'info',
          progress: (index / files.length) * 100
        });

        const putUrl = await artifactManager.put_file({
          artifact_id: artifact.id,
          file_path: file.path,
          _rkwargs: true,
        });

        const blob = new Blob([file.content], { type: 'text/plain' });
        await axios.put(putUrl, blob, {
          onUploadProgress: (progressEvent) => {
            const progress = progressEvent.total
              ? (progressEvent.loaded / progressEvent.total) * 100
              : 0;
            
            setUploadStatus({
              message: `Uploading ${file.name}...`,
              severity: 'info',
              progress: ((index + (progress / 100)) / files.length) * 100
            });
          }
        });
      }

      setUploadStatus({
        message: 'Upload complete!',
        severity: 'success'
      });
    } catch (error) {
      console.error('Upload failed:', error);
      setUploadStatus({
        message: error instanceof Error 
          ? `Upload failed: ${error.message}` 
          : 'Upload failed: Unknown error occurred',
        severity: 'error'
      });
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

  return (
    <div className="flex flex-col h-screen">
      <div className="flex flex-1 overflow-auto">
        {/* Left sidebar - File tree */}
        <div className="w-80 bg-gray-50 border-r border-gray-200 flex flex-col h-full">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <span className="text-sm text-gray-600 font-medium">Files</span>
            {files.length > 0 && (
              <button
                onClick={() => setShowDragDrop(true)}
                className="text-sm text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50"
              >
                Upload New
              </button>
            )}
          </div>

          {/* Scrollable file list */}
          <div className="flex-1 overflow-y-auto">
            <div className="py-2">
              {files.map((file) => (
                <div
                  key={file.path}
                  onClick={() => handleFileSelect(file)}
                  className={`cursor-pointer px-4 py-2 hover:bg-gray-100 transition-colors flex items-center gap-2
                    ${selectedFile?.path === file.path ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}
                    ${file.edited ? 'font-medium' : ''}`}
                >
                  <span className="truncate flex-1">{file.name}</span>
                  {file.edited && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                      edited
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main content area */}
        <div className="flex-1 flex flex-col">
          {/* Status bar with upload button and progress */}
          <div className="border-b border-gray-200 bg-white p-4 flex justify-between items-center">
            <div className="flex flex-col flex-grow mr-4">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-500">
                  {files.length > 0 ? `${files.length} files loaded` : 'No files loaded'}
                </span>
                {uploadStatus && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className={getStatusColor(uploadStatus.severity)}>
                      {uploadStatus.message}
                    </span>
                  </>
                )}
              </div>
              {uploadStatus?.progress !== undefined && (
                <LinearProgress 
                  variant="determinate" 
                  value={uploadStatus.progress} 
                  sx={{ mt: 1, height: 4, borderRadius: 2 }}
                />
              )}
            </div>
            <button
              onClick={handleUpload}
              disabled={uploadStatus?.severity === 'info' || files.length === 0 || !isLoggedIn}
              className={`px-6 py-2 rounded-md font-medium transition-colors whitespace-nowrap
                ${files.length === 0 || uploadStatus?.severity === 'info' || !isLoggedIn
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'}`}
            >
              {!isLoggedIn 
                ? 'Please login to upload'
                : uploadStatus?.severity === 'info' 
                  ? 'Uploading...' 
                  : 'Upload to Hypha'}
            </button>
          </div>

          {/* Content area */}
          <div className="flex-1 p-6 overflow-auto">
            {showDragDrop ? (
              <div className="h-full flex items-center justify-center">
                <div 
                  {...getRootProps()} 
                  className="border-2 border-dashed border-gray-300 rounded-lg p-12 hover:bg-gray-50 transition-colors cursor-pointer text-center max-w-xl w-full mx-auto"
                >
                  <input {...getInputProps()} />
                  {isDragActive ? (
                    <p className="text-gray-600">Drop the zip file here...</p>
                  ) : (
                    <div>
                      <p className="text-gray-600 mb-2">Drag & drop a zip file here,</p>
                      <p className="text-gray-500">or click to select one</p>
                    </div>
                  )}
                </div>
              </div>
            ) : selectedFile ? (
              <div className="h-full">
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
                ) : isTextFile(selectedFile.name) ? (
                  <div className="flex flex-col gap-4">
                    <Editor
                      height="70vh"
                      language={getEditorLanguage(selectedFile.name)}
                      value={typeof selectedFile.content === 'string' ? selectedFile.content : ''}
                      onChange={(value) => handleEditorChange(value, selectedFile)}
                      options={{
                        minimap: { enabled: false },
                        scrollBeyondLastLine: true,
                        readOnly: !isTextFile(selectedFile.name),
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
                        <p><span className="font-medium">Size:</span> {formatFileSize(selectedFile.content instanceof ArrayBuffer ? selectedFile.content.byteLength : selectedFile.content.length)}</p>
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
    </div>
  );
};

export default Upload; 