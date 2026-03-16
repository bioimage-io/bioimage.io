import { useEffect, useRef, MutableRefObject } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import ImageLayer from 'ol/layer/Image';
import VectorLayer from 'ol/layer/Vector';
import Static from 'ol/source/ImageStatic';
import VectorSource from 'ol/source/Vector';
import { Projection } from 'ol/proj';
import { getCenter } from 'ol/extent';
import { Style, Fill, Stroke } from 'ol/style';
import GeoJSON from 'ol/format/GeoJSON';

export interface AnnotationMapRefs {
  map: MutableRefObject<Map | null>;
  vectorSource: MutableRefObject<VectorSource | null>;
  vectorLayer: MutableRefObject<VectorLayer<VectorSource> | null>;
  imageLayerRef: MutableRefObject<ImageLayer | null>;
}

export function useAnnotationMap(
  containerRef: MutableRefObject<HTMLDivElement | null>,
  imageUrl: string | null,
  imageWidth: number,
  imageHeight: number,
): AnnotationMapRefs {
  const mapRef = useRef<Map | null>(null);
  const vectorSourceRef = useRef<VectorSource | null>(null);
  const vectorLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const imageLayerRef = useRef<ImageLayer | null>(null);

  useEffect(() => {
    if (!containerRef.current || !imageUrl || !imageWidth || !imageHeight) return;

    // Clean up previous map
    if (mapRef.current) {
      mapRef.current.setTarget(undefined);
      mapRef.current = null;
    }

    const extent = [0, 0, imageWidth, imageHeight];

    const projection = new Projection({
      code: 'pixel',
      units: 'pixels',
      extent,
    });

    const imageLayer = new ImageLayer({
      source: new Static({
        url: imageUrl,
        projection,
        imageExtent: extent,
        crossOrigin: 'anonymous',
      }),
    });
    imageLayerRef.current = imageLayer;

    const vectorSource = new VectorSource();
    vectorSourceRef.current = vectorSource;

    const vectorLayer = new VectorLayer({
      source: vectorSource,
      style: (feature) => {
        const props = feature.getProperties();
        return new Style({
          fill: new Fill({
            color: (props.face_color || props.edge_color || '#0084ff') + '40',
          }),
          stroke: new Stroke({
            color: props.edge_color || '#0084ff',
            width: props.edge_width || 2,
          }),
        });
      },
    });
    vectorLayerRef.current = vectorLayer;

    const map = new Map({
      target: containerRef.current,
      layers: [imageLayer, vectorLayer],
      view: new View({
        projection,
        center: getCenter(extent),
        // No extent constraint — allows zooming out beyond image bounds
        zoom: 1,
        maxZoom: 20,
        minZoom: -2,
      }),
    });

    // Fit view to image initially (not constraining future zoom)
    map.getView().fit(extent, { padding: [40, 40, 40, 40] });

    mapRef.current = map;

    return () => {
      map.setTarget(undefined);
      mapRef.current = null;
    };
  }, [containerRef, imageUrl, imageWidth, imageHeight]);

  return { map: mapRef, vectorSource: vectorSourceRef, vectorLayer: vectorLayerRef, imageLayerRef };
}

/** Export annotation features as GeoJSON */
export function exportAnnotationGeoJSON(vectorSource: VectorSource): object {
  const format = new GeoJSON();
  const features = vectorSource.getFeatures();
  return JSON.parse(format.writeFeatures(features));
}
