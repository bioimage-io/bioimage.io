import React, { useState } from 'react';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import ListSubheader from '@mui/material/ListSubheader';
import TuneIcon from '@mui/icons-material/Tune';
import { Grid, Chip, Divider } from '@mui/material';

interface TagSelectionProps {
  onTagSelect: (tag: string) => void;
}

export const tagCategories = {
  modality: [
    "electron-microscopy",
    "cryo-electron-microscopy",
    "fluorescence-light-microscopy",
    "transmission-light-microscopy",
    "super-resolution-microscopy",
    "x-ray-microscopy",
    "force-microscopy",
    "high-content-imaging",
    "whole-slide-imaging",
  ],
  dims: ["2d", "3d", "2d-t", "3d-t"],
  content: [
    "cells",
    "nuclei",
    "extracellular-vesicles",
    "tissue",
    "plant",
    "mitochondria",
    "vasculature",
    "cell-membrane",
    "brain",
    "whole-organism"
  ],
  framework: ["tensorflow", "pytorch", "tensorflow.js"],
  software: ["ilastik", "imagej", "fiji", "imjoy", "deepimagej", "napari"],
  method: ["stardist", "cellpose", "yolo", "care", "n2v", "denoiseg"],
  network: ["unet", "densenet", "resnet", "inception", "shufflenet"],
  task: [
    "semantic-segmentation",
    "instance-segmentation",
    "object-detection",
    "image-classification",
    "denoising",
    "image-restoration",
    "image-reconstruction",
    "in-silico-labeling"
  ]
};

const TagSelection: React.FC<TagSelectionProps> = ({ onTagSelect }) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleTagClick = (tag: string) => {
    onTagSelect(`${tag}`);
    handleClose();
  };

  return (
    <div>
      <Button
        variant="outlined"
        onClick={handleClick}
        sx={{ 
          minWidth: 'auto',
          padding: '6px 12px',
          height: '40px',
          borderColor: 'divider',
          '&:hover': {
            borderColor: 'text.primary'
          }
        }}
      >
        <TuneIcon fontSize="small" />
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        sx={{ 
          '& .MuiPaper-root': {
            width: 400,
            maxHeight: 600,
          }
        }}
      >
        <div style={{ position: 'relative' }}>
          <div style={{ 
            position: 'sticky', 
            top: 0, 
            backgroundColor: 'white',
            zIndex: 1,
            padding: '16px'
          }}>
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">Filter by Tags</h3>
              <Button 
                size="small" 
                onClick={handleClose}
                sx={{ minWidth: 'auto' }}
              >
                Close
              </Button>
            </div>
            <Divider sx={{ mt: 2 }} />
          </div>

          <div style={{ padding: '16px' }}>
            {Object.entries(tagCategories).map(([category, tags]) => (
              <div key={category} style={{ marginBottom: '24px' }}>
                <ListSubheader 
                  sx={{
                    bgcolor: 'transparent',
                    fontWeight: 600,
                    lineHeight: '2rem',
                    color: 'text.primary',
                    padding: 0
                  }}
                >
                  {category.replace(/-/g, ' ')}
                </ListSubheader>
                <div className="flex flex-wrap gap-2 mt-2">
                  {tags.map((tag) => (
                    <Chip
                      key={tag}
                      label={tag}
                      size="small"
                      clickable
                      onClick={() => handleTagClick(tag)}
                      sx={{
                        borderRadius: 1,
                        bgcolor: 'action.selected',
                        '&:hover': {
                          bgcolor: 'action.hover'
                        }
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Menu>
    </div>
  );
};

export default TagSelection; 