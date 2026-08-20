import { useEffect, useRef, MutableRefObject } from 'react';
import Map from 'ol/Map';
import MapBrowserEvent from 'ol/MapBrowserEvent';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import Draw, { createBox } from 'ol/interaction/Draw';
import Modify from 'ol/interaction/Modify';
import DragPan from 'ol/interaction/DragPan';
import { Style, Fill, Stroke } from 'ol/style';
import Feature from 'ol/Feature';
import Collection from 'ol/Collection';
import GeoJSON from 'ol/format/GeoJSON';
import { Geometry, Polygon as OlPolygon, LineString as OlLineString, Circle as OlCircle } from 'ol/geom';
import * as turf from '@turf/turf';
import { useAnnotationStore, AnnotationTool, BRUSH_RADIUS_STEP } from '../../../store/annotationStore';

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

const SAMBOX_STYLE = new Style({
  fill: new Fill({ color: 'rgba(0, 132, 255, 0.12)' }),
  stroke: new Stroke({ color: '#0084ff', width: 2, lineDash: [6, 4] }),
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

/** True when a keydown's target is a text-entry element, so global keyboard
 *  shortcuts (zoom, brush radius) don't fire while the user is typing. */
function isTypingTarget(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Build a circular polygon in pixel space (the same coordinate system as the
 * rest of this file's turf helpers). Manual ring generation, not
 * turf.circle, since turf.circle assumes geographic-degree units.
 */
function createPixelCircle(cx: number, cy: number, radius: number, segments = 32): turf.Feature<turf.Polygon> {
  const coords: number[][] = [];
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * 2 * Math.PI;
    coords.push([cx + radius * Math.cos(theta), cy + radius * Math.sin(theta)]);
  }
  return turf.polygon([coords]);
}

/** Reduce a Polygon/MultiPolygon down to its largest single ring. */
function largestPolygon(geometry: turf.Polygon | turf.MultiPolygon): turf.Feature<turf.Polygon> | null {
  if (geometry.type === 'Polygon') return turf.polygon(geometry.coordinates);
  let maxArea = 0;
  let best: number[][][] | null = null;
  for (const coords of geometry.coordinates) {
    const p = turf.polygon(coords);
    const a = turf.area(p);
    if (a > maxArea) { maxArea = a; best = coords; }
  }
  return best ? turf.polygon(best) : null;
}

type MapPointerEvents = {
  on: (type: string, listener: (e: MapBrowserEvent<UIEvent>) => void) => void;
  un: (type: string, listener: (e: MapBrowserEvent<UIEvent>) => void) => void;
};

/**
 * Wire up circular brush painting on the map: a cursor circle that follows
 * the pointer at the current brush radius, and dabs fired on drag
 * (pointerdown starts a stroke, pointermove while held keeps dabbing,
 * pointerup ends it). DragPan is temporarily disabled so a brush stroke
 * doesn't pan the map. Returns a cleanup function undoing all of it.
 */
function setupBrushPainting(
  map: Map,
  radiusRef: MutableRefObject<number>,
  cursorStyle: Style,
  onStrokeStart: () => void,
  onDab: (coord: number[]) => void,
  onStrokeEnd?: () => void,
): () => void {
  const dragPan = map.getInteractions().getArray().find((i) => i instanceof DragPan) as DragPan | undefined;
  dragPan?.setActive(false);

  const cursorSource = new VectorSource();
  const cursorFeature = new Feature(new OlCircle([0, 0], radiusRef.current));
  cursorFeature.setStyle(cursorStyle);
  cursorSource.addFeature(cursorFeature);
  const cursorLayer = new VectorLayer({ source: cursorSource });
  map.addLayer(cursorLayer);

  let painting = false;

  const updateCursor = (coord: number[]) => {
    const geom = cursorFeature.getGeometry() as OlCircle;
    geom.setCenter(coord);
    geom.setRadius(radiusRef.current);
  };

  const rawMap = map as unknown as MapPointerEvents;

  const onDown = (e: MapBrowserEvent<UIEvent>) => {
    painting = true;
    onStrokeStart();
    onDab(e.coordinate);
    updateCursor(e.coordinate);
  };
  const onMove = (e: MapBrowserEvent<UIEvent>) => {
    updateCursor(e.coordinate);
    if (painting) onDab(e.coordinate);
  };
  const onUp = () => {
    if (!painting) return;
    painting = false;
    onStrokeEnd?.();
  };

  rawMap.on('pointerdown', onDown);
  map.on('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  return () => {
    rawMap.un('pointerdown', onDown);
    map.un('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    map.removeLayer(cursorLayer);
    dragPan?.setActive(true);
  };
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

function applyExpander(expanderGeom: OlPolygon, vectorSource: VectorSource, imageWidth: number, imageHeight: number) {
  const expanderGeoJSON = geojsonFormat.writeGeometryObject(expanderGeom);
  let turfExpander = turf.polygon((expanderGeoJSON as any).coordinates);

  // Clamp the brush stroke to the image extent so it can never expand a mask
  // past the image boundary.
  if (imageWidth > 0 && imageHeight > 0) {
    const clipped = clipToImageBounds(turfExpander, imageWidth, imageHeight);
    if (!clipped) return;
    turfExpander = clipped;
  }

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
export function trimExistingMasks(newPoly: OlPolygon, vectorSource: VectorSource, excludeFeature?: Feature<Geometry>) {
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

/**
 * Precompute turf polygons for a snapshot of vector-source features, so a
 * batch of exclusion checks (e.g. one per AI-segmented instance) doesn't
 * re-derive the same existing-mask geometry on every call.
 */
export function snapshotMaskPolygons(features: Feature<Geometry>[]): turf.Feature<turf.Polygon>[] {
  const polys: turf.Feature<turf.Polygon>[] = [];
  for (const f of features) {
    const p = olFeatureToTurf(f);
    if (p) polys.push(p);
  }
  return polys;
}

/**
 * Subtract already-existing mask area from a newly proposed polygon, so an
 * AI-produced mask is excluded against existing annotations rather than
 * overwriting them (unlike the manual draw tools, where the new shape wins
 * and existing masks get trimmed via trimExistingMasks above). Returns the
 * remaining OL polygon pieces: none if fully covered, more than one if the
 * subtraction splits the shape.
 */
export function excludeAgainstMaskPolygons(
  newPoly: OlPolygon,
  existingPolys: turf.Feature<turf.Polygon>[],
): OlPolygon[] {
  const newGeoJSON = geojsonFormat.writeGeometryObject(newPoly);
  let remaining: turf.Feature<turf.Polygon | turf.MultiPolygon> | null = turf.polygon(
    (newGeoJSON as any).coordinates,
  );

  for (const existing of existingPolys) {
    if (!remaining) break;
    try {
      if (!turf.booleanIntersects(remaining, existing)) continue;
      remaining = turf.difference(turf.featureCollection([remaining, existing]));
    } catch (err) {
      console.warn('Exclude-against-existing failed for a feature:', err);
    }
  }

  if (!remaining) return [];
  if (remaining.geometry.type === 'Polygon') {
    return [geojsonFormat.readGeometry(remaining.geometry) as OlPolygon];
  }
  if (remaining.geometry.type === 'MultiPolygon') {
    return remaining.geometry.coordinates.map(
      (coords) => geojsonFormat.readGeometry({ type: 'Polygon', coordinates: coords }) as OlPolygon,
    );
  }
  return [];
}

export interface DrawInteractionOptions {
  /** Invoked with an OL-space box extent [minX, minY, maxX, maxY] (display
   *  pixels) when the user finishes drawing an AI-box. The page owns the
   *  μSAM decode, undo snapshot, and committed feature. */
  onSamBox?: (extent: number[]) => void;
  /** Whether the μSAM box tool is usable. Gates its keyboard shortcut and
   *  the box interaction so a disabled tool cannot be activated. */
  microSamAvailable?: boolean;
}

export function useDrawInteraction(
  mapRef: MutableRefObject<Map | null>,
  vectorSourceRef: MutableRefObject<VectorSource | null>,
  options?: DrawInteractionOptions,
) {
  const interactionRefs = useRef<{
    draw: Draw | null;
    modify: Modify | null;
  }>({ draw: null, modify: null });

  // Keep the box callback + availability in refs so the interaction effect does
  // not re-run (and tear down the active Draw) when the page re-renders.
  const onSamBoxRef = useRef<DrawInteractionOptions['onSamBox']>(options?.onSamBox);
  onSamBoxRef.current = options?.onSamBox;
  const microSamAvailableRef = useRef<boolean>(!!options?.microSamAvailable);
  microSamAvailableRef.current = !!options?.microSamAvailable;

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

  const drawMode = useAnnotationStore((s) => s.drawMode);
  const brushRadius = useAnnotationStore((s) => s.brushRadius);
  const brushRadiusRef = useRef(brushRadius);
  brushRadiusRef.current = brushRadius;
  const increaseBrushRadius = useAnnotationStore((s) => s.increaseBrushRadius);
  const decreaseBrushRadius = useAnnotationStore((s) => s.decreaseBrushRadius);

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
        b: 'sambox',
        c: 'cutter',
        e: 'eraser',
        a: 'expander',
      };
      const tool = shortcutMap[key];
      if (tool) {
        // The AI-box tool is unusable when μSAM is offline; do not activate it.
        if (tool === 'sambox' && !microSamAvailableRef.current) return;
        e.preventDefault();
        setActiveTool(tool);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [setActiveTool]);

  // Keyboard zoom: +/= (or numpad +) zooms in, - (or numpad -) zooms out, 0
  // recenters to fit the whole image, matching the zoom buttons and reset
  // view action.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      const map = mapRef.current;
      if (!map) return;
      const view = map.getView();

      if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
        e.preventDefault();
        view.animate({ zoom: (view.getZoom() ?? 0) + 1, duration: 200 });
      } else if (e.key === '-' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        view.animate({ zoom: (view.getZoom() ?? 0) - 1, duration: 200 });
      } else if (e.key === '0' && imageWidth > 0 && imageHeight > 0) {
        e.preventDefault();
        view.fit([0, 0, imageWidth, imageHeight], { padding: [40, 40, 40, 40], duration: 300 });
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [mapRef, imageWidth, imageHeight]);

  // Brush radius arrow keys, active only while in brush mode. Relies on OS
  // key-repeat to drive resizing while held (no `e.repeat` filtering), and
  // accelerates to a bigger step after ~1s of continuous hold so dragging
  // across the full 5-150px range doesn't feel sluggish.
  useEffect(() => {
    if (drawMode !== 'brush') return;
    const HOLD_ACCEL_MS = 1000;
    const holdRef = { key: null as string | null, start: 0 };

    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();

      if (!e.repeat || holdRef.key !== e.key) {
        holdRef.key = e.key;
        holdRef.start = Date.now();
      }
      const held = Date.now() - holdRef.start;
      const step = held > HOLD_ACCEL_MS ? BRUSH_RADIUS_STEP * 2 : BRUSH_RADIUS_STEP;

      if (e.key === 'ArrowUp') increaseBrushRadius(step);
      else decreaseBrushRadius(step);
    };
    const keyupHandler = (e: KeyboardEvent) => {
      if (holdRef.key === e.key) holdRef.key = null;
    };
    document.addEventListener('keydown', handler);
    document.addEventListener('keyup', keyupHandler);
    return () => {
      document.removeEventListener('keydown', handler);
      document.removeEventListener('keyup', keyupHandler);
    };
  }, [drawMode, increaseBrushRadius, decreaseBrushRadius]);

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
        if (drawMode === 'brush') {
          let strokeUnion: turf.Feature<turf.Polygon | turf.MultiPolygon> | null = null;
          let liveFeature: Feature<OlPolygon> | null = null;

          const updateLivePreview = () => {
            if (!strokeUnion) return;
            const poly = largestPolygon(strokeUnion.geometry);
            if (!poly) return;
            const olGeom = geojsonFormat.readGeometry(poly.geometry) as OlPolygon;
            if (!liveFeature) {
              liveFeature = new Feature<OlPolygon>(olGeom);
              liveFeature.setStyle(HIGHLIGHT_STYLE);
              vectorSource.addFeature(liveFeature);
            } else {
              liveFeature.setGeometry(olGeom);
            }
          };

          const finalizeStroke = () => {
            if (!strokeUnion) return;
            const label = activeLabelRef.current;
            let poly = largestPolygon(strokeUnion.geometry);
            if (poly && imageWidth > 0 && imageHeight > 0) {
              poly = clipToImageBounds(poly, imageWidth, imageHeight) || poly;
            }
            if (liveFeature) {
              vectorSource.removeFeature(liveFeature);
              liveFeature = null;
            }
            if (poly) {
              const newFeature = turfFeatureToOl(poly, {
                label: label.id,
                edge_color: label.color,
                face_color: label.color,
                edge_width: 2,
              });
              vectorSource.addFeature(newFeature);
              trimExistingMasks(newFeature.getGeometry() as OlPolygon, vectorSource, newFeature);
              console.log('[Draw] Brush-created polygon with label:', label.id);
            }
            strokeUnion = null;
          };

          (refs as any)._cleanupBrush = setupBrushPainting(
            map,
            brushRadiusRef,
            HIGHLIGHT_STYLE,
            saveUndo,
            (coord) => {
              const dab = createPixelCircle(coord[0], coord[1], brushRadiusRef.current);
              strokeUnion = strokeUnion
                ? (turf.union(turf.featureCollection([strokeUnion, dab])) as typeof strokeUnion) ?? strokeUnion
                : dab;
              updateLivePreview();
            },
            finalizeStroke,
          );
          break;
        }
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

      case 'sambox': {
        // Box-prompt tool: draw a rectangle, hand its extent to the page for a
        // local μSAM ONNX decode. No `source` so the box itself is transient
        // (the page adds the resulting mask feature). Gated on availability.
        if (!microSamAvailableRef.current) break;
        const draw = new Draw({
          type: 'Circle',
          geometryFunction: createBox(),
          freehand: true,
          style: SAMBOX_STYLE,
        });
        draw.on('drawend', (e) => {
          const geom = e.feature.getGeometry();
          if (!geom) return;
          const extent = geom.getExtent();
          onSamBoxRef.current?.(extent);
          console.log('[SamBox] Box drawn, extent:', extent);
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
        if (drawMode === 'brush') {
          (refs as any)._cleanupBrush = setupBrushPainting(
            map,
            brushRadiusRef,
            ERASER_STYLE,
            saveUndo,
            (coord) => {
              const dab = createPixelCircle(coord[0], coord[1], brushRadiusRef.current);
              const olPoly = geojsonFormat.readGeometry(dab.geometry) as OlPolygon;
              applyEraser(olPoly, vectorSource);
            },
          );
          break;
        }
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
        if (drawMode === 'brush') {
          (refs as any)._cleanupBrush = setupBrushPainting(
            map,
            brushRadiusRef,
            EXPANDER_STYLE,
            saveUndo,
            (coord) => {
              const dab = createPixelCircle(coord[0], coord[1], brushRadiusRef.current);
              const olPoly = geojsonFormat.readGeometry(dab.geometry) as OlPolygon;
              applyExpander(olPoly, vectorSource, imageWidth, imageHeight);
            },
          );
          break;
        }
        const draw = new Draw({
          type: 'Polygon',
          freehand: true,
          style: EXPANDER_STYLE,
        });
        draw.on('drawend', (e) => {
          saveUndo();
          const expanderGeom = e.feature.getGeometry() as OlPolygon;
          applyExpander(expanderGeom, vectorSource, imageWidth, imageHeight);
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
      if ((refs as any)._cleanupBrush) { (refs as any)._cleanupBrush(); (refs as any)._cleanupBrush = null; }
      if (keyHandler) document.removeEventListener('keydown', keyHandler);
      // Clear selection styles on cleanup
      selectedFeatures.forEach((f) => f.setStyle(undefined as any));
      selectedFeatures.clear();
    };
  }, [activeTool, mapRef, vectorSourceRef, pushUndo, imageWidth, imageHeight, drawMode]);

  return { selectedFeatures: selectedFeaturesRef };
}
