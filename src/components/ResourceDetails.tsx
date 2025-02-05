import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useHyphaStore } from '../store/hyphaStore';
import ReactMarkdown from 'react-markdown';
import { Resource } from '../types/resource';
import { Button, Box, Typography, Chip, Grid, Card, CardContent, Avatar, Link, Stack, Divider } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import SchoolIcon from '@mui/icons-material/School';
import DescriptionIcon from '@mui/icons-material/Description';
import LinkIcon from '@mui/icons-material/Link';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import DownloadIcon from '@mui/icons-material/Download';
import VisibilityIcon from '@mui/icons-material/Visibility';
import UpdateIcon from '@mui/icons-material/Update';

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
        const docUrl = `https://hypha.aicell.io/bioimage-io/artifacts/${id}/files/${selectedResource.manifest.documentation}`;
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
      window.open(`http://hypha.aicell.io/bioimage-io/artifacts/${id}/create-zip-file`, '_blank');
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
      {/* Header Section with Flexbox for button alignment */}
      <Box sx={{ 
        mb: 4,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start'  // Aligns items to the top
      }}>
        {/* Title and Stats Column */}
        <Box>
          <Typography variant="h4" gutterBottom>
            {manifest.name} {manifest.id_emoji}
          </Typography>
          <Typography variant="subtitle1" color="text.secondary" gutterBottom>
            ID: {selectedResource.id}
          </Typography>
          
          <Stack direction="row" spacing={3} sx={{ mt: 2 }}>
            <Chip icon={<DownloadIcon />} label={`Downloads: ${selectedResource.download_count}`} />
            <Chip icon={<VisibilityIcon />} label={`Views: ${selectedResource.view_count}`} />
            {manifest.version && <Chip icon={<UpdateIcon />} label={`Version: ${manifest.version}`} />}
          </Stack>
        </Box>

        {/* Download Button */}
        <Button
          onClick={handleDownload}
          startIcon={<DownloadIcon />}
          variant="contained"
          size="large"
          sx={{
            minWidth: '200px',
            py: 1.5,
            backgroundColor: '#2563eb',
            '&:hover': {
              backgroundColor: '#1d4ed8',
            },
          }}
        >
          Download Resource
        </Button>
      </Box>

      <Grid container spacing={3}>
        {/* Left Column */}
        <Grid item xs={12} md={8}>
          {/* Description Card */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                <DescriptionIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                Description
              </Typography>
              <Typography variant="body1">{manifest.description}</Typography>
            </CardContent>
          </Card>

          {/* Authors Card */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                <PersonIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                Authors
              </Typography>
              {manifest.authors.map((author, index) => (
                <Box key={index} sx={{ mb: 2 }}>
                  <Typography variant="subtitle1">
                    {author.name}
                    {author.orcid && (
                      <Link 
                        href={`https://orcid.org/${author.orcid}`}
                        target="_blank"
                        sx={{ ml: 1 }}
                      >
                        (ORCID: {author.orcid})
                      </Link>
                    )}
                  </Typography>
                  {author.affiliation && (
                    <Typography variant="body2" color="text.secondary">
                      <SchoolIcon sx={{ fontSize: 'small', mr: 0.5, verticalAlign: 'middle' }} />
                      {author.affiliation}
                    </Typography>
                  )}
                </Box>
              ))}
            </CardContent>
          </Card>

          {/* Citations Card */}
          {manifest.cite && manifest.cite.length > 0 && (
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>Citations</Typography>
                {manifest.cite.map((citation, index) => (
                  <Box key={index} sx={{ mb: 2 }}>
                    <Typography variant="body1">
                      {citation.text}
                      {citation.doi && (
                        <Link 
                          href={`https://doi.org/${citation.doi}`}
                          target="_blank"
                          sx={{ ml: 1 }}
                        >
                          DOI: {citation.doi}
                        </Link>
                      )}
                    </Typography>
                  </Box>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Documentation Card */}
          {documentation && (
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  <DescriptionIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                  Documentation
                </Typography>
                <Box sx={{ 
                  '& .prose': {
                    maxWidth: 'none',
                    '& img': {
                      maxWidth: '100%',
                      height: 'auto'
                    }
                  }
                }}>
                  <ReactMarkdown>{documentation}</ReactMarkdown>
                </Box>
              </CardContent>
            </Card>
          )}
        </Grid>

        {/* Right Column */}
        <Grid item xs={12} md={4}>
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