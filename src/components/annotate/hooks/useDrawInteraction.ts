import { useEffect, useRef, MutableRefObject } from 'react';
import Map from 'ol/Map';
import MapBrowserEvent from 'ol/MapBrowserEvent';
import VectorSource from 'ol/source/Vector';
import Draw from 'ol/interaction/Draw';
import Modify from 'ol/interaction/Modify';
import { Style, Fill, Stroke } from 'ol/style';
import Feature from 'ol/Feature';
import Collection from 'ol/Collection';
import GeoJSON from 'ol/format/GeoJSON';
import { Geometry, Polygon as OlPolygon, LineString as OlLineString } from 'ol/geom';
import * as turf from '@turf/turf';
import { useAnnotationStore, AnnotationTool } from '../../../store/annotationStore';

const HIGHLIGHT_STYLE = new Style({
  fill: new Fill({ color: 'rgba(255, 255, 0, 0.3)' }),
  stroke: new Stroke({ color: '#ffff00', width: 3 }),
});

const ERASER_STYLE = new Style({
  fill: new Fill({ color: 'rgba(255, 0, 0, 0.2)' }),
  stroke: new Stroke({ color: '#ff0000', width: 2, lineDash: [6, 4] }),
});

const EXPANDER_STYLE = new Style({
  fill: new Fill({ color: 'rgba(0, 200, 0, 0.2)' }),
  stroke: new Stroke({ color: '#00c800', width: 2, lineDash: [6, 4] }),
});

const CUTTER_STYLE = new Style({
  stroke: new Stroke({ color: '#ff9800', width: 2, lineDash: [8, 4] }),
});

const geojsonFormat = new GeoJSON();

/**
 * Create a thin polygon buffer around a line in pixel coordinates.
 * This replaces turf.buffer which interprets coordinates as geographic degrees.
 */
function pixelBufferLine(
  lineCoords: number[][],
  bufferDistance: number,
): number[][] {
  const left: number[][] = [];
  const right: number[][] = [];

  for (let i = 0; i < lineCoords.length - 1; i++) {
    const [x1, y1] = lineCoords[i];
    const [x2, y2] = lineCoords[i + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) continue;
    // Perpendicular normal
    const nx = (-dy / len) * bufferDistance;
    const ny = (dx / len) * bufferDistance;

    left.push([x1 + nx, y1 + ny]);
    left.push([x2 + nx, y2 + ny]);
    right.push([x1 - nx, y1 - ny]);
    right.push([x2 - nx, y2 - ny]);
  }

  right.reverse();
  const coords = [...left, ...right];
  if (coords.length > 0) coords.push(coords[0]); // close ring
  return coords;
}

function polygonCutWithBuffer(
  polygon: turf.Feature<turf.Polygon | turf.MultiPolygon>,
  line: turf.Feature<turf.LineString>,
  properties?: Record<string, any>,
): turf.Feature<turf.Polygon>[] | null {
  properties = properties || {};

  const polygonGeom = turf.getType(polygon);
  if ((polygonGeom !== 'Polygon' && polygonGeom !== 'MultiPolygon') || turf.getType(line) !== 'LineString') {
    return null;
  }

  const intersectPoints = turf.lineIntersect(polygon, line);
  if (intersectPoints.features.length < 2) return null;

  // Build a thin pixel-space buffer polygon around the cut line
  const lineCoords = turf.getCoords(line) as number[][];
  const bufferCoords = pixelBufferLine(lineCoords, 0.5);
  if (bufferCoords.length < 4) return null;

  const buffered = turf.polygon([bufferCoords]);

  const diff = turf.difference(turf.featureCollection([
    polygon as turf.Feature<turf.Polygon>,
    buffered,
  ]));
  if (!diff) return null;

  const results: turf.Feature<turf.Polygon>[] = [];
  if (diff.geometry.type === 'Polygon') {
    results.push(turf.polygon(diff.geometry.coordinates, properties));
  } else if (diff.geometry.type === 'MultiPolygon') {
    for (const coords of diff.geometry.coordinates) {
      results.push(turf.polygon(coords, properties));
    }
  }

  return results.length > 1 ? results : null;
}

