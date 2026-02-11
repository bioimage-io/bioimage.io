import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Chip,
  CircularProgress,
  Alert,
  Card,
  CardContent,
  IconButton,
  Collapse,
  Stack,
  Button,
} from '@mui/material';
import {
  Folder as FolderIcon,
  Description as FileIcon,
  Download as DownloadIcon,
  Image as ImageIcon,
  DataObject as DataIcon,
  Code as CodeIcon,
  Archive as ArchiveIcon,
  Assignment as AssignmentIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
} from '@mui/icons-material';

interface FileInfo {
  type: string;
  name: string;
  size: number;
  last_modified: number;
}

interface ArtifactFilesProps {
  artifactId: string;
  baseUrl?: string;
  workspace?: string;
  artifactInfo?: any; // For checking weight files
  version?: string; // Add version prop for download all functionality
}

const ArtifactFiles: React.FC<ArtifactFilesProps> = ({
  artifactId,
  baseUrl = 'https://hypha.aicell.io',
  workspace = 'ri-scale',
  artifactInfo,
  version
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alias = artifactId.split('/').pop();

  const fetchFiles = async () => {
    if (!alias) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const filesUrl = `${baseUrl}/${workspace}/artifacts/${alias}/files/`;
      const response = await fetch(filesUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch files: ${response.statusText}`);
      }
      
      const filesData = await response.json();
      setFiles(filesData);
    } catch (err) {
      console.error('Error fetching files:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch files');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isExpanded && files.length === 0) {
      fetchFiles();
    }
  }, [isExpanded]);

  const handleToggle = () => {
    setIsExpanded(!isExpanded);
  };

  const handleDownloadAll = () => {
    if (!alias) return;
    let downloadUrl = `${baseUrl}/${workspace}/artifacts/${alias}/create-zip-file`;
    if (version && version !== 'latest') {
      downloadUrl += `?version=${version}`;
    }
    window.open(downloadUrl, '_blank');
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatTimestamp = (timestamp: number): string => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getFileIcon = (fileName: string) => {
    const extension = fileName.toLowerCase().split('.').pop();
    
    switch (extension) {
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'bmp':
      case 'tiff':
        return <ImageIcon sx={{ color: '#10b981', fontSize: 20, flexShrink: 0 }} />;
      case 'py':
      case 'js':
      case 'ts':
      case 'html':
      case 'css':
      case 'json':
        return <CodeIcon sx={{ color: '#3b82f6', fontSize: 20, flexShrink: 0 }} />;
      case 'yaml':
      case 'yml':
        return <AssignmentIcon sx={{ color: '#f59e0b', fontSize: 20, flexShrink: 0 }} />;
      case 'npy':
      case 'npz':
      case 'h5':
      case 'hdf5':
      case 'mat':
      case 'pth':
      case 'pt':
        return <DataIcon sx={{ color: '#8b5cf6', fontSize: 20, flexShrink: 0 }} />;
      case 'zip':
      case 'tar':
      case 'gz':
      case 'rar':
        return <ArchiveIcon sx={{ color: '#f59e0b', fontSize: 20, flexShrink: 0 }} />;
      default:
        return <FileIcon sx={{ color: '#6b7280', fontSize: 20, flexShrink: 0 }} />;
    }
  };

  const isWeightFile = (fileName: string): boolean => {
    if (!artifactInfo) return false;
    
    // Check in config.download_weights for published versions
    if (artifactInfo.config?.download_weights && artifactInfo.config.download_weights[fileName] > 0) {
      return true;
    }
    
    // Check in staging array for staged files
    if (artifactInfo.staging && artifactInfo.staging.some(
      (item: {path: string; download_weight: number}) => 
        item.path === fileName && item.download_weight > 0
    )) {
      return true;
    }
    
    return false;
  };

  const handleDownload = (fileName: string) => {
    if (!alias) return;
    const downloadUrl = `${baseUrl}/${workspace}/artifacts/${alias}/files/${fileName}`;
    window.open(downloadUrl, '_blank');
  };

  // Load files when expanded for the first time
  useEffect(() => {
    if (isExpanded && files.length === 0) {
      fetchFiles();
    }
  }, [isExpanded]);

  return (
    <Card 
      sx={{ 
        mb: { xs: 1, sm: 2, md: 3 },
        backgroundColor: 'rgba(255, 255, 255, 0.8)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255, 255, 255, 0.5)',
        borderRadius: { xs: '8px', sm: '12px', md: '16px' },
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)',
      }}
    >
      <CardContent sx={{ p: { xs: 1, sm: 1.5, md: 2 } }}>
        <Box 
          sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            cursor: 'pointer',
            mb: isExpanded ? 2 : 0
          }}
          onClick={handleToggle}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 300, color: '#1f2937' }}>
              <FolderIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
              Files
            </Typography>
            {files.length > 0 && (
              <Chip
                label={files.length}
                size="small"
                sx={{
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  color: '#3b82f6',
                  borderRadius: '8px',
                  fontWeight: 500,
                  fontSize: '0.75rem',
                  border: '1px solid rgba(59, 130, 246, 0.2)',
                }}
              />
            )}
            {files.length > 0 && (
              <Chip
                icon={<ArchiveIcon sx={{ fontSize: '14px !important' }} />}
                label="zip"
                size="small"
                onClick={(e) => {
                  e.stopPropagation(); // Prevent the toggle from being triggered
                  handleDownloadAll();
                }}
                sx={{
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  color: '#3b82f6',
                  borderRadius: '8px',
                  fontWeight: 500,
                  fontSize: '0.75rem',
                  border: '1px solid rgba(59, 130, 246, 0.2)',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                    borderColor: 'rgba(59, 130, 246, 0.3)',
                    transform: 'scale(1.05)',
                  },
                  '& .MuiChip-icon': {
                    color: '#3b82f6',
                    marginLeft: '4px',
                  },
                }}
              />
            )}
          </Box>
          <IconButton
            size="small"
            sx={{
              backgroundColor: 'rgba(255, 255, 255, 0.7)',
              backdropFilter: 'blur(4px)',
              border: '1px solid rgba(255, 255, 255, 0.5)',
              borderRadius: '12px',
              transition: 'all 0.3s ease',
              '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                borderColor: 'rgba(59, 130, 246, 0.3)',
                transform: 'scale(1.05)',
              }
            }}
          >
            {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </Box>

        <Collapse in={isExpanded}>
          <Box>
            {isLoading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                <CircularProgress size={24} />
              </Box>
            )}

            {error && (
              <Alert 
                severity="error" 
                sx={{ 
                  mb: 2,
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: '12px',
                }}
              >
                {error}
              </Alert>
            )}

            {!isLoading && !error && files.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                No files found
              </Typography>
            )}

            {!isLoading && !error && files.length > 0 && (
              <Stack 
                spacing={1}
                sx={{
                  maxHeight: '420px', // Approximately 7 files (60px per file)
                  overflowY: 'auto',
                  '&::-webkit-scrollbar': {
                    width: '6px',
                  },
                  '&::-webkit-scrollbar-track': {
                    backgroundColor: 'rgba(255, 255, 255, 0.3)',
                    borderRadius: '3px',
                  },
                  '&::-webkit-scrollbar-thumb': {
                    backgroundColor: 'rgba(59, 130, 246, 0.3)',
                    borderRadius: '3px',
                    '&:hover': {
                      backgroundColor: 'rgba(59, 130, 246, 0.5)',
                    },
                  },
                }}
              >
                {files.map((file, index) => (
                  <Box 
                    key={index}
                    onClick={() => handleDownload(file.name)}
                    sx={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 1.5,
                      p: 1.5,
                      backgroundColor: 'rgba(255, 255, 255, 0.6)',
                      backdropFilter: 'blur(4px)',
                      border: '1px solid rgba(255, 255, 255, 0.7)',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      '&:hover': {
                        backgroundColor: 'rgba(255, 255, 255, 0.8)',
                        borderColor: 'rgba(59, 130, 246, 0.3)',
                        transform: 'translateY(-2px)',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                      }
                    }}
                  >
                    {getFileIcon(file.name)}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography 
                        variant="body2" 
                        sx={{ 
                          fontWeight: 500, 
                          color: '#1f2937',
                          lineHeight: 1.2,
                          wordBreak: 'break-word',
                          mb: 0.5
                        }}
                      >
                        {file.name}
                      </Typography>
                      <Typography 
                        variant="caption" 
                        sx={{ 
                          color: '#6b7280',
                          fontSize: '0.75rem',
                          display: 'block'
                        }}
                      >
                        {formatFileSize(file.size)} • {formatTimestamp(file.last_modified)}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {isWeightFile(file.name) && (
                        <Chip
                          label="weight"
                          size="small"
                          sx={{
                            backgroundColor: 'rgba(34, 197, 94, 0.1)',
                            color: '#22c55e',
                            borderRadius: '8px',
                            fontWeight: 500,
                            fontSize: '0.625rem',
                            height: '18px',
                            border: '1px solid rgba(34, 197, 94, 0.2)',
                            textTransform: 'uppercase',
                            flexShrink: 0
                          }}
                        />
                      )}
                      <DownloadIcon 
                        sx={{ 
                          color: '#3b82f6', 
                          fontSize: 18,
                          flexShrink: 0
                        }} 
                      />
                    </Box>
                  </Box>
                ))}
              </Stack>
            )}
          </Box>
        </Collapse>
      </CardContent>
    </Card>
  );
};

export default ArtifactFiles; 