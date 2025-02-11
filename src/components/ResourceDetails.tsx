import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useHyphaStore } from '../store/hyphaStore';
import ReactMarkdown from 'react-markdown';
import { Button, Box, Typography, Chip, Grid, Card, CardContent, Avatar, Link, Stack, Divider, IconButton } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import SchoolIcon from '@mui/icons-material/School';
import LinkIcon from '@mui/icons-material/Link';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import DownloadIcon from '@mui/icons-material/Download';
import VisibilityIcon from '@mui/icons-material/Visibility';
import UpdateIcon from '@mui/icons-material/Update';
import ModelTester from './ModelTester';
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

const ResourceDetails = () => {
  const { id } = useParams();
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

  useEffect(() => {
    if (id) {
      fetchResource(`bioimage-io/${id}`);
    }
  }, [id, fetchResource]);

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
        }
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
    const id = selectedResource?.id.split('/').pop();
    if (id) {
      window.open(`https://hypha.aicell.io/bioimage-io/artifacts/${id}/create-zip-file`, '_blank');
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

  if (isLoading) {
    return <div className="loading">Loading...</div>;
  }

  if (error) {
    return <div className="error">Error: {error}</div>;
  }

  if (!selectedResource) {
    return <div>Resource not found</div>;
  }

  const { manifest } = selectedResource as ArtifactInfo;

  return (
    <Box sx={{ p: 3, maxWidth: '1200px', margin: '0 auto' }}>
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
            <ModelTester 
              artifactId={selectedResource.id}
              isDisabled={false}
            />
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

      {/* Cover Image Section */}
      {selectedResource.manifest.covers && selectedResource.manifest.covers.length > 0 && (
        <Box 
          sx={{ 
            position: 'relative',
            width: '100%',
            height: '400px',
            mb: 3,
            borderRadius: 1,
            overflow: 'hidden',
            backgroundColor: '#f5f5f5'
          }}
        >
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
                  <ReactMarkdown className="markdown-body">{documentation}</ReactMarkdown>
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
                        <Typography variant="subtitle2" sx={{ fontWeight: 500 }}>
                          v{version.version}
                        </Typography>
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
                  {index < (manifest.authors?.length ?? 0) - 1 && <Divider sx={{ my: 2 }} />}
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
                  sx={{ justifyContent: 'flex-start' }}
                />
                <Chip 
                  icon={<VisibilityIcon />} 
                  label={`Views: ${selectedResource.view_count}`}
                  sx={{ justifyContent: 'flex-start' }}
                />
              </Stack>
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
                      {index < manifest.cite.length - 1 && <Divider sx={{ my: 2 }} />}
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

export default ResourceDetails; 