function olFeatureToTurf(feature: Feature<Geometry>): turf.Feature<turf.Polygon> | null {
  const geojson = geojsonFormat.writeFeatureObject(feature);
  if (geojson.geometry.type !== 'Polygon') return null;
  return geojson as turf.Feature<turf.Polygon>;
}

function turfFeatureToOl(turfFeature: turf.Feature<turf.Polygon>, properties: Record<string, any>): Feature<OlPolygon> {
  const geojson = { ...turfFeature, properties: { ...properties } };
  return geojsonFormat.readFeature(geojson) as Feature<OlPolygon>;
}

/**
 * Clip a turf polygon to the image extent [0, 0, imageWidth, imageHeight].
 */
function clipToImageBounds(
  turfPoly: turf.Feature<turf.Polygon>,
  imageWidth: number,
  imageHeight: number,
): turf.Feature<turf.Polygon> | null {
  const bounds = turf.polygon([[
    [0, 0], [imageWidth, 0], [imageWidth, imageHeight], [0, imageHeight], [0, 0],
  ]]);
  const clipped = turf.intersect(turf.featureCollection([turfPoly, bounds]));
  if (!clipped) return null;
  if (clipped.geometry.type === 'Polygon') {
    return clipped as turf.Feature<turf.Polygon>;
  }
  // If MultiPolygon, take the largest piece
  if (clipped.geometry.type === 'MultiPolygon') {
    let maxArea = 0;
    let best: number[][] | null = null;
    for (const coords of clipped.geometry.coordinates) {
      const p = turf.polygon(coords);
      const a = turf.area(p);
      if (a > maxArea) { maxArea = a; best = coords; }
    }
    if (best) return turf.polygon(best);
  }
  return null;
}

function saveSnapshot(vectorSource: VectorSource): string {
  const features = vectorSource.getFeatures();
  return geojsonFormat.writeFeatures(features);
}

function restoreSnapshot(vectorSource: VectorSource, geojson: string) {
  vectorSource.clear();
  const features = geojsonFormat.readFeatures(geojson);
  vectorSource.addFeatures(features);
}

function applyCutLine(lineGeom: OlLineString, vectorSource: VectorSource) {
  const lineGeoJSON = geojsonFormat.writeGeometryObject(lineGeom);
  const turfLine = turf.lineString((lineGeoJSON as any).coordinates);

  const featuresToRemove: Feature<Geometry>[] = [];
  const featuresToAdd: Feature<Geometry>[] = [];

  vectorSource.getFeatures().forEach((existingFeature) => {
    const turfPoly = olFeatureToTurf(existingFeature);
    if (!turfPoly) return;

    try {
      const cutPieces = polygonCutWithBuffer(turfPoly, turfLine, existingFeature.getProperties());
      if (cutPieces && cutPieces.length > 1) {
        featuresToRemove.push(existingFeature);
        cutPieces.forEach((cutPoly) => {
          const props = existingFeature.getProperties();
          delete props.geometry;
          featuresToAdd.push(turfFeatureToOl(cutPoly, props));
        });
      }
    } catch (err) {
      console.warn('Polygon cut failed for a feature:', err);
    }
  });

  featuresToRemove.forEach((f) => vectorSource.removeFeature(f));
  featuresToAdd.forEach((f) => vectorSource.addFeature(f));
}

function applyEraser(eraserGeom: OlPolygon, vectorSource: VectorSource) {
  const eraserGeoJSON = geojsonFormat.writeGeometryObject(eraserGeom);
  const turfEraser = turf.polygon((eraserGeoJSON as any).coordinates);

  const featuresToRemove: Feature<Geometry>[] = [];
  const featuresToAdd: Feature<Geometry>[] = [];

  vectorSource.getFeatures().forEach((existingFeature) => {
    const turfPoly = olFeatureToTurf(existingFeature);
    if (!turfPoly) return;

    try {
      if (!turf.booleanIntersects(turfPoly, turfEraser)) return;

      const diff = turf.difference(turf.featureCollection([turfPoly, turfEraser]));
      if (diff) {
        featuresToRemove.push(existingFeature);
        const props = existingFeature.getProperties();
        delete props.geometry;

        if (diff.geometry.type === 'Polygon') {
          featuresToAdd.push(turfFeatureToOl(diff as turf.Feature<turf.Polygon>, props));
        } else if (diff.geometry.type === 'MultiPolygon') {
          diff.geometry.coordinates.forEach((coords) => {
            const poly = turf.polygon(coords);
            featuresToAdd.push(turfFeatureToOl(poly, props));
          });
        }
      } else {
        featuresToRemove.push(existingFeature);
      }
    } catch (err) {
      console.warn('Eraser failed for a feature:', err);
    }
  });

  featuresToRemove.forEach((f) => vectorSource.removeFeature(f));
  featuresToAdd.forEach((f) => vectorSource.addFeature(f));
}

