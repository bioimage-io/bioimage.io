import { useEffect, useState, useRef } from 'react';
import { useParams, Link as RouterLink, useNavigate } from 'react-router-dom';
import { useHyphaStore } from '../store/hyphaStore';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button, Box, Typography, Chip, Grid, Card, CardContent, Avatar, Link, Stack, Divider, IconButton, CircularProgress, Alert, Accordion, AccordionSummary, AccordionDetails, Paper } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import SchoolIcon from '@mui/icons-material/School';
import LinkIcon from '@mui/icons-material/Link';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';
import VisibilityIcon from '@mui/icons-material/Visibility';
import UpdateIcon from '@mui/icons-material/Update';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import BarChartIcon from '@mui/icons-material/BarChart';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import GavelIcon from '@mui/icons-material/Gavel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import DevicesIcon from '@mui/icons-material/Devices';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import WarningIcon from '@mui/icons-material/Warning';
import ModelTester from './ModelTester';
import ModelRunner from './ModelRunner';
import { resolveHyphaUrl } from '../utils/urlHelpers';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import { ArtifactInfo, TestReport, DetailedTestReport } from '../types/artifact';
import CodeIcon from '@mui/icons-material/Code';
import { partnerService } from '../services/partnerService';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import CloseIcon from '@mui/icons-material/Close';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import Editor from '@monaco-editor/react';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import TestReportBadge from './TestReportBadge';
import TestReportDialog from './TestReportDialog';
import TestDetailsDialog from './TestDetailsDialog';
import ArtifactFiles from './ArtifactFiles';
import { useBookmarks } from '../hooks/useBookmarks';

