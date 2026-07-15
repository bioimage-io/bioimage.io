import React from 'react';
import { Card, Box, Stack, Skeleton } from '@mui/material';

// Placeholder shown in the resource grid while the first page of results is
// loading. Mirrors ArtifactCard's outer shape (16:9 media + title + two text
// lines + tag chips) so the layout does not shift when real cards replace it.
const ArtifactCardSkeleton: React.FC = () => (
  <Card
    sx={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: 'rgba(255, 255, 255, 0.8)',
      backdropFilter: 'blur(8px)',
      border: '1px solid rgba(229, 231, 235, 0.8)',
      borderRadius: '16px',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)',
    }}
  >
    {/* 16:9 media placeholder */}
    <Box sx={{ position: 'relative', paddingTop: '56.25%', borderRadius: '16px 16px 0 0', overflow: 'hidden' }}>
      <Skeleton
        variant="rectangular"
        animation="pulse"
        sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
      />
    </Box>

    <Box sx={{ p: 2 }}>
      <Skeleton variant="text" animation="pulse" width="70%" height={28} />
      <Skeleton variant="text" animation="pulse" width="95%" height={18} sx={{ mt: 1 }} />
      <Skeleton variant="text" animation="pulse" width="55%" height={18} />
      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
        <Skeleton variant="rounded" animation="pulse" width={54} height={22} />
        <Skeleton variant="rounded" animation="pulse" width={72} height={22} />
      </Stack>
    </Box>
  </Card>
);

export default ArtifactCardSkeleton;