function applyExpander(expanderGeom: OlPolygon, vectorSource: VectorSource) {
  const expanderGeoJSON = geojsonFormat.writeGeometryObject(expanderGeom);
  const turfExpander = turf.polygon((expanderGeoJSON as any).coordinates);

  // Find all features that intersect the drawn area
  const intersecting: { feature: Feature<Geometry>; turfPoly: turf.Feature<turf.Polygon> }[] = [];

  vectorSource.getFeatures().forEach((existingFeature) => {
    const turfPoly = olFeatureToTurf(existingFeature);
    if (!turfPoly) return;
    try {
      if (turf.booleanIntersects(turfPoly, turfExpander)) {
        intersecting.push({ feature: existingFeature, turfPoly });
      }
    } catch {
      // skip
    }
  });

  if (intersecting.length === 0) return;

  // Expand the first intersecting feature (topmost) by unioning with the drawn polygon
  const target = intersecting[0];
  try {
    const united = turf.union(turf.featureCollection([target.turfPoly, turfExpander]));
    if (!united) return;

    const props = target.feature.getProperties();
    delete props.geometry;

    vectorSource.removeFeature(target.feature);

    let newFeature: Feature<Geometry> | null = null;
    if (united.geometry.type === 'Polygon') {
      newFeature = turfFeatureToOl(united as turf.Feature<turf.Polygon>, props);
    } else if (united.geometry.type === 'MultiPolygon') {
      // Take the largest polygon piece
      let maxArea = 0;
      let bestCoords: number[][][] | null = null;
      for (const coords of united.geometry.coordinates) {
        const p = turf.polygon(coords);
        const a = turf.area(p);
        if (a > maxArea) { maxArea = a; bestCoords = coords; }
      }
      if (bestCoords) {
        newFeature = turfFeatureToOl(turf.polygon(bestCoords), props);
      }
    }

    if (newFeature) {
      vectorSource.addFeature(newFeature);
      // Trim other masks so no overlap
      const geom = newFeature.getGeometry() as OlPolygon;
      if (geom) {
        trimExistingMasks(geom, vectorSource, newFeature);
      }
    }
  } catch (err) {
    console.warn('Expander failed for a feature:', err);
  }
}

/**
 * Trim all existing features so they don't overlap with the given polygon.
 * Each pixel should belong to at most one mask.
 */
function trimExistingMasks(newPoly: OlPolygon, vectorSource: VectorSource, excludeFeature?: Feature<Geometry>) {
  const newGeoJSON = geojsonFormat.writeGeometryObject(newPoly);
  const turfNew = turf.polygon((newGeoJSON as any).coordinates);

  const featuresToRemove: Feature<Geometry>[] = [];
  const featuresToAdd: Feature<Geometry>[] = [];

  vectorSource.getFeatures().forEach((existingFeature) => {
    if (excludeFeature && existingFeature === excludeFeature) return;
    const turfPoly = olFeatureToTurf(existingFeature);
    if (!turfPoly) return;

    try {
      if (!turf.booleanIntersects(turfPoly, turfNew)) return;

      const diff = turf.difference(turf.featureCollection([turfPoly, turfNew]));
      const props = existingFeature.getProperties();
      delete props.geometry;

      featuresToRemove.push(existingFeature);
      if (diff) {
        if (diff.geometry.type === 'Polygon') {
          featuresToAdd.push(turfFeatureToOl(diff as turf.Feature<turf.Polygon>, props));
        } else if (diff.geometry.type === 'MultiPolygon') {
          diff.geometry.coordinates.forEach((coords) => {
            featuresToAdd.push(turfFeatureToOl(turf.polygon(coords), props));
          });
        }
      }
    } catch (err) {
      console.warn('Trim failed for a feature:', err);
    }
  });

  featuresToRemove.forEach((f) => vectorSource.removeFeature(f));
  featuresToAdd.forEach((f) => vectorSource.addFeature(f));
}

