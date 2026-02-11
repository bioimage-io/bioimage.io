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
import { resolveHyphaUrl } from '../utils/urlHelpers';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import { ArtifactInfo } from '../types/artifact';
import CodeIcon from '@mui/icons-material/Code';
import { partnerService } from '../services/partnerService';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import CloseIcon from '@mui/icons-material/Close';
import Editor from '@monaco-editor/react';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
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
  const [showDownloadInfo, setShowDownloadInfo] = useState(false);
  const [isStaged, setIsStaged] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const navigate = useNavigate();
  const { isBookmarked, toggleBookmark } = useBookmarks(artifactManager);

  // Check if user has edit permissions (reviewer/admin) similar to ArtifactCard
  useEffect(() => {
    const checkEditPermissions = async () => {
      if (!isLoggedIn || !user || !artifactManager) {
        setCanEdit(false);
        return;
      }

      try {
        const collection = await artifactManager.read({
          artifact_id: 'ri-scale/ai-model-hub',
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
      // If the id doesn't contain a slash, assume it's in the ri-scale workspace
      const artifactId = id.includes('/') ? id : `ri-scale/${id}`;
      fetchResource(artifactId, version);
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

  const handleDownload = () => {
    const artifactId = selectedResource?.id.split('/').pop();
    if (artifactId) {
      let downloadUrl = `https://hypha.aicell.io/ri-scale/artifacts/${artifactId}/create-zip-file`;
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

  // Add this overlay spinner component
  const LoadingOverlay = () => (
    <div className="fixed inset-0 bg-white/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-8 flex flex-col items-center shadow-xl border border-gray-100">
         <div className="animate-spin rounded-full h-10 w-10 border-2 border-gray-100 border-t-ri-orange mb-4"></div>
        <div className="text-base font-semibold text-ri-black">Loading Details...</div>
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
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        <Box sx={{ p: { xs: 1, sm: 1, md: 2 }, maxWidth: '100%', width: '100%' }}>
      {/* Header Section */}
      <Box 
        sx={{ 
          mb: { xs: 1, sm: 2, md: 4 }, 
          p: { xs: 1, sm: 2, md: 4 },
          backgroundColor: '#ffffff',
          border: '1px solid #e5e7eb', // gray-200
          borderRadius: '8px',
          boxShadow: 'none',
        }}
      >
        <Typography variant="h4" gutterBottom sx={{ fontWeight: 700, color: '#000000' }}>
        {manifest.id_emoji} {manifest.name} 
        </Typography>
        <Typography variant="subtitle1" color="text.secondary" gutterBottom className="flex items-center gap-2">
          <span className="text-gray-500">ID: </span>
          <code className="bg-gray-50 px-2 py-1 rounded text-gray-700 font-mono text-sm border border-gray-200">
            {selectedResource.id.split('/').pop()}
          </code>
          <div className="flex items-center gap-2">
            <IconButton
              onClick={handleCopyId}
              size="small"
              title="Copy ID"
              sx={{
                padding: '8px',
                color: '#9ca3af',
                '&:hover': {
                  color: '#f39200',
                  backgroundColor: 'rgba(243, 146, 0, 0.1)',
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
                  color: isBookmarked(selectedResource.id) ? '#f39200' : '#9ca3af',
                  '&:hover': {
                    color: '#f39200',
                    backgroundColor: 'rgba(243, 146, 0, 0.1)',
                  }
                }}
              >
                {isBookmarked(selectedResource.id) ? (
                  <StarIcon sx={{ fontSize: 16 }} />
                ) : (
                  <StarBorderIcon sx={{ fontSize: 16 }} />
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
                backgroundColor: '#f39200',
                color: 'white',
                fontWeight: 600,
                borderRadius: '6px',
                boxShadow: 'none',
                textTransform: 'none',
                '&:hover': {
                  backgroundColor: '#d98200',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
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
                  color: '#16a34a', // green
                  borderColor: '#16a34a',
                  fontWeight: 500,
                  borderRadius: '6px',
                  textTransform: 'none',
                  '&:hover': {
                    backgroundColor: 'rgba(34, 197, 94, 0.05)',
                    borderColor: '#15803d',
                  },
                }}
              >
                Edit
              </Button>
            )}

            <Button
              onClick={handleViewSource}
              startIcon={<CodeIcon />}
              variant="outlined"
              size="medium"
              sx={{
                color: '#4b5563',
                borderColor: '#e5e7eb',
                fontWeight: 500,
                borderRadius: '6px',
                textTransform: 'none',
                '&:hover': {
                  backgroundColor: '#f9fafb',
                  borderColor: '#d1d5db',
                  color: '#111827',
                },
              }}
            >
              View Source
            </Button>
            {latestVersion && (
              <Chip 
                icon={<UpdateIcon style={{ color: '#4b5563' }} />} 
                label={`Version: ${latestVersion.version}`}
                sx={{ 
                  ml: 2,
                  backgroundColor: '#f3f4f6', 
                  color: '#4b5563',
                  borderRadius: '6px',
                  fontWeight: 500,
                }} 
              />
            )}
          </Box>


        </Box>

        {/* Cover Image Section */}
        {selectedResource.manifest.covers && selectedResource.manifest.covers.length > 0 && (
          <Box 
            sx={{ 
              position: 'relative',
              width: '100%',
              mt: "24px",
              mb: { xs: 1, sm: 2, md: 3 },
              borderRadius: '8px',
              overflow: 'hidden',
              backgroundColor: '#f9fafb',
              border: '1px solid #e5e7eb',
            }}
            data-cover-container="true"
          >
            {/* Image Section */}
            <Box
              sx={{
                position: 'relative',
                width: '100%',
                height: '400px',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                backgroundColor: 'white'
              }}
            >
                <div>
                  <img
                    src={resolveHyphaUrl(selectedResource.manifest.covers[currentImageIndex], selectedResource.id)}
                    alt={`Cover ${currentImageIndex + 1}`}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '400px',
                      objectFit: 'contain',
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
                          border: '1px solid #e5e7eb',
                          '&:hover': {
                            backgroundColor: '#f39200',
                            color: 'white',
                            borderColor: '#f39200',
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
                          border: '1px solid #e5e7eb',
                          '&:hover': {
                            backgroundColor: '#f39200',
                            color: 'white',
                            borderColor: '#f39200',
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
                          backgroundColor: 'rgba(0, 0, 0, 0.6)',
                          color: 'white',
                          padding: '4px 12px',
                          borderRadius: '16px',
                          fontSize: '0.75rem',
                          fontWeight: 500,
                        }}
                      >
                        {currentImageIndex + 1} / {selectedResource.manifest.covers.length}
                      </Box>
                    </>
                  )}
                </div>
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
                backgroundColor: '#ffffff',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                boxShadow: 'none',
              }}
            >
              <CardContent sx={{ p: 0 }}>
                <Box 
                  sx={{ 
                    padding: { xs: '12px', sm: '16px', md: '32px' },
                    '& pre': {
                      backgroundColor: '#f9fafb',
                      borderRadius: '6px',
                      border: '1px solid #e5e7eb',
                    },
                    '& code': {
                      backgroundColor: '#f3f4f6',
                      color: '#1f2937',
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
              backgroundColor: '#ffffff',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              boxShadow: 'none',
            }}
          >
            <CardContent sx={{ p: { xs: 1, sm: 1.5, md: 2 } }}>
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: '#111827', fontSize: '1rem' }}>
                <PersonIcon sx={{ mr: 1, verticalAlign: 'text-bottom', fontSize: '1.1rem', color: '#f39200' }} />
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
                        color: '#6b7280',
                        textDecoration: 'none',
                        '&:hover': {
                          color: '#f39200',
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
                  {index < (manifest.authors?.length || 0) - 1 && <Divider sx={{ my: 2 }} />}
                </Box>
              ))}
            </CardContent>
          </Card>

          {/* Files Card - Always show for all artifact types */}
          <ArtifactFiles artifactId={selectedResource.id} artifactInfo={selectedResource} version={version} />

          {/* Statistics Card - New */}
          <Card 
            sx={{ 
              mb: { xs: 1, sm: 2, md: 3 },
              backgroundColor: '#ffffff',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              boxShadow: 'none',
            }}
          >
            <CardContent sx={{ p: { xs: 1, sm: 1.5, md: 2 } }}>
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: '#111827', fontSize: '1rem' }}>
                <BarChartIcon sx={{ mr: 1, verticalAlign: 'text-bottom', fontSize: '1.1rem', color: '#f39200' }} />
                Statistics
              </Typography>
              <Stack spacing={1}>
                <Chip 
                  icon={<DownloadIcon style={{ color: '#4b5563' }} />} 
                  label={`Downloads: ${selectedResource.download_count}`}
                  onClick={() => setShowDownloadInfo(!showDownloadInfo)}
                  sx={{ 
                    justifyContent: 'flex-start',
                    cursor: 'pointer',
                    backgroundColor: '#f9fafb',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    fontWeight: 500,
                    transition: 'all 0.2s',
                    '&:hover': {
                      backgroundColor: '#f3f4f6',
                      borderColor: '#d1d5db',
                    }
                  }}
                />
                <Chip 
                  icon={<VisibilityIcon style={{ color: '#4b5563' }} />} 
                  label={`Views: ${selectedResource.view_count}`}
                  sx={{ 
                    justifyContent: 'flex-start',
                    backgroundColor: '#f9fafb',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    fontWeight: 500,
                  }}
                />
              </Stack>
              
              {showDownloadInfo && (
                <Box 
                  sx={{ 
                    mt: { xs: 1, sm: 2 }, 
                    p: { xs: 1, sm: 2, md: 3 }, 
                    backgroundColor: '#f3f4f6', 
                    borderRadius: '6px',
                    border: '1px solid #e5e7eb',
                  }}
                >
                  <Typography variant="body2" sx={{ mb: 1, fontWeight: 600, color: '#1f2937' }}>
                    How Download Count is Calculated:
                  </Typography>
                  <Typography variant="body2" sx={{ mb: 1, color: '#4b5563', lineHeight: 1.5 }}>
                    Each file has a download weight: manifest files have weight 0, model weight files have weight 1.0. 
                    When individual weight files are downloaded, the count increases by 1 per weight file. 
                    When the complete model package is downloaded as a zip file, the count increases by 1 only when the entire zip is successfully downloaded.
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
                backgroundColor: '#ffffff',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                boxShadow: 'none',
              }}
            >
              <CardContent sx={{ p: { xs: 1, sm: 1.5, md: 2 } }}>
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: '#111827', fontSize: '1rem' }}>
                  <FormatQuoteIcon sx={{ mr: 1, verticalAlign: 'text-bottom', fontSize: '1.1rem', color: '#f39200' }} />
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
                            color: '#6b7280',
                            textDecoration: 'none',
                            '&:hover': {
                              color: '#f39200',
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

          {/* Versions Card */}
          {selectedResource.versions && selectedResource.versions.length > 0 && (
            <Card 
              sx={{ 
                mb: { xs: 1, sm: 2, md: 3 },
                backgroundColor: '#ffffff',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                boxShadow: 'none',
              }}
            >
              <CardContent sx={{ p: { xs: 1, sm: 1.5, md: 2 } }}>
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: '#111827', fontSize: '1rem' }}>
                  <UpdateIcon sx={{ mr: 1, verticalAlign: 'text-bottom', fontSize: '1.1rem', color: '#f39200' }} />
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
                              color: '#4b5563',
                              '&:hover': {
                                color: '#f39200',
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
                            size="small" 
                            sx={{
                              backgroundColor: 'rgba(243, 146, 0, 0.1)',
                              color: '#f39200',
                              borderRadius: '4px',
                              fontWeight: 600,
                              height: '20px',
                              fontSize: '0.7rem'
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
                        <Divider sx={{ my: 1.5 }} />
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
              backgroundColor: '#ffffff',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              boxShadow: 'none',
            }}
          >
            <CardContent sx={{ p: { xs: 1, sm: 1.5, md: 2 } }}>
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: '#111827', fontSize: '1rem' }}>
                <LocalOfferIcon sx={{ mr: 1, verticalAlign: 'text-bottom', fontSize: '1.1rem', color: '#f39200' }} />
                Tags
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {manifest.tags?.map((tag, index) => (
                  <Chip 
                    key={index} 
                    label={tag} 
                    size="small"
                    sx={{
                      backgroundColor: '#f9fafb',
                      border: '1px solid #e5e7eb',
                      borderRadius: '6px',
                      color: '#4b5563',
                      fontWeight: 500,
                      fontSize: '0.75rem',
                      '&:hover': {
                         borderColor: '#f39200',
                         color: '#f39200',
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
              backgroundColor: '#ffffff',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              boxShadow: 'none',
            }}
          >
            <CardContent sx={{ p: { xs: 1, sm: 1.5, md: 2 } }}>
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: '#111827', fontSize: '1rem' }}>
                <LinkIcon sx={{ mr: 1, verticalAlign: 'text-bottom', fontSize: '1.1rem', color: '#f39200' }} />
                Links
              </Typography>
              <Stack spacing={1}>
                {manifest.git_repo && (
                  <Link 
                    href={manifest.git_repo} 
                    target="_blank"
                    sx={{
                      color: '#4b5563',
                      textDecoration: 'none',
                      fontWeight: 500,
                      '&:hover': {
                        color: '#f39200',
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
              backgroundColor: '#ffffff',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              boxShadow: 'none',
            }}
          >
            <CardContent sx={{ p: { xs: 1, sm: 1.5, md: 2 } }}>
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: '#111827', fontSize: '1rem' }}>
                <GavelIcon sx={{ mr: 1, verticalAlign: 'text-bottom', fontSize: '1.1rem', color: '#f39200' }} />
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

      </Box>
      </div>
    </div>
  );
};

export default ArtifactDetails;