import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FieldInstallation, SunPosition, MapStyle, ShadingResult } from '../types';
import { haversineDistance, polygonArea } from '../lib/geoUtils';
import './MapView.css';

interface Props {
  installations: FieldInstallation[];
  activeId: string;
  panelGeoJSON: GeoJSON.FeatureCollection;
  shadowGeoJSON: GeoJSON.FeatureCollection;
  refPointGeoJSON: GeoJSON.FeatureCollection;
  sunPosition: SunPosition;
  timeMinutes: number;
  dateStr: string;
  mapStyle: MapStyle;
  placementMode: boolean;
  onMapClick: (lng: number, lat: number) => void;
  combinedShading: ShadingResult;
}

const SRC_PANELS = 'panels';
const SRC_SHADOWS = 'shadows';
const SRC_REF = 'ref-point';
const SRC_MEASURE_LINE = 'measure-line';
const SRC_MEASURE_PTS = 'measure-pts';
const LAYER_OSM = 'osm-tiles';
const LAYER_SAT = 'satellite-tiles';

const OSM_TILES = ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'];
// ESRI World Imagery (無料・APIキー不要)
const SAT_TILES = ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'];

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function measureLineGeoJSON(pts: [number, number][]): GeoJSON.FeatureCollection {
  if (pts.length < 2) return EMPTY_FC;
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature', id: 0, properties: {},
      geometry: { type: 'LineString', coordinates: pts },
    }],
  };
}

function measurePointsGeoJSON(pts: [number, number][]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pts.map((p, i) => ({
      type: 'Feature', id: i, properties: { idx: i },
      geometry: { type: 'Point', coordinates: p },
    })),
  };
}

const DEFAULT_LOCATION = { lat: 36.4028, lng: 138.2497 };