export function useDrawInteraction(
  mapRef: MutableRefObject<Map | null>,
  vectorSourceRef: MutableRefObject<VectorSource | null>,
) {
  const interactionRefs = useRef<{
    draw: Draw | null;
    modify: Modify | null;
  }>({ draw: null, modify: null });

  const selectedFeaturesRef = useRef<Collection<Feature<Geometry>>>(new Collection());

  const activeTool = useAnnotationStore((s) => s.activeTool);
  const setActiveTool = useAnnotationStore((s) => s.setActiveTool);
  const activeLabel = useAnnotationStore((s) => s.activeLabel);
  const activeLabelRef = useRef(activeLabel);
  activeLabelRef.current = activeLabel;

  const imageWidth = useAnnotationStore((s) => s.imageWidth);
  const imageHeight = useAnnotationStore((s) => s.imageHeight);

  const pushUndo = useAnnotationStore((s) => s.pushUndo);
  const popUndo = useAnnotationStore((s) => s.popUndo);

  // Undo handler (Ctrl+Z)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        const vectorSource = vectorSourceRef.current;
        if (!vectorSource) return;
        const snapshot = popUndo();
        if (snapshot) {
          restoreSnapshot(vectorSource, snapshot.geojson);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [popUndo, vectorSourceRef]);

  // Tool shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input fields
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();
      const shortcutMap: Record<string, AnnotationTool> = {
        m: 'move',
        s: 'select',
        d: 'polygon',
        c: 'cutter',
        e: 'eraser',
        a: 'expander',
      };
      const tool = shortcutMap[key];
      if (tool) {
        e.preventDefault();
        setActiveTool(tool);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [setActiveTool]);

  useEffect(() => {
    const map = mapRef.current;
    const vectorSource = vectorSourceRef.current;
    if (!map || !vectorSource) return;

    // Remove previous interactions
    const refs = interactionRefs.current;
    if (refs.draw) { map.removeInteraction(refs.draw); refs.draw = null; }
    if (refs.modify) { map.removeInteraction(refs.modify); refs.modify = null; }

    // Clear selection styling
    const selectedFeatures = selectedFeaturesRef.current;
    selectedFeatures.forEach((f) => f.setStyle(undefined as any));
    selectedFeatures.clear();

    const saveUndo = () => {
      pushUndo({ geojson: saveSnapshot(vectorSource) });
    };

    let keyHandler: ((e: KeyboardEvent) => void) | null = null;

    switch (activeTool) {
      case 'move':
        break;

      case 'select': {
        // Click-to-select with Shift for multi-select
        const clickHandler = (e: MapBrowserEvent<UIEvent>) => {
          const multiSelect = e.originalEvent.shiftKey;

          if (!multiSelect) {
            // Clear previous selection
            selectedFeatures.forEach((f) => f.setStyle(undefined as any));
            selectedFeatures.clear();
          }

          // Find the topmost feature at the click point
          map.forEachFeatureAtPixel(e.pixel, (feature) => {
            if (feature instanceof Feature) {
              // If already selected and multi-select, deselect it
              if (multiSelect) {
                let alreadySelected = false;
                selectedFeatures.forEach((f) => {
                  if (f === feature) alreadySelected = true;
                });
                if (alreadySelected) {
                  selectedFeatures.remove(feature);
                  feature.setStyle(undefined as any);
                  console.log('[Select] Deselected feature');
                  return true;
                }
              }
              selectedFeatures.push(feature);
              feature.setStyle(HIGHLIGHT_STYLE);
              console.log('[Select] Selected feature (' + selectedFeatures.getLength() + ' total)');
              return true; // stop after first hit
            }
            return false;
          });
        };
        map.on('singleclick', clickHandler);

        // Modify selected features
        const modify = new Modify({ features: selectedFeatures });
        map.addInteraction(modify);
        refs.modify = modify;

        // Delete selected features with Delete/Backspace
        keyHandler = (e: KeyboardEvent) => {
          if (e.key === 'Delete' || e.key === 'Backspace') {
            if (selectedFeatures.getLength() > 0) {
              e.preventDefault();
              saveUndo();
              selectedFeatures.forEach((f) => vectorSource.removeFeature(f));
              console.log('[Select] Deleted', selectedFeatures.getLength(), 'features');
              selectedFeatures.clear();
            }
          }
        };
        document.addEventListener('keydown', keyHandler);

        // Store click handler for cleanup
        const cleanupClick = () => map.un('singleclick', clickHandler);
        const origCleanup = refs as any;
        origCleanup._cleanupClick = cleanupClick;
        break;
      }

      case 'polygon': {
        const draw = new Draw({
          source: vectorSource,
          type: 'Polygon',
          freehand: true,
        });
        draw.on('drawstart', () => {
          saveUndo();
        });
        draw.on('drawend', (e) => {
          const label = activeLabelRef.current;
          e.feature.setProperties({
            label: label.id,
            edge_color: label.color,
            face_color: label.color,
            edge_width: 2,
          });

          // Clip polygon to image bounds
          if (imageWidth > 0 && imageHeight > 0) {
            const turfPoly = olFeatureToTurf(e.feature);
            if (turfPoly) {
              const clipped = clipToImageBounds(turfPoly, imageWidth, imageHeight);
              if (clipped) {
                const clippedOl = geojsonFormat.readGeometry(clipped.geometry) as OlPolygon;
                e.feature.setGeometry(clippedOl);
              }
            }
          }

          // Trim overlapping masks so each pixel belongs to one mask
          // Use setTimeout so the feature is added to the source first
          const drawnFeature = e.feature;
          setTimeout(() => {
            const geom = drawnFeature.getGeometry() as OlPolygon;
            if (geom) {
              trimExistingMasks(geom, vectorSource, drawnFeature);
            }
          }, 0);

          console.log('[Draw] Created polygon with label:', label.id);
        });
        map.addInteraction(draw);
        refs.draw = draw;
        break;
      }

      case 'cutter': {
        const draw = new Draw({
          type: 'LineString',
          freehand: true,
          style: CUTTER_STYLE,
        });
        draw.on('drawend', (e) => {
          saveUndo();
          const lineGeom = e.feature.getGeometry() as OlLineString;
          applyCutLine(lineGeom, vectorSource);
          console.log('[Cutter] Applied cut line');
        });
        map.addInteraction(draw);
        refs.draw = draw;
        break;
      }

      case 'eraser': {
        const draw = new Draw({
          type: 'Polygon',
          freehand: true,
          style: ERASER_STYLE,
        });
        draw.on('drawend', (e) => {
          saveUndo();
          const eraserGeom = e.feature.getGeometry() as OlPolygon;
          applyEraser(eraserGeom, vectorSource);
          console.log('[Eraser] Applied eraser');
        });
        map.addInteraction(draw);
        refs.draw = draw;
        break;
      }

      case 'expander': {
        const draw = new Draw({
          type: 'Polygon',
          freehand: true,
          style: EXPANDER_STYLE,
        });
        draw.on('drawend', (e) => {
          saveUndo();
          const expanderGeom = e.feature.getGeometry() as OlPolygon;
          applyExpander(expanderGeom, vectorSource);
          console.log('[Expander] Applied expander');
        });
        map.addInteraction(draw);
        refs.draw = draw;
        break;
      }
    }

    return () => {
      if (refs.draw) { map.removeInteraction(refs.draw); refs.draw = null; }
      if (refs.modify) { map.removeInteraction(refs.modify); refs.modify = null; }
      if ((refs as any)._cleanupClick) { (refs as any)._cleanupClick(); (refs as any)._cleanupClick = null; }
      if (keyHandler) document.removeEventListener('keydown', keyHandler);
      // Clear selection styles on cleanup
      selectedFeatures.forEach((f) => f.setStyle(undefined as any));
      selectedFeatures.clear();
    };
  }, [activeTool, mapRef, vectorSourceRef, pushUndo, imageWidth, imageHeight]);

  return { selectedFeatures: selectedFeaturesRef };
}
