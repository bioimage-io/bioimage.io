import React from 'react';
import {
  IconButton,
  Tooltip,
  Paper,
  Divider,
  Badge,
  Box,
} from '@mui/material';
import OpenWithIcon from '@mui/icons-material/OpenWith';
import NearMeIcon from '@mui/icons-material/NearMe';
import HexagonOutlinedIcon from '@mui/icons-material/HexagonOutlined';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import AutoFixOffIcon from '@mui/icons-material/AutoFixOff';
import PsychologyIcon from '@mui/icons-material/Psychology';
import TuneIcon from '@mui/icons-material/Tune';
import SaveIcon from '@mui/icons-material/Save';
import UndoIcon from '@mui/icons-material/Undo';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import ContrastIcon from '@mui/icons-material/Contrast';
import FilterListIcon from '@mui/icons-material/FilterList';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { useAnnotationStore, AnnotationTool } from '../../store/annotationStore';

interface ToolDef {
  id: AnnotationTool;
  label: string;
  icon: React.ReactNode;
}

const tools: ToolDef[] = [
  { id: 'move', label: 'Move', icon: <OpenWithIcon /> },
  { id: 'select', label: 'Select (drag rect, Del to delete)', icon: <NearMeIcon /> },
  { id: 'polygon', label: 'Draw Mask', icon: <HexagonOutlinedIcon /> },
  { id: 'cutter', label: 'Cut Mask', icon: <ContentCutIcon /> },
  { id: 'eraser', label: 'Eraser', icon: <AutoFixOffIcon /> },
];

interface ToolBarProps {
  onRunCellpose: () => void;
  onOpenCellposeConfig: () => void;
  onSave: () => void;
  onUndo: () => void;
  onResetView: () => void;
  onClearAll: () => void;
  onToggleCLAHE: () => void;
  onOpenMaskFilter: () => void;
  onHelp: () => void;
  isSaving: boolean;
  isRunningCellpose: boolean;
  isCLAHEActive: boolean;
  hasCustomCellposeConfig: boolean;
}

const ToolBar: React.FC<ToolBarProps> = ({
  onRunCellpose, onOpenCellposeConfig, onSave, onUndo, onResetView,
  onClearAll, onToggleCLAHE, onOpenMaskFilter, onHelp,
  isSaving, isRunningCellpose, isCLAHEActive, hasCustomCellposeConfig,
}) => {
  const activeTool = useAnnotationStore((s) => s.activeTool);
  const setActiveTool = useAnnotationStore((s) => s.setActiveTool);
  const canUndo = useAnnotationStore((s) => s.canUndo);

  return (
    <Paper
      elevation={2}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        py: 1,
        px: 0.5,
        gap: 0.5,
        borderRadius: 0,
        width: 52,
        flexShrink: 0,
      }}
    >
      {tools.map((tool) => (
        <Tooltip key={tool.id} title={tool.label} placement="right">
          <IconButton
            size="small"
            color={activeTool === tool.id ? 'primary' : 'default'}
            onClick={() => setActiveTool(tool.id)}
            sx={{
              bgcolor: activeTool === tool.id ? 'action.selected' : 'transparent',
              borderRadius: 1,
            }}
          >
            {tool.icon}
          </IconButton>
        </Tooltip>
      ))}

      <Divider flexItem sx={{ my: 0.5 }} />

      <Tooltip title="Undo (Ctrl+Z)" placement="right">
        <span>
          <IconButton size="small" onClick={onUndo} disabled={!canUndo}>
            <UndoIcon />
          </IconButton>
        </span>
      </Tooltip>

      <Tooltip title="Clear All Annotations" placement="right">
        <IconButton size="small" onClick={onClearAll} color="error">
          <DeleteSweepIcon />
        </IconButton>
      </Tooltip>

      <Tooltip title="Filter Masks by Area" placement="right">
        <IconButton size="small" onClick={onOpenMaskFilter}>
          <FilterListIcon />
        </IconButton>
      </Tooltip>

      <Tooltip title="Fit to Image" placement="right">
        <IconButton size="small" onClick={onResetView}>
          <CenterFocusStrongIcon />
        </IconButton>
      </Tooltip>

      <Divider flexItem sx={{ my: 0.5 }} />

      <Tooltip title={isCLAHEActive ? 'Restore Original Image' : 'Contrast Enhancement (CLAHE)'} placement="right">
        <IconButton size="small" onClick={onToggleCLAHE} color={isCLAHEActive ? 'primary' : 'default'}>
          <ContrastIcon />
        </IconButton>
      </Tooltip>

      <Divider flexItem sx={{ my: 0.5 }} />

      <Tooltip title="Run AI Segmentation" placement="right">
        <span>
          <IconButton size="small" onClick={onRunCellpose} color="secondary" disabled={isRunningCellpose}>
            <PsychologyIcon />
          </IconButton>
        </span>
      </Tooltip>

      <Tooltip title="AI Segmentation Settings" placement="right">
        <IconButton size="small" onClick={onOpenCellposeConfig}>
          <Badge variant="dot" color="warning" invisible={!hasCustomCellposeConfig}>
            <TuneIcon fontSize="small" />
          </Badge>
        </IconButton>
      </Tooltip>

      <Divider flexItem sx={{ my: 0.5 }} />

      <Tooltip title="Save Annotation" placement="right">
        <IconButton size="small" onClick={onSave} disabled={isSaving} color="success">
          <SaveIcon />
        </IconButton>
      </Tooltip>

      <Box sx={{ flex: 1 }} />

      <Tooltip title="Help" placement="right">
        <IconButton size="small" onClick={onHelp}>
          <HelpOutlineIcon />
        </IconButton>
      </Tooltip>
    </Paper>
  );
};

export default ToolBar;
