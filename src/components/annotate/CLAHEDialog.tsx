import React, { useState, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Slider,
  Typography,
  Switch,
  FormControlLabel,
  IconButton,
  Tooltip,
  Box,
  Stack,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

export interface CLAHEConfig {
  clipLimit: number;
  tileGridSize: number;
  enabled: boolean;
}

const DEFAULT_CONFIG: CLAHEConfig = {
  clipLimit: 2.0,
  tileGridSize: 8,
  enabled: false,
};

interface CLAHEDialogProps {
  open: boolean;
  config: CLAHEConfig;
  onConfigChange: (config: CLAHEConfig) => void;
  onApply: () => void;
  onClose: () => void;
}

const ParamRow: React.FC<{
  label: string;
  tooltip: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}> = ({ label, tooltip, value, min, max, step, onChange }) => (
  <Box sx={{ mb: 2 }}>
    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.5 }}>
      <Typography variant="body2" fontWeight={500}>
        {label}: {value}
      </Typography>
      <Tooltip title={tooltip} placement="right" arrow>
        <IconButton size="small" sx={{ p: 0.25 }}>
          <InfoOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
    <Slider
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(_, v) => onChange(v as number)}
      valueLabelDisplay="auto"
      size="small"
    />
  </Box>
);

const CLAHEDialog: React.FC<CLAHEDialogProps> = ({
  open,
  config,
  onConfigChange,
  onApply,
  onClose,
}) => {
  const update = (partial: Partial<CLAHEConfig>) =>
    onConfigChange({ ...config, ...partial });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Contrast Enhancement (CLAHE)</DialogTitle>
      <DialogContent>
        <ParamRow
          label="Clip Limit"
          tooltip="Controls contrast amplification. Higher values give more contrast. Values above 3-4 can introduce noise."
          value={config.clipLimit}
          min={0.5}
          max={10}
          step={0.5}
          onChange={(v) => update({ clipLimit: v })}
        />

        <ParamRow
          label="Tile Grid Size"
          tooltip="Size of the grid for local histogram equalization. Smaller tiles give more local contrast. Larger tiles give more global effect."
          value={config.tileGridSize}
          min={2}
          max={32}
          step={2}
          onChange={(v) => update({ tileGridSize: v })}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Button onClick={onApply} variant="contained">
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
};

/**
 * Apply CLAHE to an HTMLImageElement and return a data URL.
 */
