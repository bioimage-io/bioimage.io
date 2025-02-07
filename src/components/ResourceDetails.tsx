import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useHyphaStore } from '../store/hyphaStore';
import ReactMarkdown from 'react-markdown';
import { Resource } from '../types/resource';
import { Button, Box, Typography, Chip, Grid, Card, CardContent, Avatar, Link, Stack, Divider } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import SchoolIcon from '@mui/icons-material/School';
import LinkIcon from '@mui/icons-material/Link';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import DownloadIcon from '@mui/icons-material/Download';
import VisibilityIcon from '@mui/icons-material/Visibility';
import UpdateIcon from '@mui/icons-material/Update';
import ModelTester from './ModelTester';

const ResourceDetails = () => {
  const { id } = useParams();
  const { selectedResource, fetchResource, isLoading, error } = useHyphaStore();
  const [documentation, setDocumentation] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      fetchResource(`bioimage-io/${id}`);
    }
  }, [id, fetchResource]);

  useEffect(() => {
    const fetchDocumentation = async () => {
      if (selectedResource?.manifest.documentation) {
        const id = selectedResource.id.split('/').pop();
        const docUrl = `https://hypha.aicell.io/bioimage-io/artifacts/${id}/files/${selectedResource.manifest.documentation}?use_proxy=true`;
        try {
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

  const handleDownload = () => {
    const id = selectedResource?.id.split('/').pop();
    if (id) {
      window.open(`https://hypha.aicell.io/bioimage-io/artifacts/${id}/create-zip-file`, '_blank');
    }
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

  const { manifest } = selectedResource as Resource;

  return (
    <Box sx={{ p: 3, maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header Section */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" gutterBottom>
        {manifest.id_emoji} {manifest.name} 
        </Typography>
        <Typography variant="subtitle1" color="text.secondary" gutterBottom>
          ID: {selectedResource.id}
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
          <ModelTester 
                artifactId={selectedResource.id}
                version={manifest.version}
                isDisabled={!selectedResource.manifest.type?.includes('model')}
              />
          {manifest.version && (
            <Chip 
              icon={<UpdateIcon />} 
              label={`Version: ${manifest.version}`}
              sx={{ ml: 2 }} 
            />
          )}
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* Left Column - Documentation */}
        <Grid item xs={12} md={8}>
          {/* Documentation Card */}
          {documentation && (
            <Card sx={{ mb: 3 }}>
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

          {/* Authors Card - Moved from left column */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                <PersonIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                Authors
              </Typography>
              {manifest.authors.map((author, index) => (
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
                  {index < manifest.authors.length - 1 && <Divider sx={{ my: 2 }} />}
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


          {/* Citations Card - Moved from left column */}
          {manifest.cite && manifest.cite.length > 0 && (
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>Citations</Typography>
                {manifest.cite.map((citation, index) => (
                  <Box key={index} sx={{ mb: 2 }}>
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
                {manifest.tags.map((tag, index) => (
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
                {manifest.documentation && (
                  <Link href={manifest.documentation} target="_blank">
                    Documentation
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
    </Box>
  );
};

export default ResourceDetails; 