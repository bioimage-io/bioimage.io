import React from 'react';
import {
  IconButton,
  Tooltip,
  Paper,
  Divider,
  Badge,
  Box,
  SvgIcon,
} from '@mui/material';
import OpenWithIcon from '@mui/icons-material/OpenWith';
import NearMeIcon from '@mui/icons-material/NearMe';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import AutoFixOffIcon from '@mui/icons-material/AutoFixOff';
import SaveIcon from '@mui/icons-material/Save';
import UndoIcon from '@mui/icons-material/Undo';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import ContrastIcon from '@mui/icons-material/Contrast';
import FilterListIcon from '@mui/icons-material/FilterList';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { useAnnotationStore, AnnotationTool } from '../../store/annotationStore';

/** Lasso icon (same shape as AI lasso but without sparkles) */
const LassoIcon: React.FC = () => (
  <SvgIcon viewBox="0 0 24 24">
    <path d="M11 4C6.6 4 3 6.7 3 10c0 2.2 1.4 4.1 3.5 5.3V17c0 .8.5 1.5 1.2 1.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <ellipse cx="11" cy="10" rx="7.5" ry="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
  </SvgIcon>
);

/** Lasso icon with sparkle stars (AI) */
const LassoAIIcon: React.FC = () => (
  <SvgIcon viewBox="0 0 24 24">
    <path d="M11 4C6.6 4 3 6.7 3 10c0 2.2 1.4 4.1 3.5 5.3V17c0 .8.5 1.5 1.2 1.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <ellipse cx="11" cy="10" rx="7.5" ry="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="M20 3l.7 1.3L22 5l-1.3.7L20 7l-.7-1.3L18 5l1.3-.7z" fill="currentColor" />
    <path d="M21 11l.5.9.9.5-.9.5-.5.9-.5-.9-.9-.5.9-.5z" fill="currentColor" />
    <path d="M16.5 1.5l.4.7.7.4-.7.4-.4.7-.4-.7-.7-.4.7-.4z" fill="currentColor" />
  </SvgIcon>
);

interface ToolDef {
  id: AnnotationTool;
  label: string;
  icon: React.ReactNode;
}

const tools: ToolDef[] = [
  { id: 'move', label: 'Move', icon: <OpenWithIcon /> },
  { id: 'select', label: 'Select (click, Shift/Ctrl for multi, Del to delete)', icon: <NearMeIcon /> },
  { id: 'polygon', label: 'Draw Mask (Lasso)', icon: <LassoIcon /> },
  { id: 'cutter', label: 'Cut Mask', icon: <ContentCutIcon /> },
  { id: 'eraser', label: 'Eraser', icon: <AutoFixOffIcon /> },
];

interface ToolBarProps {
  onRunCellpose?: () => void;
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
  onOpenCellposeConfig, onSave, onUndo, onResetView,
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
        <React.Fragment key={tool.id}>
          <Tooltip title={tool.label} placement="right">
            <IconButton
              size="small"
              data-tool={tool.id}
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
          {/* Place AI segmentation right after draw mask */}
          {tool.id === 'polygon' && (
            <Tooltip title="AI Segmentation (Cellpose)" placement="right">
              <span>
                <IconButton
                  size="small"
                  data-tool="cellpose"
                  onClick={onOpenCellposeConfig}
                  color="secondary"
                  disabled={isRunningCellpose}
                >
                  <Badge variant="dot" color="warning" invisible={!hasCustomCellposeConfig}>
                    <LassoAIIcon />
                  </Badge>
                </IconButton>
              </span>
            </Tooltip>
          )}
        </React.Fragment>
      ))}

      <Divider flexItem sx={{ my: 0.5 }} />

      <Tooltip title="Undo (Ctrl+Z)" placement="right">
        <span>
          <IconButton size="small" data-tool="undo" onClick={onUndo} disabled={!canUndo}>
            <UndoIcon />
          </IconButton>
        </span>
      </Tooltip>

      <Tooltip title="Clear All Annotations" placement="right">
        <IconButton size="small" data-tool="clear" onClick={onClearAll} color="error">
          <DeleteSweepIcon />
        </IconButton>
      </Tooltip>

      <Tooltip title="Filter Masks by Area" placement="right">
        <IconButton size="small" data-tool="filter" onClick={onOpenMaskFilter}>
          <FilterListIcon />
        </IconButton>
      </Tooltip>

      <Tooltip title="Fit to Image" placement="right">
        <IconButton size="small" data-tool="fit" onClick={onResetView}>
          <CenterFocusStrongIcon />
        </IconButton>
      </Tooltip>

      <Divider flexItem sx={{ my: 0.5 }} />

      <Tooltip title={isCLAHEActive ? 'Restore Original Image' : 'Contrast Enhancement (CLAHE)'} placement="right">
        <IconButton size="small" data-tool="clahe" onClick={onToggleCLAHE} color={isCLAHEActive ? 'primary' : 'default'}>
          <ContrastIcon />
        </IconButton>
      </Tooltip>

      <Divider flexItem sx={{ my: 0.5 }} />

      <Tooltip title="Save Annotation" placement="right">
        <IconButton size="small" data-tool="save" onClick={onSave} disabled={isSaving} color="success">
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
