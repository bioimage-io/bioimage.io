import { Dialog, DialogTitle, DialogContent, IconButton, Box, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { ArtifactInfo } from '../types/artifact';
import ArtifactDetails from './ArtifactDetails';

interface PreviewDialogProps {
  open: boolean;
  artifact: ArtifactInfo;
  onClose: () => void;
}

export const PreviewDialog = ({ open, artifact, onClose }: PreviewDialogProps) => {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      PaperProps={{
        sx: {
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.5)',
          borderRadius: '16px',
          height: '90vh',
          maxHeight: '1200px',
        }
      }}
    >
      <DialogTitle 
        sx={{ 
          m: 0, 
          p: 3, 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          borderBottom: '1px solid rgba(255, 255, 255, 0.3)',
        }}
      >
        <Typography variant="h5" sx={{ fontWeight: 300, color: '#1f2937' }}>
          {artifact.manifest.name}
        </Typography>
        <IconButton
          onClick={onClose}
          aria-label="close"
          sx={{
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: '12px',
            color: '#dc2626',
            '&:hover': {
              backgroundColor: 'rgba(239, 68, 68, 0.2)',
            },
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ overflowY: 'auto', p: 0 }}>
        <Box sx={{ p: 3 }}>
          <ArtifactDetails />
        </Box>
      </DialogContent>
    </Dialog>
  );
}; 