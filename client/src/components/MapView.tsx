import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { GeoPoint, SunPosition } from '../types';
import './MapView.css';

interface Props {
  location: GeoPoint;
  panelGeoJSON: GeoJSON.FeatureCollection;
  shadowGeoJSON: GeoJSON.FeatureCollection;
  refPointGeoJSON: GeoJSON.FeatureCollection;
  sunPosition: SunPosition;
  timeMinutes: number;
  dateStr: string;
}

const SRC_PANELS = 'panels';
const SRC_SHADOWS = 'shadows';
const SRC_REF = 'ref-point';

export default function MapView({
  location, panelGeoJSON, shadowGeoJSON, refPointGeoJSON,
  sunPosition, timeMinutes, dateStr,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const initializedRef = useRef(false);

  // 常に最新の GeoJSON を保持する ref（クロージャ問題を回避）
  const panelDataRef = useRef(panelGeoJSON);
  const shadowDataRef = useRef(shadowGeoJSON);
  const refDataRef = useRef(refPointGeoJSON);

  panelDataRef.current = panelGeoJSON;
  shadowDataRef.current = shadowGeoJSON;
  refDataRef.current = refPointGeoJSON;

  // マップ初期化（1回だけ）
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
          'osm-tiles': {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
            maxzoom: 19,
          },
        },
        layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm-tiles' }],
      },
      center: [location.lng, location.lat],
      zoom: 18,
      preserveDrawingBuffer: true,  // PNG スクリーンショット用
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    map.on('load', () => {
      // ref から最新値を読む（クロージャではなく）
      map.addSource(SRC_SHADOWS, { type: 'geojson', data: shadowDataRef.current });
      map.addSource(SRC_PANELS, { type: 'geojson', data: panelDataRef.current });
      map.addSource(SRC_REF, { type: 'geojson', data: refDataRef.current });

      // 影レイヤー（パネルより下に描画）
      map.addLayer({
        id: 'shadow-fill',
        type: 'fill',
        source: SRC_SHADOWS,
        paint: { 'fill-color': '#1e293b', 'fill-opacity': 0.42 },
      });

      // パネル（塗り）
      map.addLayer({
        id: 'panel-fill',
        type: 'fill',
        source: SRC_PANELS,
        paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.68 },
      });

      // パネル（輪郭）
      map.addLayer({
        id: 'panel-outline',
        type: 'line',
        source: SRC_PANELS,
        paint: { 'line-color': '#1d4ed8', 'line-width': 1.5 },
      });

      // 基準点
      map.addLayer({
        id: 'ref-circle',
        type: 'circle',
        source: SRC_REF,
        paint: {
          'circle-radius': 6,
          'circle-color': '#ef4444',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      initializedRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // GeoJSON データ更新
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    (map.getSource(SRC_PANELS) as maplibregl.GeoJSONSource)?.setData(panelGeoJSON);
    (map.getSource(SRC_SHADOWS) as maplibregl.GeoJSONSource)?.setData(shadowGeoJSON);
    (map.getSource(SRC_REF) as maplibregl.GeoJSONSource)?.setData(refPointGeoJSON);
  }, [panelGeoJSON, shadowGeoJSON, refPointGeoJSON]);

  // 地点変更でマップを移動
  useEffect(() => {
    mapRef.current?.flyTo({ center: [location.lng, location.lat], zoom: 18, duration: 1000 });
  }, [location]);

  const isNight = sunPosition.altitude <= 0;
  const h = Math.floor(timeMinutes / 60) % 24;
  const m = Math.floor(timeMinutes % 60);
  const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  return (
    <div className="map-container">
      <div ref={containerRef} className="map-view" />

      {/* 情報オーバーレイ */}
      <div className="map-overlay top-left">
        <div className="overlay-card">
          <div className="overlay-date">{dateStr} {timeStr} JST</div>
          {isNight ? (
            <div className="overlay-sun night">🌙 夜間（影なし）</div>
          ) : (
            <div className="overlay-sun">
              ☀ 高度 {sunPosition.altitude.toFixed(1)}° / 方位 {sunPosition.azimuth.toFixed(1)}°
            </div>
          )}
        </div>
      </div>

      {/* 凡例 */}
      <div className="map-overlay bottom-left">
        <div className="legend">
          <div className="legend-item"><span className="legend-color panel"></span>パネル</div>
          <div className="legend-item"><span className="legend-color shadow"></span>影</div>
          <div className="legend-item"><span className="legend-color ref"></span>基準点</div>
        </div>
      </div>
    </div>
  );
}
