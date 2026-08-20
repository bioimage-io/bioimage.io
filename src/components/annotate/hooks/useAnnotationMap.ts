import { useEffect, useRef, MutableRefObject } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import { defaults as defaultControls } from 'ol/control';
import ImageLayer from 'ol/layer/Image';
import VectorLayer from 'ol/layer/Vector';
import Static from 'ol/source/ImageStatic';
import VectorSource from 'ol/source/Vector';
import { Projection } from 'ol/proj';
import { getCenter } from 'ol/extent';
import { Style, Fill, Stroke } from 'ol/style';
import GeoJSON from 'ol/format/GeoJSON';
import { useAnnotationStore, hslToHex, MASK_COLOR_SATURATION, MASK_COLOR_LIGHTNESS } from '../../../store/annotationStore';

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

  // Round 33: every mask renders with a single uniform hue (store-level
  // setting, live-updatable). Read through a ref inside the style function
  // so changing the hue doesn't require recreating the map/view.
  const maskHue = useAnnotationStore((s) => s.maskHue);
  const maskHueRef = useRef(maskHue);
  maskHueRef.current = maskHue;

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
        const color = hslToHex(maskHueRef.current, MASK_COLOR_SATURATION, MASK_COLOR_LIGHTNESS);
        return new Style({
          fill: new Fill({
            color: color + '40',
          }),
          stroke: new Stroke({
            color,
            width: props.edge_width || 2,
          }),
        });
      },
    });
    vectorLayerRef.current = vectorLayer;

    const map = new Map({
      target: containerRef.current,
      layers: [imageLayer, vectorLayer],
      controls: defaultControls({ zoom: false }),
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

  // Round 33: force OL to re-invoke the style function for every rendered
  // feature when the mask hue changes, without recreating the map/view (which
  // would reset pan/zoom).
  useEffect(() => {
    vectorLayerRef.current?.changed();
  }, [maskHue]);

  return { map: mapRef, vectorSource: vectorSourceRef, vectorLayer: vectorLayerRef, imageLayerRef };
}

/** Export annotation features as GeoJSON */
export function exportAnnotationGeoJSON(vectorSource: VectorSource): object {
  const format = new GeoJSON();
  const features = vectorSource.getFeatures();
  return JSON.parse(format.writeFeatures(features));
}
