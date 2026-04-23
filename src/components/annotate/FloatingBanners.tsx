import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Box, Paper, Typography, CircularProgress, Slide, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';

export interface Banner {
  id: number;
  message: string;
  details?: string; // full error details for info popup
  type: 'info' | 'loading' | 'success' | 'warning' | 'error';
  timeout?: number; // ms, 0 = manual dismiss
}

let nextId = 0;

export function useBanners() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const timersRef = useRef<Map<number, NodeJS.Timeout>>(new Map());

  const removeBanner = useCallback((id: number) => {
    setBanners((prev) => prev.filter((b) => b.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addBanner = useCallback((message: string, type: Banner['type'] = 'info', timeout = 5000, details?: string): number => {
    const id = ++nextId;
    setBanners((prev) => [...prev, { id, message, type, timeout, details }]);
    if (timeout > 0) {
      const timer = setTimeout(() => removeBanner(id), timeout);
      timersRef.current.set(id, timer);
    }
    return id;
  }, [removeBanner]);

  // Cleanup on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  return { banners, addBanner, removeBanner };
}

const typeColors: Record<Banner['type'], string> = {
  info: '#1976d2',
  loading: '#1976d2',
  success: '#2e7d32',
  warning: '#ed6c02',
  error: '#d32f2f',
};

const TypeIcon: React.FC<{ type: Banner['type'] }> = ({ type }) => {
  switch (type) {
    case 'loading':
      return <CircularProgress size={16} sx={{ color: '#fff' }} />;
    case 'success':
      return <CheckCircleOutlineIcon sx={{ fontSize: 18, color: '#fff' }} />;
    case 'error':
      return <ErrorOutlineIcon sx={{ fontSize: 18, color: '#fff' }} />;
    case 'warning':
      return <ErrorOutlineIcon sx={{ fontSize: 18, color: '#fff' }} />;
    default:
      return <InfoOutlinedIcon sx={{ fontSize: 18, color: '#fff' }} />;
  }
};

interface FloatingBannersProps {
  banners: Banner[];
}

const FloatingBanners: React.FC<FloatingBannersProps> = ({ banners }) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsContent, setDetailsContent] = useState({ title: '', body: '' });

  const handleShowDetails = (banner: Banner) => {
    setDetailsContent({
      title: banner.message,
      body: banner.details || banner.message,
    });
    setDetailsOpen(true);
  };

  return (
    <>
      <Box
        sx={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 1200,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          pointerEvents: 'none',
          // On phones, banners stretch near full width; on desktop cap at 360px
          maxWidth: { xs: 'calc(100% - 16px)', sm: 360 },
          width: { xs: 'calc(100% - 16px)', sm: 'auto' },
        }}
      >
        {banners.map((banner) => (
          <Slide key={banner.id} direction="left" in mountOnEnter unmountOnExit>
            <Paper
              elevation={4}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 2,
                py: 1,
                bgcolor: typeColors[banner.type],
                color: '#fff',
                borderRadius: 1.5,
                pointerEvents: 'auto',
              }}
            >
              <TypeIcon type={banner.type} />
              <Typography variant="body2" sx={{ fontWeight: 500, flex: 1 }}>
                {banner.message}
              </Typography>
              {banner.details && (
                <IconButton
                  size="small"
                  onClick={() => handleShowDetails(banner)}
                  sx={{ color: '#fff', p: 0.5, ml: 0.5 }}
                >
                  <DescriptionOutlinedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              )}
            </Paper>
          </Slide>
        ))}
      </Box>

      <Dialog open={detailsOpen} onClose={() => setDetailsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{detailsContent.title}</DialogTitle>
        <DialogContent>
          <Typography
            variant="body2"
            component="pre"
            sx={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              bgcolor: '#f5f5f5',
              p: 2,
              borderRadius: 1,
              maxHeight: 400,
              overflow: 'auto',
            }}
          >
            {detailsContent.body}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default FloatingBanners;
