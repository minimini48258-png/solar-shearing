import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  PanelConfig, SlopeConfig, AnyConfig,
  InstallationType, MapStyle, GeoPoint, DesignCase,
} from './types';
import { getSunPosition, SEASON_PRESETS } from './lib/solar';
import { generatePanels, getPanelSummary } from './lib/panelGeometry';
import { generateSlopePanels, getSlopeSummary } from './lib/slopePanelGeometry';
import { computeShadows } from './lib/shadow';
import { panelsToGeoJSON, shadowsToGeoJSON, refPointToGeoJSON } from './lib/geojson';
import { loadDesigns, addDesign, deleteDesign } from './lib/storage';
import SidePanel from './components/SidePanel';
import MapView from './components/MapView';
import './App.css';

// ===== デフォルト値 =====

const DEFAULT_LOCATION: GeoPoint = { lat: 36.4028, lng: 138.2497 }; // 上田市

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

const DEFAULT_SLOPE_CONFIG: SlopeConfig = {
  type: 'slope',
  slopeAngle: 25,
  facingAzimuth: 180,
  additionalTilt: 5,
  panelWidth: 1.0,
  panelDepth: 2.0,
  colsAcross: 4,
  rowsDown: 3,
  acrossSpacing: 1.2,
  downSpacing: 2.5,
  baseMountHeight: 0.3,
};

export default function App() {
  // ===== 地点・マップ =====
  const [location, setLocation] = useState<GeoPoint>(DEFAULT_LOCATION);
  const [mapStyle, setMapStyle] = useState<MapStyle>('street');
  const [placementMode, setPlacementMode] = useState(false);

  // ===== 設置タイプ・設定 =====
  const [installationType, setInstallationType] = useState<InstallationType>('pergola');
  const [panelConfig, setPanelConfig] = useState<PanelConfig>(DEFAULT_PANEL_CONFIG);
  const [slopeConfig, setSlopeConfig] = useState<SlopeConfig>(DEFAULT_SLOPE_CONFIG);

  // ===== 日時 =====
  const [dateStr, setDateStr] = useState('2025-06-21');
  const [timeMinutes, setTimeMinutes] = useState(720);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(20); // シミュレーション分/実秒

  // ===== 保存設計案 =====
  const [savedCases, setSavedCases] = useState<DesignCase[]>(() => loadDesigns());

  // ===== アニメーション =====
  const animFrameRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
      lastTsRef.current = null;
      return;
    }
    const tick = (ts: number) => {
      if (lastTsRef.current !== null) {
        const elapsed = (ts - lastTsRef.current) / 1000;
        setTimeMinutes((prev) => (prev + elapsed * playSpeed) % 1440);
      }
      lastTsRef.current = ts;
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => { if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current); };
  }, [isPlaying, playSpeed]);

  // ===== 計算（useMemo） =====

  const datetime = useMemo(() => {
    const h = Math.floor(timeMinutes / 60);
    const m = Math.floor(timeMinutes % 60);
    return new Date(`${dateStr}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+09:00`);
  }, [dateStr, timeMinutes]);

  const sunPosition = useMemo(
    () => getSunPosition(location.lat, location.lng, datetime),
    [location, datetime]
  );

  const panels = useMemo(() => {
    if (installationType === 'pergola') return generatePanels(panelConfig);
    return generateSlopePanels(slopeConfig);
  }, [installationType, panelConfig, slopeConfig]);

  const shadows = useMemo(() => computeShadows(panels, sunPosition), [panels, sunPosition]);

  const panelGeoJSON = useMemo(() => panelsToGeoJSON(panels, location), [panels, location]);
  const shadowGeoJSON = useMemo(() => shadowsToGeoJSON(shadows, location), [shadows, location]);
  const refPointGeoJSON = useMemo(() => refPointToGeoJSON(location), [location]);

  const summary = useMemo(() => {
    if (installationType === 'pergola') return getPanelSummary(panelConfig);
    return getSlopeSummary(slopeConfig);
  }, [installationType, panelConfig, slopeConfig]);

  // ===== ハンドラ =====

  const handleSeasonPreset = useCallback((key: string) => {
    const preset = SEASON_PRESETS[key];
    if (preset) setDateStr(preset.dateStr);
  }, []);

  const handleMapClick = useCallback((lng: number, lat: number) => {
    if (placementMode) {
      setLocation({ lat, lng });
      setPlacementMode(false);
    }
  }, [placementMode]);

  const handleSaveCase = useCallback((name: string) => {
    const activeConfig: AnyConfig = installationType === 'pergola' ? panelConfig : slopeConfig;
    const newCase: DesignCase = {
      id: Date.now().toString(),
      name,
      location,
      installationType,
      config: activeConfig,
      createdAt: new Date().toISOString(),
    };
    setSavedCases((prev) => addDesign(prev, newCase));
  }, [installationType, panelConfig, slopeConfig, location]);

  const handleLoadCase = useCallback((c: DesignCase) => {
    setLocation(c.location);
    setInstallationType(c.installationType);
    if (c.installationType === 'pergola') setPanelConfig(c.config as PanelConfig);
    else setSlopeConfig(c.config as SlopeConfig);
  }, []);

  const handleDeleteCase = useCallback((id: string) => {
    setSavedCases((prev) => deleteDesign(prev, id));
  }, []);

  const handleExportJSON = useCallback(() => {
    const activeConfig: AnyConfig = installationType === 'pergola' ? panelConfig : slopeConfig;
    const data = {
      version: '0.2',
      exportedAt: new Date().toISOString(),
      location,
      installationType,
      config: activeConfig,
      dateStr,
      timeMinutes: Math.floor(timeMinutes),
      sunPosition,
      summary,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `solar-design-${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [location, installationType, panelConfig, slopeConfig, dateStr, timeMinutes, sunPosition, summary]);

  return (
    <div className="app-layout">
      <SidePanel
        location={location}
        onLocationChange={setLocation}
        installationType={installationType}
        onInstallationTypeChange={setInstallationType}
        panelConfig={panelConfig}
        onPanelConfigChange={setPanelConfig}
        slopeConfig={slopeConfig}
        onSlopeConfigChange={setSlopeConfig}
        summary={summary}
        dateStr={dateStr}
        onDateChange={setDateStr}
        timeMinutes={timeMinutes}
        onTimeChange={setTimeMinutes}
        isPlaying={isPlaying}
        onPlayToggle={() => setIsPlaying((p) => !p)}
        playSpeed={playSpeed}
        onPlaySpeedChange={setPlaySpeed}
        sunPosition={sunPosition}
        onSeasonPreset={handleSeasonPreset}
        mapStyle={mapStyle}
        onMapStyleChange={setMapStyle}
        placementMode={placementMode}
        onPlacementModeToggle={() => setPlacementMode((p) => !p)}
        savedCases={savedCases}
        onSaveCase={handleSaveCase}
        onLoadCase={handleLoadCase}
        onDeleteCase={handleDeleteCase}
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
        mapStyle={mapStyle}
        placementMode={placementMode}
        onMapClick={handleMapClick}
      />
    </div>
  );
}
