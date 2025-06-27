import { useEffect, useState, useRef } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import { useHyphaStore } from '../store/hyphaStore';
import ReactMarkdown from 'react-markdown';
import { Button, Box, Typography, Chip, Grid, Card, CardContent, Avatar, Link, Stack, Divider, IconButton, CircularProgress, Alert } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import SchoolIcon from '@mui/icons-material/School';
import LinkIcon from '@mui/icons-material/Link';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import DownloadIcon from '@mui/icons-material/Download';
import VisibilityIcon from '@mui/icons-material/Visibility';
import UpdateIcon from '@mui/icons-material/Update';
import ModelTester from './ModelTester';
import ModelRunner from './ModelRunner';
import { resolveHyphaUrl } from '../utils/urlHelpers';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import { ArtifactInfo } from '../types/artifact';
import CodeIcon from '@mui/icons-material/Code';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import CloseIcon from '@mui/icons-material/Close';
import Editor from '@monaco-editor/react';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

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
          const docUrl = resolveHyphaUrl(selectedResource.manifest.documentation, selectedResource.id);
          
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

  if (isLoading) {
    // Centered loading indicator
    return (
      <Box 
        sx={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          minHeight: 'calc(100vh - 200px)', // Adjust height as needed
          width: '100%' 
        }}
      >
        <CircularProgress />
        <Typography variant="h6" gutterBottom>Loading Artifact Details...</Typography>
      </Box>
    );
  }

  if (error) {
    return <div className="error">Error: {error}</div>;
  }

  if (!selectedResource) {
    return <div>Artifact not found</div>;
  }
  console.log("Current artifact:", selectedResource, "version:", version);

  const { manifest } = selectedResource as ArtifactInfo;

  return (
    <Box sx={{ p: 1, maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header Section */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" gutterBottom>
        {manifest.id_emoji} {manifest.name} 
        </Typography>
        <Typography variant="subtitle1" color="text.secondary" gutterBottom className="flex items-center gap-2">
          <span>ID: </span>
          <code className="bg-gray-100 px-2 py-0.5 rounded select-all">
            {selectedResource.id.split('/').pop()}
          </code>
          <div className="flex items-center gap-2">
            <IconButton
              onClick={handleCopyId}
              size="small"
              title="Copy ID"
              sx={{ 
                padding: '4px',
                '&:hover': { backgroundColor: 'rgba(0, 0, 0, 0.04)' }
              }}
            >
              <ContentCopyIcon sx={{ fontSize: 16 }} />
            </IconButton>
            {showCopied && (
              <span className="text-green-600 text-sm animate-fade-in">
                Copied!
              </span>
            )}
          </div>
        </Typography>
        <Typography variant="body1" sx={{ mb: 2 }}>{manifest.description}</Typography>
        
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <Button
            onClick={handleDownload}
            startIcon={<DownloadIcon />}
            variant="contained"
            size="medium"
            sx={{
              backgroundColor: '#2563eb',
              '&:hover': {
                backgroundColor: '#1d4ed8',
              },
            }}
          >
            Download
          </Button>
          <Button
            onClick={handleViewSource}
            startIcon={<CodeIcon />}
            variant="outlined"
            size="medium"
          >
            View Source
          </Button>
          {selectedResource?.manifest?.type === 'model' && (
            <>
              <ModelTester
                artifactId={selectedResource.id}
                modelUrl={`https://hypha.aicell.io/bioimage-io/artifacts/${selectedResource.id.split("/").pop()}/create-zip-file${version && version !== 'latest' ? `?version=${version}` : ''}`}
              />
              <ModelRunner
                artifactId={selectedResource.id}
                isDisabled={false}
                onRunStateChange={setShowModelRunner}
                createContainerCallback={createModelRunnerContainer}
              />
            </>
          )}
          {latestVersion && (
            <Chip 
              icon={<UpdateIcon />} 
              label={`Version: ${latestVersion.version}`}
              sx={{ ml: 2 }} 
            />
          )}
        </Box>
      </Box>

      {/* Cover Image Section or Model Runner Container */}
      {selectedResource.manifest.covers && selectedResource.manifest.covers.length > 0 && (
        <Box 
          sx={{ 
            position: 'relative',
            width: '100%',
            height: containerHeight,
            mb: 3,
            borderRadius: 1,
            overflow: 'hidden',
            backgroundColor: '#f5f5f5',
            transition: 'height 0.3s ease-in-out',
            border: showModelRunner ? '1px solid #1976d2' : 'none'
          }}
          data-cover-container="true"
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
                  objectFit: 'contain'
                }}
              />
              {selectedResource.manifest.covers.length > 1 && (
                <>
                  <IconButton
                    onClick={previousImage}
                    sx={{
                      position: 'absolute',
                      left: 8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      backgroundColor: 'rgba(255, 255, 255, 0.8)',
                      '&:hover': {
                        backgroundColor: 'rgba(255, 255, 255, 0.9)',
                      }
                    }}
                  >
                    <NavigateBeforeIcon />
                  </IconButton>
                  <IconButton
                    onClick={nextImage}
                    sx={{
                      position: 'absolute',
                      right: 8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      backgroundColor: 'rgba(255, 255, 255, 0.8)',
                      '&:hover': {
                        backgroundColor: 'rgba(255, 255, 255, 0.9)',
                      }
                    }}
                  >
                    <NavigateNextIcon />
                  </IconButton>
                  <Box
                    sx={{
                      position: 'absolute',
                      bottom: 8,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      backgroundColor: 'rgba(0, 0, 0, 0.5)',
                      color: 'white',
                      padding: '4px 8px',
                      borderRadius: 1,
                      fontSize: '0.875rem'
                    }}
                  >
                    {currentImageIndex + 1} / {selectedResource.manifest.covers.length}
                  </Box>
                </>
              )}
            </>
          )}
        </Box>
      )}

      <Grid container spacing={3}>
        {/* Left Column - Documentation */}
        <Grid item xs={12} md={8}>
          {/* Documentation Card */}
          {documentation && (
            <Card sx={{ mb: 3, height: '100%' }}>
              <CardContent>
                <Box 
                  sx={{ 
                    padding: '45px',
                    '& pre': {
                      maxWidth: '100%',
                      overflow: 'auto'
                    },
                    '& img': {
                      maxWidth: '100%',
                      height: 'auto'
                    }
                  }}
                >
                  <ReactMarkdown 
                    className="markdown-body"
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
          {/* Add Versions Card here */}
          {selectedResource.versions && selectedResource.versions.length > 0 && (
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
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
                              '&:hover': {
                                textDecoration: 'underline'
                              }
                            }}
                          >
                            {version.version}
                          </Typography>
                        </RouterLink>
                        {version.version === latestVersion?.version && (
                          <Chip label="Latest" color="primary" size="small" />
                        )}
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {formatTimestamp(version.created_at)}
                      </Typography>
                      {version.comment && (
                        <Typography variant="body2" sx={{ mt: 0.5 }}>
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

          {/* Authors Card - Moved from left column */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                <PersonIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                Authors
              </Typography>
              {manifest.authors?.map((author, index) => (
                <Box key={index} sx={{ mb: 2 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
                    {author.name}
                  </Typography>
                  {author.orcid && (
                    <Link 
                      href={`https://orcid.org/${author.orcid}`}
                      target="_blank"
                      sx={{ 
                        display: 'inline-block',
                        fontSize: '0.875rem',
                        mb: 0.5 
                      }}
                    >
                      ORCID: {author.orcid}
                    </Link>
                  )}
                  {author.affiliation && (
                    <Typography variant="body2" color="text.secondary">
                      <SchoolIcon sx={{ fontSize: 'small', mr: 0.5, verticalAlign: 'middle' }} />
                      {author.affiliation}
                    </Typography>
                  )}
                  {index < (manifest.authors?.length || 0) - 1 && <Divider sx={{ my: 2 }} />}
                </Box>
              ))}
            </CardContent>
          </Card>

          {/* Statistics Card - New */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
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
                    '&:hover': {
                      backgroundColor: 'rgba(25, 118, 210, 0.08)'
                    }
                  }}
                />
                <Chip 
                  icon={<VisibilityIcon />} 
                  label={`Views: ${selectedResource.view_count}`}
                  sx={{ justifyContent: 'flex-start' }}
                />
              </Stack>
              
              {showDownloadInfo && (
                <Box sx={{ mt: 2, p: 2, backgroundColor: 'rgba(25, 118, 210, 0.04)', borderRadius: 1 }}>
                  <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
                    How Download Count is Calculated:
                  </Typography>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    Each file has a download weight: manifest files have weight 0, model weight files have weight 1.0. 
                    When individual weight files are downloaded, the count increases by 1 per weight file. 
                    When the complete model package is downloaded as a zip file, the count increases by 1 only when the entire zip is successfully downloaded.
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    <strong>Note:</strong> Downloads with URL query parameter <code>silent=true</code> (e.g., CI scripts) do not increase the download count.
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>

          {/* Citations Card */}
          {manifest.cite && manifest.cite.length > 0 && (
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Citations
                </Typography>
                <Stack spacing={2}>
                  {manifest.cite.map((citation, index) => (
                    <Box key={index}>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        {citation.text}
                      </Typography>
                      {citation.doi && (
                        <Link 
                          href={`https://doi.org/${citation.doi}`}
                          target="_blank"
                          sx={{ 
                            display: 'inline-block',
                            fontSize: '0.875rem'
                          }}
                        >
                          DOI: {citation.doi}
                        </Link>
                      )}
                      {index < (manifest.cite?.length || 0) - 1 && <Divider sx={{ my: 2 }} />}
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          )}

          {/* Tags Card */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                <LocalOfferIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                Tags
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {manifest.tags?.map((tag, index) => (
                  <Chip key={index} label={tag} size="small" />
                ))}
              </Box>
            </CardContent>
          </Card>

          {/* Links Card */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                <LinkIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                Links
              </Typography>
              <Stack spacing={1}>
                {manifest.git_repo && (
                  <Link href={manifest.git_repo} target="_blank">
                    GitHub Repository
                  </Link>
                )}
              </Stack>
            </CardContent>
          </Card>

          {/* License Card */}
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>License</Typography>
              <Typography variant="body1">{manifest.license}</Typography>
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
  );
};

export default ArtifactDetails; 