function applyCLAHE(
  image: HTMLImageElement,
  clipLimit: number,
  tileGridSize: number,
): string {
  const width = image.naturalWidth;
  const height = image.naturalHeight;

  // Draw image to offscreen canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Extract luminance channel
  const luminance = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    luminance[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // Tile dimensions
  const tilesX = tileGridSize;
  const tilesY = tileGridSize;
  const tileW = width / tilesX;
  const tileH = height / tilesY;
  const numBins = 256;
  const clipLimitActual = Math.max(1, clipLimit * (tileW * tileH) / numBins);

  // Compute CDFs for each tile
  const tileCDFs: Float32Array[][] = [];
  for (let ty = 0; ty < tilesY; ty++) {
    tileCDFs[ty] = [];
    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = Math.round(tx * tileW);
      const y0 = Math.round(ty * tileH);
      const x1 = Math.round((tx + 1) * tileW);
      const y1 = Math.round((ty + 1) * tileH);

      // Build histogram
      const hist = new Float32Array(numBins);
      let count = 0;
      for (let y = y0; y < y1 && y < height; y++) {
        for (let x = x0; x < x1 && x < width; x++) {
          const bin = Math.min(255, Math.max(0, Math.round(luminance[y * width + x])));
          hist[bin]++;
          count++;
        }
      }

      // Clip histogram and redistribute excess
      let excess = 0;
      for (let i = 0; i < numBins; i++) {
        if (hist[i] > clipLimitActual) {
          excess += hist[i] - clipLimitActual;
          hist[i] = clipLimitActual;
        }
      }
      const increment = excess / numBins;
      for (let i = 0; i < numBins; i++) {
        hist[i] += increment;
      }

      // Compute CDF
      const cdf = new Float32Array(numBins);
      cdf[0] = hist[0];
      for (let i = 1; i < numBins; i++) {
        cdf[i] = cdf[i - 1] + hist[i];
      }
      // Normalize CDF to [0, 255]
      const cdfMin = cdf[0];
      const cdfMax = cdf[numBins - 1];
      const scale = cdfMax - cdfMin > 0 ? 255 / (cdfMax - cdfMin) : 0;
      for (let i = 0; i < numBins; i++) {
        cdf[i] = (cdf[i] - cdfMin) * scale;
      }

      tileCDFs[ty][tx] = cdf;
    }
  }

  // Map each pixel with bilinear interpolation between tile CDFs
  const enhanced = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bin = Math.min(255, Math.max(0, Math.round(luminance[y * width + x])));

      // Position relative to tile centers
      const txf = (x / tileW) - 0.5;
      const tyf = (y / tileH) - 0.5;

      const tx0 = Math.max(0, Math.floor(txf));
      const ty0 = Math.max(0, Math.floor(tyf));
      const tx1 = Math.min(tilesX - 1, tx0 + 1);
      const ty1 = Math.min(tilesY - 1, ty0 + 1);

      const fx = Math.max(0, Math.min(1, txf - tx0));
      const fy = Math.max(0, Math.min(1, tyf - ty0));

      // Bilinear interpolation of CDF-mapped values
      const v00 = tileCDFs[ty0][tx0][bin];
      const v10 = tileCDFs[ty0][tx1][bin];
      const v01 = tileCDFs[ty1][tx0][bin];
      const v11 = tileCDFs[ty1][tx1][bin];

      const top = v00 * (1 - fx) + v10 * fx;
      const bottom = v01 * (1 - fx) + v11 * fx;
      enhanced[y * width + x] = top * (1 - fy) + bottom * fy;
    }
  }

  // Map enhanced luminance back to RGB preserving color ratios
  for (let i = 0; i < width * height; i++) {
    const origLum = luminance[i];
    const newLum = enhanced[i];
    const ratio = origLum > 0 ? newLum / origLum : 0;

    data[i * 4] = Math.min(255, Math.max(0, Math.round(data[i * 4] * ratio)));
    data[i * 4 + 1] = Math.min(255, Math.max(0, Math.round(data[i * 4 + 1] * ratio)));
    data[i * 4 + 2] = Math.min(255, Math.max(0, Math.round(data[i * 4 + 2] * ratio)));
    // Alpha channel unchanged
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Hook for managing CLAHE configuration and applying it to images.
 */
export function useCLAHE() {
  const [claheConfig, setClaheConfig] = useState<CLAHEConfig>(DEFAULT_CONFIG);
  const [dialogOpen, setDialogOpen] = useState(false);
  const originalImageRef = useRef<string | null>(null);

  const openDialog = useCallback(() => setDialogOpen(true), []);
  const closeDialog = useCallback(() => setDialogOpen(false), []);

  const applyToImage = useCallback(
    (image: HTMLImageElement): Promise<string> => {
      return new Promise((resolve) => {
        // Store original src on first application
        if (!originalImageRef.current) {
          originalImageRef.current = image.src;
        }
        const dataUrl = applyCLAHE(
          image,
          claheConfig.clipLimit,
          claheConfig.tileGridSize,
        );
        resolve(dataUrl);
      });
    },
    [claheConfig.clipLimit, claheConfig.tileGridSize],
  );

  const resetImage = useCallback((): string | null => {
    const original = originalImageRef.current;
    if (original) {
      originalImageRef.current = null;
      setClaheConfig((prev) => ({ ...prev, enabled: false }));
    }
    return original;
  }, []);

  return {
    claheConfig,
    setClaheConfig,
    dialogOpen,
    openDialog,
    closeDialog,
    applyToImage,
    resetImage,
    dialogProps: {
      open: dialogOpen,
      config: claheConfig,
      onConfigChange: setClaheConfig,
      onClose: closeDialog,
    } as Omit<CLAHEDialogProps, 'onApply'>,
  };
}

export default CLAHEDialog;
