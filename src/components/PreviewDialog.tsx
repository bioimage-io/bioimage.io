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
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          height: '90vh',
          maxHeight: '1200px',
        }
      }}
      BackdropProps={{
        sx: {
           backgroundColor: 'rgba(0, 0, 0, 0.5)',
           backdropFilter: 'blur(2px)',
        }
      }}
    >
      <DialogTitle 
        sx={{ 
          m: 0, 
          p: 2, 
          pl: 3,
          pr: 3,
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          borderBottom: '1px solid #e5e7eb',
        }}
      >
        <Typography variant="h6" component="div" sx={{ fontWeight: 600, color: '#111827' }}>
          {artifact.manifest.name}
        </Typography>
        <IconButton
          onClick={onClose}
          aria-label="close"
          sx={{
            color: '#6b7280',
            border: '1px solid transparent',
            '&:hover': {
              color: '#ef4444',
              backgroundColor: '#fee2e2',
              borderColor: '#fecaca',
            },
            borderRadius: '8px',
            padding: '6px'
          }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ overflowY: 'auto', p: 0 }}>
        <Box sx={{ p: 0 }}>
          <ArtifactDetails />
        </Box>
      </DialogContent>
    </Dialog>
  );
};