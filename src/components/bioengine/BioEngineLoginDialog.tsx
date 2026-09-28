import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { requestLogin } from '../../utils/loginRequest';

/**
 * Shown when a BioEngine worker dashboard is opened without being logged in.
 *
 * Dashboard URLs carry `?service_id=` and get shared and bookmarked, so coming
 * back to one after a session has expired is a completely ordinary thing to do.
 * It used to render a red "Error / Please log in to view BioEngine instances"
 * screen, which tells the user something went wrong when nothing did, and
 * offers no way forward: the only cue was the Login button elsewhere on the
 * page, and the message never said that.
 */

interface BioEngineLoginDialogProps {
  open: boolean;
  /** The worker the link points at, shown so the user knows what they are logging in for. */
  serviceId?: string;
  /** Leave the dashboard instead of logging in. */
  onDismiss: () => void;
}

const BioEngineLoginDialog: React.FC<BioEngineLoginDialogProps> = ({ open, serviceId, onDismiss }) => {
  // `<workspace>/<client-id>:<service>` is unreadable in a sentence. The
  // workspace and the worker name are the parts that identify it to a person.
  const readableWorker = React.useMemo(() => {
    if (!serviceId) return null;
    const [workspace, rest] = serviceId.split('/');
    if (!rest) return serviceId;
    const clientId = rest.split(':')[0];
    return `${workspace} / ${clientId}`;
  }, [serviceId]);

  return (
    <Dialog open={open} onClose={onDismiss} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1 }}>
        <LockOutlinedIcon sx={{ color: '#3b82f6' }} />
        <Typography variant="h6" component="span" sx={{ fontWeight: 500 }}>
          Log in to view this BioEngine worker
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: '#374151', mb: readableWorker ? 2 : 0 }}>
          A worker dashboard shows live status for a specific machine, so it is only available to
          users who have access to it. Log in to continue, or go back to the list of workers.
        </Typography>
        {readableWorker && (
          <Box sx={{ p: 1.5, backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 2 }}>
            <Typography variant="caption" sx={{ color: '#6b7280', display: 'block', mb: 0.25 }}>
              Worker
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {readableWorker}
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button onClick={onDismiss} sx={{ textTransform: 'none', color: '#6b7280' }}>
          Back to workers
        </Button>
        <Button
          onClick={requestLogin}
          variant="contained"
          sx={{ textTransform: 'none', borderRadius: '10px', px: 3 }}
        >
          Log in
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BioEngineLoginDialog;
