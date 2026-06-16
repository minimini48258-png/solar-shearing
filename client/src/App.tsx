import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { PanelConfig, GeoPoint } from './types';
import { getSunPosition, SEASON_PRESETS } from './lib/solar';
import { generatePanels } from './lib/panelGeometry';
import { computeShadows } from './lib/shadow';
import { panelsToGeoJSON, shadowsToGeoJSON, refPointToGeoJSON } from './lib/geojson';
import SidePanel from './components/SidePanel';
import MapView from './components/MapView';
import './App.css';

// デフォルト値: 上田市（長野県）
const DEFAULT_LOCATION: GeoPoint = { lat: 36.4028, lng: 138.2497 };

const DEFAULT_PANEL_CONFIG: PanelConfig = {
  type: 'pergola',
  mountHeight: 2.5,
  tiltAngle: 15,
  panelWidth: 1.0,
  panelDepth: 2.0,
  colsEW: 4,
  rowsNS: 3,
  ewSpacing: 1.5,
  nsSpacing: 3.5,
  facingAzimuth: 180,
  rackRotation: 0,
};

const DEFAULT_DATE = '2025-06-21';  // 夏至
const DEFAULT_TIME_MINUTES = 720;   // 正午

export default function App() {
  const [location, setLocation] = useState<GeoPoint>(DEFAULT_LOCATION);
  const [panelConfig, setPanelConfig] = useState<PanelConfig>(DEFAULT_PANEL_CONFIG);
  const [dateStr, setDateStr] = useState(DEFAULT_DATE);
  const [timeMinutes, setTimeMinutes] = useState(DEFAULT_TIME_MINUTES);
  const [isPlaying, setIsPlaying] = useState(false);

  const animFrameRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number | null>(null);
  // 1秒 = シミュレーション内 20分
  const SIM_SPEED = 20;

  // 再生ループ
  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
        lastTimestampRef.current = null;
      }
      return;
    }

    const tick = (timestamp: number) => {
      if (lastTimestampRef.current !== null) {
        const elapsed = (timestamp - lastTimestampRef.current) / 1000; // 秒
        setTimeMinutes((prev) => {
          const next = (prev + elapsed * SIM_SPEED) % 1440;
          return next;
        });
      }
      lastTimestampRef.current = timestamp;
      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying]);

  // 日付時刻オブジェクト（UTC+9 として解釈）
  const datetime = useMemo(() => {
    const h = Math.floor(timeMinutes / 60);
    const m = Math.floor(timeMinutes % 60);
    // YYYY-MM-DDTHH:mm:00+09:00 でパース
    return new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`);
  }, [dateStr, timeMinutes]);

  // 太陽位置
  const sunPosition = useMemo(
    () => getSunPosition(location.lat, location.lng, datetime),
    [location, datetime]
  );

  // パネル形状（3D）
  const panels = useMemo(() => generatePanels(panelConfig), [panelConfig]);

  // 影形状
  const shadows = useMemo(() => computeShadows(panels, sunPosition), [panels, sunPosition]);

  // GeoJSON（MapLibre 用）
  const panelGeoJSON = useMemo(() => panelsToGeoJSON(panels, location), [panels, location]);
  const shadowGeoJSON = useMemo(() => shadowsToGeoJSON(shadows, location), [shadows, location]);
  const refPointGeoJSON = useMemo(() => refPointToGeoJSON(location), [location]);

  const handleSeasonPreset = useCallback((key: string) => {
    const preset = SEASON_PRESETS[key];
    if (preset) setDateStr(preset.dateStr);
  }, []);

  const handleExportJSON = useCallback(() => {
    const data = {
      version: '0.1',
      exportedAt: new Date().toISOString(),
      location,
      panelConfig,
      dateStr,
      timeMinutes: Math.floor(timeMinutes),
      sunPosition,
      summary: {
        totalPanels: panelConfig.colsEW * panelConfig.rowsNS,
        estimatedKw: (panelConfig.colsEW * panelConfig.rowsNS * panelConfig.panelWidth * panelConfig.panelDepth * 0.22).toFixed(2),
      },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `solar-design-${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [location, panelConfig, dateStr, timeMinutes, sunPosition]);

  return (
    <div className="app-layout">
      <SidePanel
        location={location}
        onLocationChange={setLocation}
        panelConfig={panelConfig}
        onPanelConfigChange={setPanelConfig}
        dateStr={dateStr}
        onDateChange={setDateStr}
        timeMinutes={timeMinutes}
        onTimeChange={setTimeMinutes}
        isPlaying={isPlaying}
        onPlayToggle={() => setIsPlaying((p) => !p)}
        sunPosition={sunPosition}
        onSeasonPreset={handleSeasonPreset}
        onExportJSON={handleExportJSON}
      />
      <MapView
        location={location}
        panelGeoJSON={panelGeoJSON}
        shadowGeoJSON={shadowGeoJSON}
        refPointGeoJSON={refPointGeoJSON}
        sunPosition={sunPosition}
        timeMinutes={timeMinutes}
        dateStr={dateStr}
      />
    </div>
  );
}
