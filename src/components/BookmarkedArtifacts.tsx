import React from 'react';
import { Box, Typography, Grid, CircularProgress } from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import { useBookmarks } from '../hooks/useBookmarks';
import { useHyphaStore } from '../store/hyphaStore';
import { ArtifactCard } from './ArtifactCard';
import { ArtifactInfo } from '../types/artifact';

interface BookmarkedArtifactsProps {
  searchQuery?: string;
}

export const BookmarkedArtifacts: React.FC<BookmarkedArtifactsProps> = ({ searchQuery = '' }) => {
  const { artifactManager } = useHyphaStore();
  const { bookmarks, loading } = useBookmarks(artifactManager);

  // Filter bookmarks based on search query
  const filteredBookmarks = React.useMemo(() => {
    if (!searchQuery.trim()) {
      return bookmarks;
    }

    const query = searchQuery.toLowerCase();
    return bookmarks.filter(bookmark =>
      bookmark.name.toLowerCase().includes(query) ||
      bookmark.description.toLowerCase().includes(query) ||
      bookmark.id.toLowerCase().includes(query)
    );
  }, [bookmarks, searchQuery]);

  // Don't show loading state or empty state - just hide the section completely
  if (loading || bookmarks.length === 0) {
    return null;
  }

  if (filteredBookmarks.length === 0 && searchQuery.trim()) {
    return (
      <Box
        sx={{
          textAlign: 'center',
          py: 8,
          px: 4,
          backgroundColor: 'rgba(255, 255, 255, 0.8)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.5)',
          borderRadius: '16px',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)',
        }}
      >
        <StarIcon sx={{ fontSize: 64, color: 'rgba(251, 191, 36, 0.3)', mb: 2 }} />
        <Typography variant="h6" sx={{ color: '#6b7280', mb: 1 }}>
          No bookmarks match your search
        </Typography>
        <Typography variant="body2" sx={{ color: '#9ca3af' }}>
          Try a different search term
        </Typography>
      </Box>
    );
  }

  // Convert bookmarks to ArtifactInfo format for ArtifactCard
  const bookmarkArtifacts: ArtifactInfo[] = filteredBookmarks.map(bookmark => ({
    id: bookmark.id,
    manifest: {
      name: bookmark.name,
      description: bookmark.description,
      covers: bookmark.covers,
      icon: bookmark.icon,
      type: 'model', // Default type
      tags: [],
      authors: [],
      license: '',
    },
    download_count: 0,
    view_count: 0,
    versions: [],
  }));

  return (
    <Box>
      {/* Section Header - matching My Uploaded Artifacts style */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
          <StarIcon sx={{ fontSize: 32, color: 'rgba(251, 191, 36, 1)' }} />
          <Typography variant="h5" component="h2" sx={{ fontWeight: 300, color: '#1f2937' }}>
            Bookmarked Artifacts
          </Typography>
          <Box
            sx={{
              px: 1.5,
              py: 0.5,
              backgroundColor: 'rgba(251, 191, 36, 0.1)',
              color: 'rgba(251, 191, 36, 1)',
              borderRadius: '12px',
              fontSize: '0.875rem',
              fontWeight: 500,
            }}
          >
            {filteredBookmarks.length} {filteredBookmarks.length === 1 ? 'item' : 'items'}
            {searchQuery.trim() && filteredBookmarks.length < bookmarks.length && (
              <span style={{ opacity: 0.7 }}> (of {bookmarks.length})</span>
            )}
          </Box>
        </Box>
      </Box>

      <Box sx={{ maxWidth: '1536px' }}>
        <Grid container spacing={3}>
          {bookmarkArtifacts.map((artifact) => (
            <Grid item xs={12} sm={6} lg={4} key={artifact.id}>
              <ArtifactCard artifact={artifact} />
            </Grid>
          ))}
        </Grid>
      </Box>
    </Box>
  );
};

export default BookmarkedArtifacts;
