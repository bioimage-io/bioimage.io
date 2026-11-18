import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { requestLogin } from '../../utils/loginRequest';
import CopyableValue from './CopyableValue';

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
  // Split `<workspace>/<client-id>:<service>` into its two meaningful halves and
  // label each, rather than reprinting the raw id. Shown the same way as the
  // dashboard's own Service Information box, so the identifiers a user needs for
  // a CLI or an agent prompt read the same in both places and copy the same way.
  const worker = React.useMemo(() => {
    if (!serviceId) return null;
    const slash = serviceId.indexOf('/');
    if (slash === -1) return { workspace: null, clientId: serviceId };
    const rest = serviceId.slice(slash + 1);
    const colon = rest.indexOf(':');
    return {
      workspace: serviceId.slice(0, slash),
      clientId: colon === -1 ? rest : rest.slice(0, colon),
    };
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
        <Typography variant="body2" sx={{ color: '#374151', mb: worker ? 2 : 0 }}>
          A worker dashboard shows live status for a specific machine, so it is only available to
          users who have access to it. Log in to continue, or go back to the list of workers.
        </Typography>
        {worker && (
          <Box
            sx={{ p: 1.5, backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 2 }}
            className="space-y-2"
          >
            {worker.workspace && <CopyableValue label="Workspace" value={worker.workspace} />}
            <CopyableValue label="Client ID" value={worker.clientId} />
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
