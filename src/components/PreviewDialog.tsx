import { Dialog, DialogTitle, DialogContent, IconButton, Box } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { Artifact } from '../types';
import ArtifactDetails from './ArtifactDetails';

interface PreviewDialogProps {
  open: boolean;
  artifact: Artifact;
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
          height: '90vh',
          maxHeight: '1200px'
        }
      }}
    >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>{artifact.manifest.name}</h2>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ overflowY: 'auto' }}>
        <Box sx={{ p: 2 }}>
          <ArtifactDetails />
        </Box>
      </DialogContent>
    </Dialog>
  );
}; 