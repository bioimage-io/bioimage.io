import { Dialog, DialogTitle, DialogContent, IconButton, Box } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { Resource } from '../types';
import ResourceDetails from './ResourceDetails';

interface PreviewDialogProps {
  open: boolean;
  resource: Resource;
  onClose: () => void;
}

export const PreviewDialog = ({ open, resource, onClose }: PreviewDialogProps) => {
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
        <h2>{resource.manifest.name}</h2>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ overflowY: 'auto' }}>
        <Box sx={{ p: 2 }}>
          <ResourceDetails />
        </Box>
      </DialogContent>
    </Dialog>
  );
}; 