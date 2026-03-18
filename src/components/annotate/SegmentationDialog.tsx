import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from '@mui/material';

interface SegmentationDialogProps {
  open: boolean;
  maskCount: number;
  onAccept: () => void;
  onDiscard: () => void;
}

const SegmentationDialog: React.FC<SegmentationDialogProps> = ({
  open,
  maskCount,
  onAccept,
  onDiscard,
}) => {
  return (
    <Dialog open={open} onClose={onDiscard}>
      <DialogTitle>Segmentation Result</DialogTitle>
      <DialogContent>
        <DialogContentText>
          {maskCount > 0
            ? `Cellpose returned ${maskCount} mask${maskCount !== 1 ? 's' : ''}. Do you want to add them to your annotation?`
            : 'Cellpose did not return any masks.'}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onDiscard} color="inherit">
          Discard
        </Button>
        {maskCount > 0 && (
          <Button onClick={onAccept} variant="contained" color="primary">
            Accept
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default SegmentationDialog;