const ArtifactDetails = () => {
  const { id, version } = useParams<{ id: string; version?: string }>();
  const { selectedResource, fetchResource, isLoading, error, user, isLoggedIn, artifactManager } = useHyphaStore();
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const modelContainerRef = useRef<HTMLDivElement>(null);
  const fullscreenContainerRef = useRef<HTMLDivElement>(null);
  const [isStaged, setIsStaged] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const navigate = useNavigate();
  const { isBookmarked, toggleBookmark } = useBookmarks(artifactManager);
  const [compatibilityData, setCompatibilityData] = useState<any>(null);
  const [isLoadingCompatibility, setIsLoadingCompatibility] = useState(false);
  const [compatibilityError, setCompatibilityError] = useState<string | null>(null);
  const [isCompatibilityDialogOpen, setIsCompatibilityDialogOpen] = useState(false);
  const [selectedCompatibilityTest, setSelectedCompatibilityTest] = useState<{ name: string; data: any } | null>(null);
  const [partnerIcons, setPartnerIcons] = useState<Map<string, string>>(new Map());
  const [testReportData, setTestReportData] = useState<DetailedTestReport | null>(null);

  // Check if user has edit permissions (reviewer/admin) similar to ArtifactCard
  useEffect(() => {
    const checkEditPermissions = async () => {
      if (!isLoggedIn || !user || !artifactManager) {
        setCanEdit(false);
        return;
      }

      try {
        const collection = await artifactManager.read({
          artifact_id: 'bioimage-io/bioimage.io',
          _rkwargs: true
        });

        if (user && collection.config?.permissions) {
          const userPermission = collection.config.permissions[user.id];
          const hasWritePermission = userPermission === 'rw' || userPermission === 'rw+' || userPermission === '*';
          const isAdmin = user.roles?.includes('admin');
          setCanEdit(hasWritePermission || isAdmin);
        } else {
          setCanEdit(user.roles?.includes('admin') || false);
        }
      } catch (error) {
        console.error('Error checking edit permissions:', error);
        setCanEdit(false);
      }
    };

    checkEditPermissions();
  }, [isLoggedIn, user, artifactManager]);

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

    setIsStaged(version === 'stage');

    fetchDocumentation();
  }, [selectedResource?.id, selectedResource?.manifest.documentation]);

  useEffect(() => {
    if (selectedResource?.versions?.length) {
      setLatestVersion(selectedResource.versions[selectedResource.versions.length - 1]);
    }
  }, [selectedResource?.versions]);

  // Fetch partner icons
  useEffect(() => {
    const loadPartners = async () => {
      try {
        await partnerService.fetchPartners();
      } catch (error) {
        console.error('Failed to fetch partners:', error);
      }
    };
    loadPartners();
  }, []);

  // Fetch compatibility data and test report for model artifacts
  useEffect(() => {
    const fetchCompatibilityData = async () => {
      if (selectedResource?.manifest?.type !== 'model') {
        return;
      }

      const artifactAlias = selectedResource.id.split('/').pop();
      const versionString = version === 'stage' ? 'stage' : (version || latestVersion?.version || 'v0');

      if (!artifactAlias) {
        return;
      }

      try {
        setIsLoadingCompatibility(true);
        setCompatibilityError(null);

        const compatibilityUrl = `https://bioimage-io.github.io/collection/reports/bioimage-io/${artifactAlias}/${versionString}/summary.json`;
        const response = await fetch(compatibilityUrl);

        if (!response.ok) {
          throw new Error(`Failed to fetch compatibility data: ${response.status}`);
        }

        const data = await response.json();
        setCompatibilityData(data);

        // Build partner icon map from compatibility data
        if (data.tests) {
          const iconMap = new Map<string, string>();
          for (const softwareName of Object.keys(data.tests)) {
            // Special case for bioimageio.core
            if (softwareName.toLowerCase().includes('bioimageio.core') || softwareName.toLowerCase().includes('bioimage.io')) {
              iconMap.set(softwareName, 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/python/python-original.svg');
            } else {
              const icon = partnerService.getPartnerIcon(softwareName);
              if (icon) {
                iconMap.set(softwareName, icon);
              }
            }
          }
          // Add bioengine icon
          iconMap.set('bioengine', '/bioengine-icon.svg');
          setPartnerIcons(iconMap);
        }
      } catch (error) {
        console.error('Failed to fetch compatibility data:', error);
        setCompatibilityError(error instanceof Error ? error.message : 'Failed to load compatibility data');
      } finally {
        setIsLoadingCompatibility(false);
      }
    };

    const fetchTestReport = async () => {
      if (selectedResource?.manifest?.type !== 'model') {
        return;
      }

      const testReports = selectedResource?.manifest?.test_reports;
      if (!testReports) {
        setTestReportData(null);
        return;
      }

      try {
        const testReportUrl = resolveHyphaUrl('test_reports.json', selectedResource.id, true);
        const response = await fetch(testReportUrl);
        const testReportJson = await response.json();
        
        if (isValidTestReport(testReportJson)) {
          setTestReportData(testReportJson);
        } else {
          setTestReportData(null);
        }
      } catch (error) {
        console.error('Failed to fetch test report:', error);
        setTestReportData(null);
      }
    };

    fetchCompatibilityData();
    fetchTestReport();
  }, [selectedResource?.id, selectedResource?.manifest?.type, selectedResource?.manifest?.test_reports, version, latestVersion]);

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
        
        const testReportUrl = resolveHyphaUrl('test_reports.json', selectedResource.id, true);
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

  const handleEdit = () => {
    if (!selectedResource?.id) return;
    navigate(`/edit/${encodeURIComponent(selectedResource.id)}`);
  };

  // Add this function to format timestamps
  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
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

  const handleBookmark = async () => {
    if (!isLoggedIn || !selectedResource) {
      alert('Please login to bookmark artifacts');
      return;
    }
    if (!artifactManager) {
      alert('Please wait for the system to initialize');
      return;
    }
    try {
      await toggleBookmark({
        id: selectedResource.id,
        name: selectedResource.manifest.name,
        description: selectedResource.manifest.description,
        covers: selectedResource.manifest.covers,
        icon: selectedResource.manifest.icon
      });
    } catch (error) {
      console.error('Error toggling bookmark:', error);
      alert('Failed to toggle bookmark. Please try again.');
    }
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

  // Fullscreen functionality
  const handleFullscreen = async () => {
    const element = fullscreenContainerRef.current;
    if (!element) return;

    try {
      if (!isFullscreen) {
        // Enter fullscreen
        if (element.requestFullscreen) {
          await element.requestFullscreen();
        } else if ((element as any).webkitRequestFullscreen) {
          await (element as any).webkitRequestFullscreen();
        } else if ((element as any).msRequestFullscreen) {
          await (element as any).msRequestFullscreen();
        }
      } else {
        // Exit fullscreen
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        } else if ((document as any).msExitFullscreen) {
          await (document as any).msExitFullscreen();
        }
      }
    } catch (error) {
      console.error('Error toggling fullscreen:', error);
    }
  };

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = !!(
        document.fullscreenElement || 
        (document as any).webkitFullscreenElement || 
        (document as any).msFullscreenElement
      );
      setIsFullscreen(isCurrentlyFullscreen);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('msfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('msfullscreenchange', handleFullscreenChange);
    };
  }, []);

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
            {isLoggedIn && (
              <IconButton
                onClick={handleBookmark}
                size="small"
                title={isBookmarked(selectedResource.id) ? "Remove bookmark" : "Bookmark"}
                sx={{
                  padding: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.7)',
                  backdropFilter: 'blur(4px)',
                  border: '1px solid rgba(255, 255, 255, 0.5)',
                  borderRadius: '12px',
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                    borderColor: 'rgba(251, 191, 36, 0.3)',
                    transform: 'scale(1.05)',
                  }
                }}
              >
                {isBookmarked(selectedResource.id) ? (
                  <StarIcon sx={{ fontSize: 16, color: 'rgba(251, 191, 36, 1)' }} />
                ) : (
                  <StarBorderIcon sx={{ fontSize: 16, color: 'rgba(107, 114, 128, 1)' }} />
                )}
              </IconButton>
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
            {canEdit && (
              <Button
                onClick={handleEdit}
                startIcon={<EditIcon />}
                variant="outlined"
                size="medium"
                sx={{
                  borderRadius: '12px',
                  backgroundColor: 'rgba(34, 197, 94, 0.05)',
                  backdropFilter: 'blur(8px)',
                  border: '2px solid #22c55e',
                  color: '#16a34a',
                  fontWeight: 500,
                  px: 3,
                  py: 1.5,
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    borderColor: '#16a34a',
                    color: '#15803d',
                    transform: 'translateY(-2px) scale(1.02)',
                    boxShadow: '0 8px 25px rgba(34, 197, 94, 0.2)',
                  },
                }}
              >
                Edit
              </Button>
            )}
            
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

          {/* Fullscreen and Close Buttons - only show when model runner is active */}
          {showModelRunner && (
            <Stack direction="row" spacing={1}>
              <IconButton
                onClick={handleFullscreen}
                size="medium"
                sx={{
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(59, 130, 246, 0.2)',
                  borderRadius: '12px',
                  color: '#3b82f6',
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                    borderColor: 'rgba(59, 130, 246, 0.4)',
                    transform: 'scale(1.05)',
                    boxShadow: '0 4px 12px rgba(59, 130, 246, 0.2)',
                  },
                }}
                title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
              >
                {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
              </IconButton>
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
            </Stack>
          )}
        </Box>

        {/* Model Runner Section - wrap both controls and visualization */}
        <Box 
          ref={fullscreenContainerRef}
          sx={{ 
            // Fullscreen styles
            ...(isFullscreen && {
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              zIndex: 9999,
              backgroundColor: '#ffffff',
              padding: 2,
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
            })
          }}
        >
          {/* Fullscreen Header - only show in fullscreen mode */}
          {isFullscreen && selectedResource?.manifest?.type === 'model' && showModelRunner && (
            <Box 
              sx={{ 
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                mb: 3,
                pb: 2,
                borderBottom: '1px solid rgba(229, 231, 235, 0.8)',
                backgroundColor: 'rgba(249, 250, 251, 0.5)',
                borderRadius: '12px',
                padding: '16px 24px',
                backdropFilter: 'blur(8px)',
              }}
            >
              <img 
                src="/static/img/ri-scale-alt-logo.png" 
                alt="RI-SCALE Model Hub"
                style={{
                  height: '40px',
                  width: '40px',
                }}
              />
              <Box>
                <Typography 
                  variant="h5" 
                  sx={{ 
                    fontWeight: 600,
                    color: '#1f2937',
                    lineHeight: 1.2,
                  }}
                >
                  Model Test Run
                </Typography>
                <Typography 
                  variant="body1" 
                  sx={{ 
                    color: '#6b7280',
                    fontFamily: 'monospace',
                    fontSize: '0.9rem',
                  }}
                >
                  {selectedResource.id.split('/').pop()}
                </Typography>
              </Box>
            </Box>
          )}

          {/* Model Runner Controls Row (only show when active) */}
          {selectedResource?.manifest?.type === 'model' && showModelRunner && (
            <Box sx={{ mt: isFullscreen ? 0 : { xs: 1, sm: 2, md: 3 } }}>
              <ModelRunner
                artifactId={selectedResource.id}
                isStaged={isStaged}
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
              mt: "2px",
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
                height: isFullscreen ? 'calc(100vh - 300px)' : containerHeight,
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

          {/* Compatibilities Card - Only show for models */}
          {selectedResource?.manifest?.type === 'model' && (
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
                    <DevicesIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                    Compatibilities
                  </Typography>
                </Box>

                {isLoadingCompatibility && (
                  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', p: 3 }}>
                    <CircularProgress size={24} />
                    <Typography variant="body2" sx={{ ml: 2, color: '#6b7280' }}>
                      Loading compatibility data...
                    </Typography>
                  </Box>
                )}

                {compatibilityError && !isLoadingCompatibility && (
                  <Alert severity="info" sx={{ borderRadius: '12px' }}>
                    Compatibility data not available for this version
                  </Alert>
                )}

                {compatibilityData && !isLoadingCompatibility && !compatibilityError && (
                  <Stack spacing={0.75}>
                    {/* Test Results - Software with Version Chips */}
                    {compatibilityData.tests && Object.keys(compatibilityData.tests).length > 0 && (() => {
                      // Sort software entries: bioimageio.core first, then bioengine (if exists), then rest alphabetically
                      const softwareEntries = Object.entries(compatibilityData.tests);
                      const sortedEntries = softwareEntries.sort(([nameA], [nameB]) => {
                        const isBioImageCoreA = nameA.toLowerCase().includes('bioimageio.core') || nameA.toLowerCase().includes('bioimage.io');
                        const isBioImageCoreB = nameB.toLowerCase().includes('bioimageio.core') || nameB.toLowerCase().includes('bioimage.io');
                        
                        // bioimageio.core always first
                        if (isBioImageCoreA && !isBioImageCoreB) return -1;
                        if (!isBioImageCoreA && isBioImageCoreB) return 1;
                        
                        // Then alphabetically for the rest
                        return nameA.localeCompare(nameB);
                      });
                      
                      // Create array to hold all entries including bioengine
                      const allEntries: Array<{ type: 'software' | 'bioengine', name: string, data: any }> = [];
                      
                      // Add entries in order: bioimageio.core first, then bioengine, then rest
                      const bioimageCoreEntry = sortedEntries.find(([name]) => 
                        name.toLowerCase().includes('bioimageio.core') || name.toLowerCase().includes('bioimage.io')
                      );
                      const otherEntries = sortedEntries.filter(([name]) => 
                        !(name.toLowerCase().includes('bioimageio.core') || name.toLowerCase().includes('bioimage.io'))
                      );
                      
                      if (bioimageCoreEntry) {
                        allEntries.push({ type: 'software', name: bioimageCoreEntry[0], data: bioimageCoreEntry[1] });
                      }
                      
                      // Add bioengine entry after bioimageio.core if test report data exists
                      if (testReportData) {
                        allEntries.push({ type: 'bioengine', name: 'bioengine', data: testReportData });
                      }
                      
                      // Add remaining entries
                      otherEntries.forEach(([name, data]) => {
                        allEntries.push({ type: 'software', name, data });
                      });
                      
                      return (
                        <>
                          {allEntries.map((entry, index) => {
                            if (entry.type === 'bioengine') {
                              // Render bioengine entry
                              const reports = selectedResource?.manifest?.test_reports;
                              const reportArray = Array.isArray(reports) ? reports : (reports as any)?.reports;
                              
                              // Extract bioimageio.core version from env
                              const bioimageioCoreVersion = entry.data.env?.find(
                                (pkg: any[]) => pkg[0] === 'bioimageio.core'
                              )?.[1] || 'unknown';
                              
                              const isPassed = entry.data.status === 'passed';
                              
                              return (
                                <>
                                  <Box
                                    key="bioengine"
                                    sx={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 0.75,
                                      p: 1,
                                      backgroundColor: 'rgba(255, 255, 255, 0.6)',
                                      backdropFilter: 'blur(4px)',
                                      border: '1px solid rgba(255, 255, 255, 0.7)',
                                      borderRadius: '10px',
                                      transition: 'all 0.3s ease',
                                      '&:hover': {
                                        backgroundColor: 'rgba(255, 255, 255, 0.8)',
                                      }
                                    }}
                                  >
                                    {isPassed ? (
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
                                    {partnerIcons.get('bioengine') && (
                                      <Box
                                        component="img"
                                        src={partnerIcons.get('bioengine')}
                                        alt="bioengine"
                                        sx={{
                                          width: 20,
                                          height: 20,
                                          objectFit: 'contain',
                                          flexShrink: 0,
                                          cursor: 'default'
                                        }}
                                        onError={(e) => {
                                          const img = e.target as HTMLImageElement;
                                          img.style.display = 'none';
                                        }}
                                      />
                                    )}
                                    <Typography
                                      variant="body2"
                                      sx={{
                                        minWidth: '100px',
                                        fontWeight: 500,
                                        color: '#1f2937',
                                        fontFamily: 'monospace',
                                        fontSize: '0.875rem'
                                      }}
                                    >
                                      bioengine
                                    </Typography>
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, flex: 1 }}>
                                      <Chip
                                        label={bioimageioCoreVersion}
                                        size="small"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          fetchDetailedTestReport();
                                        }}
                                        sx={{
                                          height: '20px',
                                          backgroundColor: isPassed ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                          color: isPassed ? '#16a34a' : '#dc2626',
                                          borderRadius: '4px',
                                          fontWeight: 600,
                                          fontSize: '0.65rem',
                                          border: isPassed ? '1.5px solid #22c55e' : '1.5px solid #ef4444',
                                          cursor: 'pointer',
                                          transition: 'all 0.2s ease',
                                          '& .MuiChip-label': {
                                            px: 0.75,
                                            py: 0
                                          },
                                          '&:hover': {
                                            backgroundColor: isPassed ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)',
                                            transform: 'scale(1.05)',
                                          }
                                        }}
                                      />
                                    </Box>
                                  </Box>
                                  <Divider sx={{ my: 1, opacity: 0.3 }} />
                                </>
                              );
                            }
                            
                            // Render regular software entry
                            const softwareName = entry.name;
                            const versions = entry.data;
                          
                          // Check status across all versions
                          const versionEntries = Object.entries(versions);
                          
                          // Sort versions to find the latest one (semantic version sorting)
                          const sortedVersions = [...versionEntries].sort((a, b) => {
                            const parseVersion = (v: string) => {
                              const parts = v.replace(/^v/, '').split('.').map(p => parseInt(p, 10) || 0);
                              return parts;
                            };
                            const aParts = parseVersion(a[0]);
                            const bParts = parseVersion(b[0]);
                            for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
                              const aVal = aParts[i] || 0;
                              const bVal = bParts[i] || 0;
                              if (aVal !== bVal) return bVal - aVal; // Descending order (latest first)
                            }
                            return 0;
                          });
                          
                          // Get the latest version's status
                          const latestVersionData = sortedVersions.length > 0 ? sortedVersions[0][1] as any : null;
                          const latestPassed = latestVersionData?.status === 'passed';
                          
                          const allPassed = versionEntries.every(([_, versionData]: [string, any]) => versionData.status === 'passed');
                          const anyPassed = versionEntries.some(([_, versionData]: [string, any]) => versionData.status === 'passed');
                          const allNotApplicable = versionEntries.every(([_, versionData]: [string, any]) => versionData.status === 'not-applicable');

                          return (
                            <Box
                              key={softwareName}
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.75,
                                p: 1,
                                backgroundColor: 'rgba(255, 255, 255, 0.6)',
                                backdropFilter: 'blur(4px)',
                                border: '1px solid rgba(255, 255, 255, 0.7)',
                                borderRadius: '10px',
                                transition: 'all 0.3s ease',
                                '&:hover': {
                                  backgroundColor: 'rgba(255, 255, 255, 0.8)',
                                }
                              }}
                            >
                              {allPassed || latestPassed ? (
                                <CheckCircleIcon
                                  sx={{
                                    color: '#22c55e',
                                    fontSize: 20,
                                    flexShrink: 0
                                  }}
                                />
                              ) : anyPassed ? (
                                <CheckCircleIcon
                                  sx={{
                                    color: '#f59e0b',
                                    fontSize: 20,
                                    flexShrink: 0
                                  }}
                                />
                              ) : allNotApplicable ? (
                                <CancelIcon
                                  sx={{
                                    color: '#9ca3af',
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
                              {partnerIcons.get(softwareName) && (
                                <Box
                                  component="img"
                                  src={partnerIcons.get(softwareName)}
                                  alt={softwareName}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // Special case for bioimageio.core
                                    if (softwareName.toLowerCase().includes('bioimageio.core') || softwareName.toLowerCase().includes('bioimage.io')) {
                                      window.open('https://bioimage-io.github.io/core-bioimage-io-python/', '_blank', 'noopener,noreferrer');
                                      return;
                                    }
                                    const partner = partnerService.getPartnerByName(softwareName);
                                    if (partner?.link) {
                                      window.open(partner.link, '_blank', 'noopener,noreferrer');
                                    }
                                  }}
                                  sx={{
                                    width: 20,
                                    height: 20,
                                    objectFit: 'contain',
                                    flexShrink: 0,
                                    cursor: (softwareName.toLowerCase().includes('bioimageio.core') || softwareName.toLowerCase().includes('bioimage.io') || partnerService.getPartnerByName(softwareName)?.link) ? 'pointer' : 'default',
                                    transition: 'all 0.2s ease',
                                    '&:hover': {
                                      transform: (softwareName.toLowerCase().includes('bioimageio.core') || softwareName.toLowerCase().includes('bioimage.io') || partnerService.getPartnerByName(softwareName)?.link) ? 'scale(1.2)' : 'none',
                                      filter: 'brightness(1.1)'
                                    }
                                  }}
                                  onError={(e) => {
                                    const img = e.target as HTMLImageElement;
                                    img.style.display = 'none';
                                  }}
                                />
                              )}
                              <Typography
                                variant="body2"
                                sx={{
                                  minWidth: '100px',
                                  fontWeight: 500,
                                  color: '#1f2937',
                                  fontFamily: 'monospace',
                                  fontSize: '0.875rem'
                                }}
                              >
                                {softwareName}
                              </Typography>
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, flex: 1 }}>
                                {Object.entries(versions).map(([version, versionData]: [string, any]) => {
                                  const isPassed = versionData.status === 'passed';
                                  const isNotApplicable = versionData.status === 'not-applicable';
                                  
                                  // Determine colors based on status
                                  const getChipColors = () => {
                                    if (isPassed) {
                                      return {
                                        bg: 'rgba(34, 197, 94, 0.15)',
                                        color: '#16a34a',
                                        border: '#22c55e',
                                        hoverBg: 'rgba(34, 197, 94, 0.25)'
                                      };
                                    } else if (isNotApplicable) {
                                      return {
                                        bg: 'rgba(156, 163, 175, 0.15)',
                                        color: '#6b7280',
                                        border: '#9ca3af',
                                        hoverBg: 'rgba(156, 163, 175, 0.25)'
                                      };
                                    } else {
                                      return {
                                        bg: 'rgba(239, 68, 68, 0.15)',
                                        color: '#dc2626',
                                        border: '#ef4444',
                                        hoverBg: 'rgba(239, 68, 68, 0.25)'
                                      };
                                    }
                                  };
                                  const chipColors = getChipColors();
                                  
                                  return (
                                    <Chip
                                      key={version}
                                      label={version}
                                      size="small"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedCompatibilityTest({
                                          name: `${softwareName} ${version}`,
                                          data: versionData
                                        });
                                        setIsCompatibilityDialogOpen(true);
                                      }}
                                      sx={{
                                        height: '20px',
                                        backgroundColor: chipColors.bg,
                                        color: chipColors.color,
                                        borderRadius: '4px',
                                        fontWeight: 600,
                                        fontSize: '0.65rem',
                                        border: `1.5px solid ${chipColors.border}`,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease',
                                        '& .MuiChip-label': {
                                          px: 0.75,
                                          py: 0
                                        },
                                        '&:hover': {
                                          backgroundColor: chipColors.hoverBg,
                                          transform: 'scale(1.05)',
                                        }
                                      }}
                                    />
                                  );
                                })}
                              </Box>
                            </Box>
                          );
                        })}
                      </>
                    )})()}
                  </Stack>
                )}
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

      {/* Compatibility Details Dialog */}
      <TestDetailsDialog
        open={isCompatibilityDialogOpen}
        onClose={() => setIsCompatibilityDialogOpen(false)}
        data={selectedCompatibilityTest?.data || null}
        isLoading={false}
        type="compatibility"
        partnerName={selectedCompatibilityTest?.name.split(' ')[0] || ''}
        partnerVersion={selectedCompatibilityTest?.name.split(' ').slice(1).join(' ') || ''}
      />

      </Box>
      </div>
    </div>
  );
};

export default ArtifactDetails; 