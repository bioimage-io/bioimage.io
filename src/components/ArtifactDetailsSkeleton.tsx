import React from 'react';
import { Box, Grid, Stack, Skeleton } from '@mui/material';

// Placeholder shown while a single artifact's details load. Mirrors the
// ArtifactDetails layout (header card + main content column + metadata sidebar)
// so the page fills in place instead of blanking behind a spinner.
const cardSx = {
  backgroundColor: 'rgba(255, 255, 255, 0.8)',
  backdropFilter: 'blur(8px)',
  border: '1px solid rgba(255, 255, 255, 0.5)',
  borderRadius: { xs: '8px', sm: '12px', md: '16px' },
  boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)',
};

const paragraphWidths = ['95%', '88%', '92%', '80%', '90%', '60%'];

const ArtifactDetailsSkeleton: React.FC = () => (
  <div className="container-safe">
    <div className="max-w-[1400px] mx-auto px-2 sm:px-4 md:px-4 lg:px-4">
      <Box sx={{ p: { xs: 1, sm: 1, md: 2 }, maxWidth: '100%', width: '100%' }}>
        {/* Header */}
        <Box sx={{ mb: { xs: 1, sm: 2, md: 4 }, p: { xs: 1, sm: 2, md: 4 }, ...cardSx }}>
          <Skeleton variant="text" animation="pulse" width="45%" height={44} />
          <Skeleton variant="text" animation="pulse" width={260} height={28} sx={{ mt: 1 }} />
          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Skeleton variant="rounded" animation="pulse" width={90} height={30} />
            <Skeleton variant="rounded" animation="pulse" width={90} height={30} />
            <Skeleton variant="rounded" animation="pulse" width={120} height={30} />
          </Stack>
        </Box>

        {/* Body: main content + metadata sidebar */}
        <Grid container spacing={2}>
          <Grid item xs={12} md={8}>
            <Box sx={{ p: { xs: 1, sm: 2, md: 3 }, ...cardSx }}>
              <Skeleton
                variant="rounded"
                animation="pulse"
                sx={{ width: '100%', height: { xs: 200, sm: 300, md: 360 } }}
              />
              <Box sx={{ mt: 2 }}>
                {paragraphWidths.map((w, i) => (
                  <Skeleton key={i} variant="text" animation="pulse" width={w} height={20} />
                ))}
              </Box>
            </Box>
          </Grid>
          <Grid item xs={12} md={4}>
            <Box sx={{ p: { xs: 1, sm: 2, md: 3 }, ...cardSx }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <Box key={i} sx={{ mb: 2 }}>
                  <Skeleton variant="text" animation="pulse" width="40%" height={16} />
                  <Skeleton variant="text" animation="pulse" width="75%" height={22} />
                </Box>
              ))}
            </Box>
          </Grid>
        </Grid>
      </Box>
    </div>
  </div>
);

export default ArtifactDetailsSkeleton;
