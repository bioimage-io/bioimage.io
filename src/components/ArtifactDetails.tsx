import { useEffect, useState, useRef } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import { useHyphaStore } from '../store/hyphaStore';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button, Box, Typography, Chip, Grid, Card, CardContent, Avatar, Link, Stack, Divider, IconButton, CircularProgress, Alert } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import SchoolIcon from '@mui/icons-material/School';
import LinkIcon from '@mui/icons-material/Link';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import DownloadIcon from '@mui/icons-material/Download';
import VisibilityIcon from '@mui/icons-material/Visibility';
import UpdateIcon from '@mui/icons-material/Update';
import BarChartIcon from '@mui/icons-material/BarChart';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import GavelIcon from '@mui/icons-material/Gavel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import ModelTester from './ModelTester';
import ModelRunner from './ModelRunner';
import { resolveHyphaUrl } from '../utils/urlHelpers';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import { ArtifactInfo, TestReport, DetailedTestReport } from '../types/artifact';
import CodeIcon from '@mui/icons-material/Code';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import CloseIcon from '@mui/icons-material/Close';
import Editor from '@monaco-editor/react';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import TestReportBadge from './TestReportBadge';
import TestReportDialog from './TestReportDialog';
import ArtifactFiles from './ArtifactFiles';

const ArtifactDetails = () => {
  const { id, version } = useParams<{ id: string; version?: string }>();
  const { selectedResource, fetchResource, isLoading, error } = useHyphaStore();
  const [documentation, setDocumentation] = useState<string | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [latestVersion, setLatestVersion] = useState<{
    version: string;
    comment: string;
    created_at: number;
  } | null>(null);
  const [rdfContent, setRdfContent] = useState<string | null>(null);
  const [isRdfDialogOpen, setIsRdfDialogOpen] = useState(false);
  const [showCopied, setShowCopied] = useState(false);
  const [showModelRunner, setShowModelRunner] = useState(false);
  const [currentContainerId, setCurrentContainerId] = useState<string | null>(null);
  const [containerHeight, setContainerHeight] = useState('400px');
  const [showDownloadInfo, setShowDownloadInfo] = useState(false);
  const [isTestReportDialogOpen, setIsTestReportDialogOpen] = useState(false);
  const [detailedTestReport, setDetailedTestReport] = useState<DetailedTestReport | null>(null);
  const [isLoadingTestReport, setIsLoadingTestReport] = useState(false);
  const [rawErrorContent, setRawErrorContent] = useState<string | null>(null);
  const [isInvalidJson, setIsInvalidJson] = useState(false);
  const modelContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (id) {
      fetchResource(`bioimage-io/${id}`, version);
    }
  }, [id, fetchResource, version]);

  useEffect(() => {
    const fetchDocumentation = async () => {
      if (selectedResource?.manifest.documentation) {
        try {
          const docUrl = resolveHyphaUrl(selectedResource.manifest.documentation, selectedResource.id, true);
          
          const response = await fetch(docUrl);
          const text = await response.text();
          setDocumentation(text);
        } catch (error) {
          console.error('Failed to fetch documentation:', error);
          setDocumentation("Failed to fetch documentation.");
        }
      }
      else {
        // No documentation found
        setDocumentation("No documentation found.");
      }
    };

    fetchDocumentation();
  }, [selectedResource?.id, selectedResource?.manifest.documentation]);

  useEffect(() => {
    if (selectedResource?.versions?.length) {
      setLatestVersion(selectedResource.versions[selectedResource.versions.length - 1]);
    }
  }, [selectedResource?.versions]);

  // Validation function to check if parsed JSON is a valid test report
  const isValidTestReport = (data: any): data is DetailedTestReport => {
    return (
      data &&
      typeof data === 'object' &&
      typeof data.name === 'string' &&
      typeof data.status === 'string' &&
      typeof data.source_name === 'string' &&
      typeof data.type === 'string' &&
      typeof data.format_version === 'string' &&
      typeof data.id === 'string' &&
      Array.isArray(data.details)
    );
  };

  const fetchDetailedTestReport = async () => {
    if (selectedResource?.id) {
      try {
        setIsLoadingTestReport(true);
        setIsInvalidJson(false);
        setRawErrorContent(null);
        setDetailedTestReport(null);
        
        const testReportUrl = resolveHyphaUrl('test_reports.json', selectedResource.id);
        const response = await fetch(testReportUrl);
        const responseText = await response.text();
        
        try {
          const testReportData = JSON.parse(responseText);
          console.log('Parsed test report data:', testReportData);
          
          // Validate that the parsed data has the expected structure
          if (isValidTestReport(testReportData)) {
            console.log('Valid test report structure detected');
            setDetailedTestReport(testReportData);
            setIsInvalidJson(false);
          } else {
            console.log('Invalid test report structure detected, showing raw content');
            console.error('Invalid test report structure:', testReportData);
            setRawErrorContent(responseText);
            setIsInvalidJson(true);
          }
        } catch (jsonError) {
          console.error('Invalid JSON response:', jsonError);
          setRawErrorContent(responseText);
          setIsInvalidJson(true);
        }
        
        setIsTestReportDialogOpen(true);
      } catch (error) {
        console.error('Failed to fetch detailed test report:', error);
        setRawErrorContent('Failed to fetch test report data.');
        setIsInvalidJson(true);
        setIsTestReportDialogOpen(true);
      } finally {
        setIsLoadingTestReport(false);
      }
    }
  };

  const handleDownload = () => {
    const artifactId = selectedResource?.id.split('/').pop();
    if (artifactId) {
      let downloadUrl = `https://hypha.aicell.io/bioimage-io/artifacts/${artifactId}/create-zip-file`;
      if (version && version !== 'latest') {
        downloadUrl += `?version=${version}`;
      }
      window.open(downloadUrl, '_blank');
    }
  };

  const nextImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedResource?.manifest.covers?.length) {
      setCurrentImageIndex((prev) => (prev + 1) % selectedResource.manifest.covers!.length);
    }
  };

  const previousImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedResource?.manifest.covers?.length) {
      setCurrentImageIndex((prev) => 
        (prev - 1 + selectedResource.manifest.covers!.length) % selectedResource.manifest.covers!.length
      );
    }
  };

  const handleViewSource = async () => {
    if (selectedResource?.id) {
      try {
        const rdfUrl = resolveHyphaUrl('rdf.yaml', selectedResource.id);
        const response = await fetch(rdfUrl);
        const text = await response.text();
        setRdfContent(text);
        setIsRdfDialogOpen(true);
      } catch (error) {
        console.error('Failed to fetch RDF source:', error);
      }
    }
  };

  // Add this function to format timestamps
  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleCopyId = () => {
    const id = selectedResource?.id.split('/').pop() || '';
    navigator.clipboard.writeText(id);
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  };

  const handleToggleModelRunner = () => {
    setShowModelRunner(!showModelRunner);
    // Reset container height when toggling off
    if (showModelRunner) {
      setContainerHeight('400px');
    }
  };

  // Callback function to create and prepare a container for the model runner
  const createModelRunnerContainer = (containerId: string): string => {
    // Set the current container ID
    setCurrentContainerId(containerId);
    
    // Set model runner to visible
    setShowModelRunner(true);
    
    // Increase the container height for better model visualization
    setContainerHeight('600px');
    
    // Return the container ID (this will be used by ModelRunner)
    return containerId;
  };

  // New function to handle model runner initialization
  const handleRunModel = () => {
    setShowModelRunner(true);
    setContainerHeight('600px');
    // The ModelRunner will automatically call setupRunner when it mounts
  };

  // New function to handle closing the model runner
  const handleCloseModelRunner = () => {
    setShowModelRunner(false);
    setContainerHeight('400px');
    setCurrentContainerId(null);
  };

  // Add this overlay spinner component
  const LoadingOverlay = () => (
    <div className="fixed inset-0 bg-black/10 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white/80 backdrop-blur-lg rounded-xl p-8 flex flex-col items-center shadow-lg border border-white/50">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-gray-300 border-t-blue-600 mb-4"></div>
        <div className="text-lg font-medium text-gray-700">Loading Artifact Details...</div>
        <div className="text-sm text-gray-500 mt-1">Please wait while we fetch the data</div>
      </div>
    </div>
  );

  if (isLoading) {
    return <LoadingOverlay />;
  }

  if (error) {
    return <div className="error">Error: {error}</div>;
  }

  if (!selectedResource) {
    return <div>Artifact not found</div>;
  }
  
  const { manifest } = selectedResource as ArtifactInfo;

    return (
    <div className="container-safe">
      <div className="max-w-[1400px] mx-auto px-2 sm:px-4 md:px-4 lg:px-4">
        <Box sx={{ p: { xs: 1, sm: 1, md: 2 }, maxWidth: '100%', width: '100%' }}>
      {/* Header Section */}
      <Box 
        sx={{ 
          mb: { xs: 1, sm: 2, md: 4 }, 
          p: { xs: 1, sm: 2, md: 4 },
          backgroundColor: 'rgba(255, 255, 255, 0.8)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.5)',
          borderRadius: { xs: '8px', sm: '12px', md: '16px' },
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)',
        }}
      >
        <Typography variant="h4" gutterBottom sx={{ fontWeight: 300, color: '#1f2937' }}>
        {manifest.id_emoji} {manifest.name} 
        </Typography>
        <Typography variant="subtitle1" color="text.secondary" gutterBottom className="flex items-center gap-2">
          <span>ID: </span>
          <code className="bg-white/70 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-white/50 select-all font-mono text-sm">
            {selectedResource.id.split('/').pop()}
          </code>
          <div className="flex items-center gap-2">
            <IconButton
              onClick={handleCopyId}
              size="small"
              title="Copy ID"
              sx={{ 
                padding: '8px',
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
              <ContentCopyIcon sx={{ fontSize: 16 }} />
            </IconButton>
            {showCopied && (
              <span className="text-green-600 text-sm font-medium animate-fade-in">
                Copied!
              </span>
            )}
          </div>
        </Typography>
        <Typography variant="body1" sx={{ mb: { xs: 1, sm: 2, md: 3 }, color: '#4b5563', lineHeight: 1.6 }}>{manifest.description}</Typography>
        
        {/* Main Action Buttons Row */}
        <Box sx={{ display: 'flex', gap: { xs: 1, sm: 2 }, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', gap: { xs: 1, sm: 2 }, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button
              onClick={handleDownload}
              startIcon={<DownloadIcon />}
              variant="contained"
              size="medium"
              sx={{
                background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
                borderRadius: '12px',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(59, 130, 246, 0.2)',
                color: 'white',
                fontWeight: 500,
                px: 3,
                py: 1.5,
                transition: 'all 0.3s ease',
                '&:hover': {
                  background: 'linear-gradient(135deg, #2563eb, #4f46e5)',
                  borderColor: 'rgba(59, 130, 246, 0.4)',
                  transform: 'translateY(-2px) scale(1.02)',
                  boxShadow: '0 8px 25px rgba(59, 130, 246, 0.25)',
                },
              }}
            >
              Download
            </Button>
            
            {selectedResource?.manifest?.type === 'model' && (
              <>
                {!showModelRunner && (
                  <Button
                    onClick={handleRunModel}
                    variant="outlined"
                    size="medium"
                    sx={{
                      borderRadius: '12px',
                      backgroundColor: 'rgba(59, 130, 246, 0.05)',
                      backdropFilter: 'blur(8px)',
                      border: '2px solid #3b82f6',
                      color: '#3b82f6',
                      fontWeight: 500,
                      px: 4,
                      py: 1.5,
                      fontSize: '0.95rem',
                      transition: 'all 0.3s ease',
                      '&:hover': {
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        borderColor: '#2563eb',
                        color: '#2563eb',
                        transform: 'translateY(-2px) scale(1.02)',
                        boxShadow: '0 8px 25px rgba(59, 130, 246, 0.2)',
                      },
                    }}
                  >
                    Test Run Model
                  </Button>
                )}
              </>
            )}

<Button
              onClick={handleViewSource}
              startIcon={<CodeIcon />}
              variant="outlined"
              size="medium"
              sx={{
                borderRadius: '12px',
                backgroundColor: 'rgba(255, 255, 255, 0.7)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255, 255, 255, 0.5)',
                color: '#4b5563',
                fontWeight: 500,
                px: 3,
                py: 1.5,
                transition: 'all 0.3s ease',
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.9)',
                  borderColor: 'rgba(59, 130, 246, 0.3)',
                  color: '#3b82f6',
                  transform: 'translateY(-2px)',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                },
              }}
            >
              View Source
            </Button>
            {latestVersion && (
              <Chip 
                icon={<UpdateIcon />} 
                label={`Version: ${latestVersion.version}`}
                sx={{ 
                  ml: 2,
                  backgroundColor: 'rgba(255, 255, 255, 0.8)',
                  backdropFilter: 'blur(4px)',
                  border: '1px solid rgba(255, 255, 255, 0.5)',
                  borderRadius: '12px',
                  fontWeight: 500,
                }} 
              />
            )}
          </Box>

          {/* Close Button - only show when model runner is active */}
          {showModelRunner && (
            <IconButton
              onClick={handleCloseModelRunner}
              size="medium"
              sx={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: '12px',
                color: '#dc2626',
                transition: 'all 0.3s ease',
                '&:hover': {
                  backgroundColor: 'rgba(239, 68, 68, 0.2)',
                  borderColor: 'rgba(239, 68, 68, 0.4)',
                  transform: 'scale(1.05)',
                  boxShadow: '0 4px 12px rgba(239, 68, 68, 0.2)',
                },
              }}
              title="Close Model Runner"
            >
              <CloseIcon />
            </IconButton>
          )}
        </Box>

        {/* Model Runner Controls Row (only show when active) */}
        {selectedResource?.manifest?.type === 'model' && showModelRunner && (
          <Box sx={{ mt: { xs: 1, sm: 2, md: 3 } }}>
            <ModelRunner
              artifactId={selectedResource.id}
              isDisabled={false}
              onRunStateChange={setShowModelRunner}
              createContainerCallback={createModelRunnerContainer}
              className="w-full"
              modelUrl={`https://hypha.aicell.io/bioimage-io/artifacts/${selectedResource.id.split("/").pop()}/create-zip-file${version && version !== 'latest' ? `?version=${version}` : ''}`}
            />
          </Box>
        )}

        {/* Cover Image Section or Model Runner Container */}
        {selectedResource.manifest.covers && selectedResource.manifest.covers.length > 0 && (
          <Box 
            sx={{ 
              position: 'relative',
              width: '100%',
              mt: { xs: 1, sm: 2, md: 4 },
              mb: { xs: 1, sm: 2, md: 3 },
              borderRadius: { xs: '8px', sm: '12px', md: '16px' },
              overflow: 'hidden',
              backgroundColor: 'rgba(249, 250, 251, 0.8)',
              backdropFilter: 'blur(4px)',
              border: showModelRunner ? '2px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.5)',
              transition: 'all 0.3s ease-in-out',
            }}
            data-cover-container="true"
          >
            {/* Image/Model Runner Section */}
            <Box
              sx={{
                position: 'relative',
                width: '100%',
                height: containerHeight,
              }}
            >
              {showModelRunner ? (
                <div 
                  ref={modelContainerRef}
                  id={currentContainerId || "model-container"}
                  style={{
                    width: '100%',
                    height: '100%'
                  }}
                />
              ) : (
                <>
                  <img
                    src={resolveHyphaUrl(selectedResource.manifest.covers[currentImageIndex], selectedResource.id)}
                    alt={`Cover ${currentImageIndex + 1}`}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      borderRadius: '12px'
                    }}
                  />
                  {selectedResource.manifest.covers.length > 1 && (
                    <>
                      <IconButton
                        onClick={previousImage}
                        sx={{
                          position: 'absolute',
                          left: 12,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          backgroundColor: 'rgba(255, 255, 255, 0.9)',
                          backdropFilter: 'blur(8px)',
                          border: '1px solid rgba(255, 255, 255, 0.5)',
                          borderRadius: '12px',
                          transition: 'all 0.3s ease',
                          '&:hover': {
                            backgroundColor: 'rgba(255, 255, 255, 0.95)',
                            borderColor: 'rgba(59, 130, 246, 0.3)',
                            transform: 'translateY(-50%) scale(1.05)',
                          }
                        }}
                      >
                        <NavigateBeforeIcon />
                      </IconButton>
                      <IconButton
                        onClick={nextImage}
                        sx={{
                          position: 'absolute',
                          right: 12,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          backgroundColor: 'rgba(255, 255, 255, 0.9)',
                          backdropFilter: 'blur(8px)',
                          border: '1px solid rgba(255, 255, 255, 0.5)',
                          borderRadius: '12px',
                          transition: 'all 0.3s ease',
                          '&:hover': {
                            backgroundColor: 'rgba(255, 255, 255, 0.95)',
                            borderColor: 'rgba(59, 130, 246, 0.3)',
                            transform: 'translateY(-50%) scale(1.05)',
                          }
                        }}
                      >
                        <NavigateNextIcon />
                      </IconButton>
                      <Box
                        sx={{
                          position: 'absolute',
                          bottom: 12,
                          left: '50%',
                          transform: 'translateX(-50%)',
                          backgroundColor: 'rgba(0, 0, 0, 0.7)',
                          backdropFilter: 'blur(8px)',
                          color: 'white',
                          padding: '6px 12px',
                          borderRadius: '12px',
                          fontSize: '0.875rem',
                          fontWeight: 500,
                        }}
                      >
                        {currentImageIndex + 1} / {selectedResource.manifest.covers.length}
                      </Box>
                    </>
                  )}
                </>
              )}
            </Box>
          </Box>
        )}


      </Box>

      

      <Grid container spacing={{ xs: 1, sm: 2, md: 3 }}>
        {/* Left Column - Documentation */}
        <Grid item xs={12} md={8}>
          {/* Documentation Card */}
          {documentation && (
            <Card 
              sx={{ 
                mb: { xs: 1, sm: 2, md: 3 }, 
                height: '100%',
                backgroundColor: 'rgba(255, 255, 255, 0.8)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255, 255, 255, 0.5)',
                borderRadius: { xs: '8px', sm: '12px', md: '16px' },
                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)',
              }}
            >
              <CardContent sx={{ p: 0 }}>
                <Box 
                  sx={{ 
                    padding: { xs: '12px', sm: '16px', md: '32px' },
                    '& pre': {
                      maxWidth: '100%',
                      overflow: 'auto',
                      backgroundColor: 'rgba(249, 250, 251, 0.8)',
                      borderRadius: '12px',
                      border: '1px solid rgba(255, 255, 255, 0.5)',
                    },
                    '& img': {
                      maxWidth: '100%',
                      height: 'auto',
                      borderRadius: '12px',
                    },
                    '& code': {
                      backgroundColor: 'rgba(249, 250, 251, 0.8)',
                      padding: '2px 6px',
                      borderRadius: '6px',
                      border: '1px solid rgba(255, 255, 255, 0.5)',
                    }
                  }}
                >
                  <ReactMarkdown 
                    className="markdown-body"
                    remarkPlugins={[remarkGfm]}
                  >
                    {documentation}
                  </ReactMarkdown>
                </Box>
              </CardContent>
            </Card>
          )}
        </Grid>

        {/* Right Column */}
        <Grid item xs={12} md={4}>

          {/* Authors Card - Moved from left column */}
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
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 300, color: '#1f2937' }}>
                <PersonIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                Authors
              </Typography>
              {manifest.authors?.map((author, index) => (
                <Box key={index} sx={{ mb: 2 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 500, color: '#1f2937' }}>
                    {author.name}
                  </Typography>
                  {author.orcid && (
                    <Link 
                      href={`https://orcid.org/${author.orcid}`}
                      target="_blank"
                      sx={{ 
                        display: 'inline-block',
                        fontSize: '0.875rem',
                        mb: 0.5,
                        color: '#3b82f6',
                        textDecoration: 'none',
                        '&:hover': {
                          textDecoration: 'underline',
                        }
                      }}
                    >
                      ORCID: {author.orcid}
                    </Link>
                  )}
                  {author.affiliation && (
                    <Typography variant="body2" color="text.secondary" sx={{ color: '#6b7280' }}>
                      <SchoolIcon sx={{ fontSize: 'small', mr: 0.5, verticalAlign: 'middle' }} />
                      {author.affiliation}
                    </Typography>
                  )}
                  {index < (manifest.authors?.length || 0) - 1 && <Divider sx={{ my: 2, borderColor: 'rgba(255, 255, 255, 0.5)' }} />}
                </Box>
              ))}
            </CardContent>
          </Card>

          {/* Files Card - Always show for all artifact types */}
          <ArtifactFiles artifactId={selectedResource.id} artifactInfo={selectedResource} version={version} />

          {/* Test Reports Card - Only show for models */}
          {selectedResource?.manifest?.type === 'model' && 
             selectedResource?.manifest.test_reports && 
             selectedResource.manifest.test_reports.length > 0 && (
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
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                  <Typography variant="h6" sx={{ fontWeight: 300, color: '#1f2937' }}>
                    <AssignmentTurnedInIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                    Test Reports
                  </Typography>
                  <TestReportBadge
                    artifact={selectedResource}
                    mode="inline"
                    size="small"
                    showPopover={false}
                    onStopPropagation={false}
                  />
                </Box>
                <Stack spacing={1}>
                  {selectedResource.manifest.test_reports.map((testReport: TestReport, index: number) => (
                    <Box 
                      key={index}
                      onClick={fetchDetailedTestReport}
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
                          borderColor: testReport.status === 'passed' 
                            ? 'rgba(34, 197, 94, 0.3)' 
                            : 'rgba(239, 68, 68, 0.3)',
                          transform: 'translateY(-2px)',
                          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                        }
                      }}
                    >
                      {testReport.status === 'passed' ? (
                        <CheckCircleIcon 
                          sx={{ 
                            color: '#22c55e', 
                            fontSize: 20,
                            flexShrink: 0
                          }} 
                        />
                      ) : (
                        <CancelIcon 
                          sx={{ 
                            color: '#ef4444', 
                            fontSize: 20,
                            flexShrink: 0
                          }} 
                        />
                      )}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography 
                          variant="body2" 
                          sx={{ 
                            fontWeight: 500, 
                            color: '#1f2937',
                            lineHeight: 1.2,
                            wordBreak: 'break-word'
                          }}
                        >
                          {testReport.name}
                        </Typography>
                        <Typography 
                          variant="caption" 
                          sx={{ 
                            color: '#6b7280',
                            fontSize: '0.75rem',
                            display: 'block',
                            mt: 0.5
                          }}
                        >
                          {testReport.runtime}
                        </Typography>
                      </Box>
                      <Chip
                        label={testReport.status}
                        size="small"
                        sx={{
                          backgroundColor: testReport.status === 'passed' 
                            ? 'rgba(34, 197, 94, 0.1)' 
                            : 'rgba(239, 68, 68, 0.1)',
                          color: testReport.status === 'passed' 
                            ? '#22c55e' 
                            : '#ef4444',
                          borderRadius: '8px',
                          fontWeight: 500,
                          fontSize: '0.75rem',
                          border: `1px solid ${testReport.status === 'passed' 
                            ? 'rgba(34, 197, 94, 0.2)' 
                            : 'rgba(239, 68, 68, 0.2)'}`,
                          textTransform: 'capitalize',
                          flexShrink: 0
                        }}
                      />
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          )}

          {/* Statistics Card - New */}
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
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 300, color: '#1f2937' }}>
                <BarChartIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                Statistics
              </Typography>
              <Stack spacing={1}>
                <Chip 
                  icon={<DownloadIcon />} 
                  label={`Downloads: ${selectedResource.download_count}`}
                  onClick={() => setShowDownloadInfo(!showDownloadInfo)}
                  sx={{ 
                    justifyContent: 'flex-start',
                    cursor: 'pointer',
                    backgroundColor: 'rgba(255, 255, 255, 0.7)',
                    backdropFilter: 'blur(4px)',
                    border: '1px solid rgba(255, 255, 255, 0.5)',
                    borderRadius: '12px',
                    fontWeight: 500,
                    transition: 'all 0.3s ease',
                    '&:hover': {
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                      borderColor: 'rgba(59, 130, 246, 0.3)',
                      color: '#3b82f6',
                    }
                  }}
                />
                <Chip 
                  icon={<VisibilityIcon />} 
                  label={`Views: ${selectedResource.view_count}`}
                  sx={{ 
                    justifyContent: 'flex-start',
                    backgroundColor: 'rgba(255, 255, 255, 0.7)',
                    backdropFilter: 'blur(4px)',
                    border: '1px solid rgba(255, 255, 255, 0.5)',
                    borderRadius: '12px',
                    fontWeight: 500,
                  }}
                />
              </Stack>
              
              {showDownloadInfo && (
                <Box 
                  sx={{ 
                    mt: { xs: 1, sm: 2 }, 
                    p: { xs: 1, sm: 2, md: 3 }, 
                    backgroundColor: 'rgba(59, 130, 246, 0.05)', 
                    backdropFilter: 'blur(4px)',
                    border: '1px solid rgba(59, 130, 246, 0.1)',
                    borderRadius: { xs: '6px', sm: '8px', md: '12px' },
                  }}
                >
                  <Typography variant="body2" sx={{ mb: 1, fontWeight: 500, color: '#1f2937' }}>
                    How Download Count is Calculated:
                  </Typography>
                  <Typography variant="body2" sx={{ mb: 1, color: '#4b5563', lineHeight: 1.5 }}>
                    Each file has a download weight: manifest files have weight 0, model weight files have weight 1.0. 
                    When individual weight files are downloaded, the count increases by 1 per weight file. 
                    When the complete model package is downloaded as a zip file, the count increases by 1 only when the entire zip is successfully downloaded.
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ color: '#6b7280' }}>
                    <strong>Note:</strong> Downloads with URL query parameter <code style={{ 
                      backgroundColor: 'rgba(255, 255, 255, 0.8)', 
                      padding: '2px 4px', 
                      borderRadius: '4px',
                      border: '1px solid rgba(255, 255, 255, 0.5)',
                    }}>silent=true</code> (e.g., CI scripts) do not increase the download count.
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>



          {/* Citations Card */}
          {manifest.cite && manifest.cite.length > 0 && (
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
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 300, color: '#1f2937' }}>
                  <FormatQuoteIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                  Citations
                </Typography>
                <Stack spacing={2}>
                  {manifest.cite.map((citation, index) => (
                    <Box key={index}>
                      <Typography variant="body2" sx={{ mb: 1, color: '#4b5563', lineHeight: 1.5 }}>
                        {citation.text}
                      </Typography>
                      {citation.doi && (
                        <Link 
                          href={`https://doi.org/${citation.doi}`}
                          target="_blank"
                          sx={{ 
                            display: 'inline-block',
                            fontSize: '0.875rem',
                            color: '#3b82f6',
                            textDecoration: 'none',
                            '&:hover': {
                              textDecoration: 'underline',
                            }
                          }}
                        >
                          DOI: {citation.doi}
                        </Link>
                      )}
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          )}

          {/* Add Versions Card here */}
          {selectedResource.versions && selectedResource.versions.length > 0 && (
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
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 300, color: '#1f2937' }}>
                  <UpdateIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                  Versions
                </Typography>
                <Stack spacing={2}>
                  {[...selectedResource.versions].reverse().map((version, index) => (
                    <Box key={version.version}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <RouterLink 
                          to={`/artifacts/${selectedResource.id.split('/').pop()}/${version.version}`}
                          style={{ textDecoration: 'none', color: 'inherit' }}
                        >
                          <Typography 
                            variant="subtitle2" 
                            sx={{ 
                              fontWeight: 500,
                              cursor: 'pointer',
                              color: '#3b82f6',
                              '&:hover': {
                                textDecoration: 'underline'
                              }
                            }}
                          >
                            {version.version}
                          </Typography>
                        </RouterLink>
                        {version.version === latestVersion?.version && (
                          <Chip 
                            label="Latest" 
                            color="primary" 
                            size="small" 
                            sx={{
                              backgroundColor: 'rgba(59, 130, 246, 0.1)',
                              color: '#3b82f6',
                              borderRadius: '8px',
                              fontWeight: 500,
                            }}
                          />
                        )}
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {formatTimestamp(version.created_at)}
                      </Typography>
                      {version.comment && (
                        <Typography variant="body2" sx={{ mt: 0.5, color: '#4b5563' }}>
                          {version.comment}
                        </Typography>
                      )}
                      {index < selectedResource.versions.length - 1 && (
                        <Divider sx={{ my: 1.5, borderColor: 'rgba(255, 255, 255, 0.5)' }} />
                      )}
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          )}

          {/* Tags Card */}
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
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 300, color: '#1f2937' }}>
                <LocalOfferIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                Tags
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {manifest.tags?.map((tag, index) => (
                  <Chip 
                    key={index} 
                    label={tag} 
                    size="small"
                    sx={{
                      backgroundColor: 'rgba(249, 250, 251, 0.8)',
                      backdropFilter: 'blur(4px)',
                      border: '1px solid rgba(255, 255, 255, 0.5)',
                      borderRadius: '12px',
                      color: '#6b7280',
                      fontWeight: 500,
                      fontSize: '0.75rem',
                      '&:hover': {
                        backgroundColor: 'rgba(255, 255, 255, 0.9)',
                        borderColor: 'rgba(59, 130, 246, 0.3)',
                        color: '#3b82f6',
                      }
                    }}
                  />
                ))}
              </Box>
            </CardContent>
          </Card>

          {/* Links Card */}
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
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 300, color: '#1f2937' }}>
                <LinkIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                Links
              </Typography>
              <Stack spacing={1}>
                {manifest.git_repo && (
                  <Link 
                    href={manifest.git_repo} 
                    target="_blank"
                    sx={{
                      color: '#3b82f6',
                      textDecoration: 'none',
                      fontWeight: 500,
                      '&:hover': {
                        textDecoration: 'underline',
                      }
                    }}
                  >
                    GitHub Repository
                  </Link>
                )}
              </Stack>
            </CardContent>
          </Card>

          {/* License Card */}
          <Card
            sx={{
              backgroundColor: 'rgba(255, 255, 255, 0.8)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255, 255, 255, 0.5)',
              borderRadius: { xs: '8px', sm: '12px', md: '16px' },
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)',
            }}
          >
            <CardContent sx={{ p: { xs: 1, sm: 1.5, md: 2 } }}>
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 300, color: '#1f2937' }}>
                <GavelIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                License
              </Typography>
              <Typography variant="body1" sx={{ color: '#4b5563', fontWeight: 500 }}>{manifest.license}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Dialog
        open={isRdfDialogOpen}
        onClose={() => setIsRdfDialogOpen(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle sx={{ m: 0, p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">RDF Source</Typography>
          <IconButton
            onClick={() => setIsRdfDialogOpen(false)}
            aria-label="close"
            sx={{
              position: 'absolute',
              right: 8,
              top: 8,
            }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ height: '60vh' }}>
            <Editor
              height="100%"
              defaultLanguage="yaml"
              value={rdfContent || ''}
              options={{
                readOnly: true,
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                fontSize: 14,
              }}
            />
          </Box>
        </DialogContent>
      </Dialog>

      <TestReportDialog
        open={isTestReportDialogOpen}
        onClose={() => setIsTestReportDialogOpen(false)}
        testReport={detailedTestReport}
        isLoading={isLoadingTestReport}
        rawErrorContent={rawErrorContent}
        isInvalidJson={isInvalidJson}
      />

      </Box>
      </div>
    </div>
  );
};

export default ArtifactDetails; 