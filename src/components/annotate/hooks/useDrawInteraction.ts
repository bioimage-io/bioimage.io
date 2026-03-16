import { useEffect, useRef, MutableRefObject } from 'react';
import Map from 'ol/Map';
import VectorSource from 'ol/source/Vector';
import Draw from 'ol/interaction/Draw';
import Modify from 'ol/interaction/Modify';
import { Style, Fill, Stroke } from 'ol/style';
import Feature from 'ol/Feature';
import Collection from 'ol/Collection';
import GeoJSON from 'ol/format/GeoJSON';
import { Geometry, Polygon as OlPolygon, LineString as OlLineString } from 'ol/geom';
import DragBox from 'ol/interaction/DragBox';
import { platformModifierKeyOnly, always } from 'ol/events/condition';
import * as turf from '@turf/turf';
import { useAnnotationStore } from '../../../store/annotationStore';

const HIGHLIGHT_STYLE = new Style({
  fill: new Fill({ color: 'rgba(255, 255, 0, 0.3)' }),
  stroke: new Stroke({ color: '#ffff00', width: 3 }),
});

const ERASER_STYLE = new Style({
  fill: new Fill({ color: 'rgba(255, 0, 0, 0.2)' }),
  stroke: new Stroke({ color: '#ff0000', width: 2, lineDash: [6, 4] }),
});

const CUTTER_STYLE = new Style({
  stroke: new Stroke({ color: '#ff9800', width: 2, lineDash: [8, 4] }),
});

const SELECT_BOX_STYLE = new Style({
  fill: new Fill({ color: 'rgba(0, 120, 215, 0.1)' }),
  stroke: new Stroke({ color: '#0078d7', width: 1.5, lineDash: [4, 4] }),
});

const geojsonFormat = new GeoJSON();

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

  const bufferWidth = 0.5;
  const buffered = turf.buffer(line, bufferWidth, { units: 'degrees' });
  if (!buffered) return null;

  const diff = turf.difference(turf.featureCollection([
    polygon as turf.Feature<turf.Polygon>,
    buffered as turf.Feature<turf.Polygon>,
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

export function useDrawInteraction(
  mapRef: MutableRefObject<Map | null>,
  vectorSourceRef: MutableRefObject<VectorSource | null>,
) {
  const interactionRefs = useRef<{
    draw: Draw | null;
    dragBox: DragBox | null;
    modify: Modify | null;
  }>({ draw: null, dragBox: null, modify: null });

  const selectedFeaturesRef = useRef<Collection<Feature<Geometry>>>(new Collection());

  const activeTool = useAnnotationStore((s) => s.activeTool);
  const activeLabel = useAnnotationStore((s) => s.activeLabel);
  const activeLabelRef = useRef(activeLabel);
  activeLabelRef.current = activeLabel;

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

  useEffect(() => {
    const map = mapRef.current;
    const vectorSource = vectorSourceRef.current;
    if (!map || !vectorSource) return;

    // Remove previous interactions
    const refs = interactionRefs.current;
    if (refs.draw) { map.removeInteraction(refs.draw); refs.draw = null; }
    if (refs.dragBox) { map.removeInteraction(refs.dragBox); refs.dragBox = null; }
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
        // DragBox for rectangle selection — does NOT pan the map
        const dragBox = new DragBox({
          condition: always,
          className: 'ol-dragbox',
        });

        dragBox.on('boxend', () => {
          // Clear previous selection
          selectedFeatures.forEach((f) => f.setStyle(undefined as any));
          selectedFeatures.clear();

          const boxExtent = dragBox.getGeometry().getExtent();

          // Select all features fully within the box
          vectorSource.getFeatures().forEach((feature) => {
            const geom = feature.getGeometry();
            if (geom) {
              const featureExtent = geom.getExtent();
              // Check if feature is fully contained within the box
              if (
                featureExtent[0] >= boxExtent[0] &&
                featureExtent[1] >= boxExtent[1] &&
                featureExtent[2] <= boxExtent[2] &&
                featureExtent[3] <= boxExtent[3]
              ) {
                selectedFeatures.push(feature);
                feature.setStyle(HIGHLIGHT_STYLE);
              }
            }
          });
          console.log('[Select] Selected', selectedFeatures.getLength(), 'features');
        });

        dragBox.on('boxstart', () => {
          // Clear previous selection on new drag
          selectedFeatures.forEach((f) => f.setStyle(undefined as any));
          selectedFeatures.clear();
        });

        map.addInteraction(dragBox);
        refs.dragBox = dragBox;

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
    }

    return () => {
      if (refs.draw) { map.removeInteraction(refs.draw); refs.draw = null; }
      if (refs.dragBox) { map.removeInteraction(refs.dragBox); refs.dragBox = null; }
      if (refs.modify) { map.removeInteraction(refs.modify); refs.modify = null; }
      if (keyHandler) document.removeEventListener('keydown', keyHandler);
      // Clear selection styles on cleanup
      selectedFeatures.forEach((f) => f.setStyle(undefined as any));
      selectedFeatures.clear();
    };
  }, [activeTool, mapRef, vectorSourceRef, pushUndo]);

  return { selectedFeatures: selectedFeaturesRef };
}