export default function MapView({
  installations, activeId, panelGeoJSON, shadowGeoJSON, refPointGeoJSON,
  sunPosition, timeMinutes, dateStr,
  mapStyle, placementMode, onMapClick,
  combinedShading,
}: Props) {
  const location = installations.find((i) => i.id === activeId)?.location
    ?? installations[0]?.location
    ?? DEFAULT_LOCATION;

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const initializedRef = useRef(false);

  // 最新 GeoJSON を ref で保持（クロージャ問題を回避）
  const panelRef = useRef(panelGeoJSON);
  const shadowRef = useRef(shadowGeoJSON);
  const refPtRef = useRef(refPointGeoJSON);
  panelRef.current = panelGeoJSON;
  shadowRef.current = shadowGeoJSON;
  refPtRef.current = refPointGeoJSON;

  // 3D地形
  const [terrain3D, setTerrain3D] = useState(false);

  // 計測ツール
  const [measureActive, setMeasureActive] = useState(false);
  const [measurePts, setMeasurePts] = useState<[number, number][]>([]);

  // 計測距離・面積
  const totalDist = measurePts.reduce((sum, pt, i) => {
    if (i === 0) return 0;
    return sum + haversineDistance(measurePts[i - 1], pt);
  }, 0);
  const area = measurePts.length >= 3 ? polygonArea(measurePts, location) : 0;

  // マップ初期化
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
          'osm': { type: 'raster', tiles: OSM_TILES, tileSize: 256, maxzoom: 19,
            attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors' },
          'satellite': { type: 'raster', tiles: SAT_TILES, tileSize: 256, maxzoom: 18,
            attribution: 'Esri, DigitalGlobe, Earthstar Geographics' },
          'terrain-dem': {
            type: 'raster-dem',
            tiles: ['https://cyberjapandata.gsi.go.jp/xyz/terrainrgb/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 14,
            encoding: 'mapbox',
            attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>',
          },
        },
        layers: [
          { id: LAYER_OSM, type: 'raster', source: 'osm' },
          { id: LAYER_SAT, type: 'raster', source: 'satellite', layout: { visibility: 'none' } },
        ],
      },
      center: [location.lng, location.lat],
      zoom: 18,
      preserveDrawingBuffer: true,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    map.on('load', () => {
      // データソース
      map.addSource(SRC_SHADOWS, { type: 'geojson', data: shadowRef.current });
      map.addSource(SRC_PANELS,  { type: 'geojson', data: panelRef.current });
      map.addSource(SRC_REF,     { type: 'geojson', data: refPtRef.current });
      map.addSource(SRC_MEASURE_LINE, { type: 'geojson', data: EMPTY_FC });
      map.addSource(SRC_MEASURE_PTS,  { type: 'geojson', data: EMPTY_FC });

      // 影
      map.addLayer({ id: 'shadow-fill', type: 'fill', source: SRC_SHADOWS,
        paint: { 'fill-color': '#1e293b', 'fill-opacity': 0.42 } });
      // パネル（藤棚=青 / 法面=オレンジ）
      map.addLayer({ id: 'panel-fill', type: 'fill', source: SRC_PANELS,
        paint: { 'fill-color': ['match', ['get', 'installationType'], 'slope', '#f97316', '#3b82f6'], 'fill-opacity': 0.68 } });
      map.addLayer({ id: 'panel-outline', type: 'line', source: SRC_PANELS,
        paint: { 'line-color': ['match', ['get', 'installationType'], 'slope', '#c2410c', '#1d4ed8'], 'line-width': 1.5 } });
      // 基準点（藤棚=青 / 法面=オレンジ）
      map.addLayer({ id: 'ref-circle', type: 'circle', source: SRC_REF,
        paint: { 'circle-radius': 6, 'circle-color': ['match', ['get', 'installationType'], 'slope', '#f97316', '#3b82f6'], 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });
      // 計測ライン
      map.addLayer({ id: 'measure-line', type: 'line', source: SRC_MEASURE_LINE,
        paint: { 'line-color': '#f59e0b', 'line-width': 2, 'line-dasharray': [4, 2] } });
      // 計測点
      map.addLayer({ id: 'measure-pts', type: 'circle', source: SRC_MEASURE_PTS,
        paint: { 'circle-radius': 5, 'circle-color': '#f59e0b', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; initializedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // GeoJSON 更新
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    (map.getSource(SRC_PANELS) as maplibregl.GeoJSONSource)?.setData(panelGeoJSON);
    (map.getSource(SRC_SHADOWS) as maplibregl.GeoJSONSource)?.setData(shadowGeoJSON);
    (map.getSource(SRC_REF) as maplibregl.GeoJSONSource)?.setData(refPointGeoJSON);
  }, [panelGeoJSON, shadowGeoJSON, refPointGeoJSON]);

  // 地図スタイル切り替え
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    map.setLayoutProperty(LAYER_OSM, 'visibility', mapStyle === 'street' ? 'visible' : 'none');
    map.setLayoutProperty(LAYER_SAT, 'visibility', mapStyle === 'satellite' ? 'visible' : 'none');
  }, [mapStyle]);

  // 3D地形トグル
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (terrain3D) {
      map.setTerrain({ source: 'terrain-dem', exaggeration: 1.5 });
      map.easeTo({ pitch: 45, duration: 600 });
    } else {
      map.setTerrain(null);
      map.easeTo({ pitch: 0, duration: 600 });
    }
  }, [terrain3D]);

  // 地点変更でマップ移動
  useEffect(() => {
    mapRef.current?.flyTo({ center: [location.lng, location.lat], zoom: 18, duration: 1000 });
  }, [location.lat, location.lng]);

  // 計測ライン更新
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    (map.getSource(SRC_MEASURE_LINE) as maplibregl.GeoJSONSource)?.setData(measureLineGeoJSON(measurePts));
    (map.getSource(SRC_MEASURE_PTS) as maplibregl.GeoJSONSource)?.setData(measurePointsGeoJSON(measurePts));
  }, [measurePts]);

  // クリックイベント（配置 or 計測）
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handler = (e: maplibregl.MapMouseEvent) => {
      const { lng, lat } = e.lngLat;
      if (placementMode) {
        onMapClick(lng, lat);
      } else if (measureActive) {
        setMeasurePts((prev) => [...prev, [lng, lat]]);
      }
    };
    map.on('click', handler);
    return () => { map.off('click', handler); };
  }, [placementMode, measureActive, onMapClick]);

  // カーソル変更
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = (placementMode || measureActive) ? 'crosshair' : '';
  }, [placementMode, measureActive]);

  const isNight = sunPosition.altitude <= 0;
  const h = Math.floor(timeMinutes / 60) % 24;
  const m = Math.floor(timeMinutes % 60);
  const timeStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;

  const fmtDist = (d: number) => d < 1000 ? `${d.toFixed(1)} m` : `${(d / 1000).toFixed(3)} km`;
  const fmtArea = (a: number) => a < 10000 ? `${a.toFixed(1)} m²` : `${(a / 10000).toFixed(2)} ha`;

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
            <div className="overlay-sun">☀ 高度 {sunPosition.altitude.toFixed(1)}° / 方位 {sunPosition.azimuth.toFixed(1)}°</div>
          )}
          {installations.length > 1 && !isNight && (
            <div className="overlay-shading">🌤 合計遮光率 {combinedShading.shadingRatioPct.toFixed(1)}%</div>
          )}
          {placementMode && (
            <div className="overlay-hint placement">🎯 クリックしてパネル配置位置を指定</div>
          )}
        </div>
      </div>

      {/* 計測ツール・3D地形ボタン */}
      <div className="map-overlay top-right-measure">
        <div className="measure-controls">
          <button
            className={`btn-terrain ${terrain3D ? 'active' : ''}`}
            onClick={() => setTerrain3D((v) => !v)}
            title="国土地理院の標高データを使用した3D地形表示（日本国内のみ）"
          >
            {terrain3D ? '🏔 3D地形 ON' : '🏔 3D地形'}
          </button>
          <button
            className={`btn-measure ${measureActive ? 'active' : ''}`}
            onClick={() => { setMeasureActive((v) => !v); if (measureActive) setMeasurePts([]); }}
          >
            {measureActive ? '📏 計測中（クリックで点追加）' : '📏 距離・面積を計測'}
          </button>
          {measurePts.length > 0 && (
            <button className="btn-measure-clear" onClick={() => setMeasurePts([])}>クリア</button>
          )}
        </div>

        {/* 計測結果 */}
        {measurePts.length >= 2 && (
          <div className="measure-result">
            <div className="measure-row">
              <span>総距離</span>
              <strong>{fmtDist(totalDist)}</strong>
            </div>
            {measurePts.length >= 3 && (
              <div className="measure-row">
                <span>面積（多角形）</span>
                <strong>{fmtArea(area)}</strong>
              </div>
            )}
            <p className="measure-hint">ダブルクリックで確定 / クリアで再計測</p>
          </div>
        )}
      </div>

      {/* 凡例 */}
      <div className="map-overlay bottom-left">
        <div className="legend">
          {installations.some((i) => i.installationType === 'pergola') && (
            <div className="legend-item"><span className="legend-color panel"></span>藤棚パネル</div>
          )}
          {installations.some((i) => i.installationType === 'slope') && (
            <div className="legend-item"><span className="legend-color panel-slope"></span>法面パネル</div>
          )}
          <div className="legend-item"><span className="legend-color shadow"></span>影</div>
          <div className="legend-item"><span className="legend-color ref"></span>基準点</div>
          {measurePts.length > 0 && <div className="legend-item"><span className="legend-color measure"></span>計測</div>}
        </div>
      </div>
    </div>
  );
}
