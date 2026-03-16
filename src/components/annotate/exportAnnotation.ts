import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import Feature from 'ol/Feature';
import { Geometry, Polygon as OlPolygon } from 'ol/geom';

const geojsonFormat = new GeoJSON();

/** Export features as a GeoJSON FeatureCollection */
export function exportGeoJSON(vectorSource: VectorSource): object {
  const features = vectorSource.getFeatures();
  return JSON.parse(geojsonFormat.writeFeatures(features));
}

/**
 * Render an instance segmentation PNG from polygon features.
 * Each mask gets a unique integer label (1, 2, 3, ...).
 * Later features overwrite earlier ones where they overlap.
 * Background = 0.
 * Returns a Blob of a 16-bit-depth PNG encoded as an 8-bit RGBA PNG
 * where R,G channels store the 16-bit label (R=high byte, G=low byte).
 */
export function renderInstanceSegmentationPNG(
  vectorSource: VectorSource,
  width: number,
  height: number,
): Blob {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Label buffer: uint16 per pixel
  const labelBuffer = new Uint16Array(width * height);

  const features = vectorSource.getFeatures();

  features.forEach((feature, index) => {
    const label = index + 1; // 1-based
    const geom = feature.getGeometry();
    if (!geom || geom.getType() !== 'Polygon') return;

    const polygon = geom as OlPolygon;
    const rings = polygon.getCoordinates();

    // Draw polygon to a temporary canvas to get a pixel mask
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d')!;

    tempCtx.fillStyle = 'white';
    // OL uses bottom-left origin; canvas uses top-left. Flip Y.
    for (const ring of rings) {
      tempCtx.beginPath();
      for (let i = 0; i < ring.length; i++) {
        const x = ring[i][0];
        const y = height - ring[i][1]; // flip Y
        if (i === 0) tempCtx.moveTo(x, y);
        else tempCtx.lineTo(x, y);
      }
      tempCtx.closePath();
    }
    // Use evenodd to handle holes correctly
    tempCtx.fill('evenodd');

    const imageData = tempCtx.getImageData(0, 0, width, height);
    const pixels = imageData.data;

    // Write label to buffer where temp canvas is white
    for (let i = 0; i < width * height; i++) {
      // Check red channel (any non-zero means inside polygon)
      if (pixels[i * 4] > 0) {
        labelBuffer[i] = label;
      }
    }
  });

  // Encode labelBuffer into RGBA image:
  // R = high byte of label, G = low byte, B = 0, A = 255
  const outputData = ctx.createImageData(width, height);
  const out = outputData.data;
  for (let i = 0; i < width * height; i++) {
    const label = labelBuffer[i];
    out[i * 4] = (label >> 8) & 0xff;     // R = high byte
    out[i * 4 + 1] = label & 0xff;         // G = low byte
    out[i * 4 + 2] = 0;                    // B = 0
    out[i * 4 + 3] = 255;                  // A = opaque
  }
  ctx.putImageData(outputData, 0, 0);

  // Convert canvas to blob synchronously via toDataURL
  const dataUrl = canvas.toDataURL('image/png');
  const binary = atob(dataUrl.split(',')[1]);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: 'image/png' });
}

/** Trigger a file download in the browser */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 0);
}

/** Download a JSON object as a file */
export function downloadJSON(data: object, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, filename);
}
