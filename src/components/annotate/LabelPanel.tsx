import React from 'react';
import { Paper, List, ListItemButton, ListItemText, Typography, Box } from '@mui/material';
import { useAnnotationStore } from '../../store/annotationStore';

const LabelPanel: React.FC = () => {
  const labels = useAnnotationStore((s) => s.labels);
  const activeLabel = useAnnotationStore((s) => s.activeLabel);
  const setActiveLabel = useAnnotationStore((s) => s.setActiveLabel);

  return (
    <Paper
      elevation={2}
      sx={{
        width: 180,
        flexShrink: 0,
        borderRadius: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
      }}
    >
      <Typography variant="subtitle2" sx={{ px: 1.5, pt: 1.5, pb: 0.5, fontWeight: 600 }}>
        Labels
      </Typography>
      <List dense disablePadding>
        {labels.map((label) => (
          <ListItemButton
            key={label.id}
            selected={activeLabel.id === label.id}
            onClick={() => setActiveLabel(label)}
            sx={{ py: 0.5, px: 1.5 }}
          >
            <Box
              sx={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                bgcolor: label.color,
                mr: 1,
                flexShrink: 0,
                border: '2px solid',
                borderColor: activeLabel.id === label.id ? 'text.primary' : 'transparent',
              }}
            />
            <ListItemText
              primary={label.name}
              primaryTypographyProps={{ variant: 'body2' }}
            />
          </ListItemButton>
        ))}
      </List>
    </Paper>
  );
};

export default LabelPanel;
