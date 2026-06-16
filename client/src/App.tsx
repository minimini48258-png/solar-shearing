import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  FieldInstallation, PanelConfig, SlopeConfig, AnyConfig,
  InstallationType, MapStyle, DesignCase, ShadingResult,
} from './types';
import { getSunPosition, SEASON_PRESETS } from './lib/solar';
import { generatePanels, getPanelSummary } from './lib/panelGeometry';
import { generateSlopePanels, getSlopeSummary } from './lib/slopePanelGeometry';
import { computeShadows } from './lib/shadow';
import { panelsToGeoJSON, shadowsToGeoJSON, refPointsToGeoJSON, mergeFeatureCollections } from './lib/geojson';
import { calcShadingResult } from './lib/shadingCalc';
import { loadDesigns, addDesign, deleteDesign } from './lib/storage';
import { encodeShare, decodeShare } from './lib/sharing';
import { calcDailyAverageShadingPct } from './lib/dailyShading';
import SidePanel from './components/SidePanel';
import MapView from './components/MapView';
import './App.css';

// ===== デフォルト =====
const DEF_LOC = { lat: 36.4028, lng: 138.2497 }; // 上田市

const DEF_PERGOLA: PanelConfig = {
  type: 'pergola', mountHeight: 2.5, tiltAngle: 15,
  panelWidth: 1.0, panelDepth: 2.0,
  colsEW: 4, rowsNS: 3, ewSpacing: 1.5, nsSpacing: 3.5,
  facingAzimuth: 180, rackRotation: 0,
};

const DEF_SLOPE: SlopeConfig = {
  type: 'slope', slopeAngle: 25, facingAzimuth: 180, additionalTilt: 5,
  panelWidth: 1.0, panelDepth: 2.0,
  colsAcross: 4, rowsDown: 3, acrossSpacing: 1.2, downSpacing: 2.5,
  baseMountHeight: 0.3,
};

function makeInst(type: InstallationType, suffix: string, loc = DEF_LOC): FieldInstallation {
  return {
    id: `${type}-${Date.now()}-${suffix}`,
    name: type === 'pergola' ? `藤棚${suffix}` : `法面${suffix}`,
    installationType: type,
    location: loc,
    config: type === 'pergola' ? { ...DEF_PERGOLA } : { ...DEF_SLOPE },
  };
}

export default function App() {
  // ===== 複数設置 =====
  const [installations, setInstallations] = useState<FieldInstallation[]>([
    { ...makeInst('pergola', '1'), id: 'default-pergola' },
  ]);
  const [activeId, setActiveId] = useState<string>('default-pergola');

  // ===== マップ =====
  const [mapStyle, setMapStyle] = useState<MapStyle>('street');
  const [placementMode, setPlacementMode] = useState(false);

  // ===== 日時 =====
  const [dateStr, setDateStr] = useState('2025-06-21');
  const [timeMinutes, setTimeMinutes] = useState(720);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(20);

  // ===== 保存案 =====
  const [savedCases, setSavedCases] = useState<DesignCase[]>(() => loadDesigns());

  // ===== 共有 =====
  const [shareCopied, setShareCopied] = useState(false);

  // ===== 日平均遮光率 =====
  const [dailyAvgResults, setDailyAvgResults] = useState<Record<string, number>>({});
  const [isCalcingDaily, setIsCalcingDaily] = useState(false);

  // URL に共有データがあれば読込（初回マウント時のみ）
  useEffect(() => {
    const shared = decodeShare(window.location.hash);
    if (shared) {
      setInstallations(shared.installations);
      setActiveId(shared.installations[0]?.id ?? '');
      if (shared.dateStr) setDateStr(shared.dateStr);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== アニメーション =====
  const animRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isPlaying) {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
      lastTsRef.current = null;
      return;
    }
    const tick = (ts: number) => {
      if (lastTsRef.current !== null) {
        const el = (ts - lastTsRef.current) / 1000;
        setTimeMinutes((p) => (p + el * playSpeed) % 1440);
      }
      lastTsRef.current = ts;
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [isPlaying, playSpeed]);

  // ===== 計算 =====

  const datetime = useMemo(() => {
    const h = Math.floor(timeMinutes / 60), m = Math.floor(timeMinutes % 60);
    return new Date(`${dateStr}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+09:00`);
  }, [dateStr, timeMinutes]);

  // 全設置ごとの計算結果
  const installationData = useMemo(() => {
    return installations.map((inst) => {
      const sunPos = getSunPosition(inst.location.lat, inst.location.lng, datetime);
      const panels = inst.installationType === 'pergola'
        ? generatePanels(inst.config as PanelConfig)
        : generateSlopePanels(inst.config as SlopeConfig);
      const shadows = computeShadows(panels, sunPos);
      const panelGJ  = panelsToGeoJSON(panels, inst.location, inst.installationType, inst.id);
      const shadowGJ = shadowsToGeoJSON(shadows, inst.location, inst.installationType, inst.id);
      const shading  = calcShadingResult(inst.id, inst.config, shadows);
      const summary  = inst.installationType === 'pergola'
        ? getPanelSummary(inst.config as PanelConfig)
        : getSlopeSummary(inst.config as SlopeConfig);
      return { inst, sunPos, panelGJ, shadowGJ, shading, summary };
    });
  }, [installations, datetime]);

  // アクティブ設置の太陽位置（HUD 表示用）
  const activeData = useMemo(
    () => installationData.find((d) => d.inst.id === activeId) ?? installationData[0],
    [installationData, activeId]
  );

  // マージ GeoJSON（MapView へ渡す）
  const panelGeoJSON  = useMemo(() => mergeFeatureCollections(installationData.map((d) => d.panelGJ)), [installationData]);
  const shadowGeoJSON = useMemo(() => mergeFeatureCollections(installationData.map((d) => d.shadowGJ)), [installationData]);
  const refGeoJSON    = useMemo(() => refPointsToGeoJSON(installations), [installations]);

  // 全体の遮光率合計
  const combinedShading = useMemo((): ShadingResult => {
    const totalShadow  = installationData.reduce((s, d) => s + d.shading.shadowAreaM2, 0);
    const totalField   = installationData.reduce((s, d) => s + d.shading.fieldAreaM2, 0);
    const totalPanel   = installationData.reduce((s, d) => s + d.shading.panelAreaM2, 0);
    return {
      installationId: 'combined',
      shadowAreaM2: totalShadow,
      fieldAreaM2: totalField,
      shadingRatioPct: totalField > 0 ? Math.min(100, (totalShadow / totalField) * 100) : 0,
      panelAreaM2: totalPanel,
      coverageRatioPct: totalField > 0 ? Math.min(100, (totalPanel / totalField) * 100) : 0,
    };
  }, [installationData]);

  // ===== 設置操作 =====

  const addInstallation = useCallback((type: InstallationType) => {
    const existingCount = installations.filter((i) => i.installationType === type).length;
    const suffix = String(existingCount + 1);
    // 既存の設置から少しオフセットした位置に配置
    const baseLoc = installations.length > 0
      ? { ...installations[installations.length - 1].location, lng: installations[installations.length - 1].location.lng + 0.001 }
      : DEF_LOC;
    const newInst = makeInst(type, suffix, baseLoc);
    setInstallations((prev) => [...prev, newInst]);
    setActiveId(newInst.id);
  }, [installations]);

  const removeInstallation = useCallback((id: string) => {
    setInstallations((prev) => {
      const next = prev.filter((i) => i.id !== id);
      if (next.length === 0) return prev; // 最低1つは残す
      return next;
    });
    setActiveId((prev) => {
      const remaining = installations.filter((i) => i.id !== id);
      if (remaining.length === 0) return '';
      return prev === id ? remaining[0].id : prev;
    });
  }, [installations]);

  const updateInstallation = useCallback((id: string, patch: Partial<FieldInstallation>) => {
    setInstallations((prev) => prev.map((i) => i.id === id ? { ...i, ...patch } : i));
  }, []);

  const updateActiveConfig = useCallback((config: AnyConfig) => {
    updateInstallation(activeId, { config });
  }, [activeId, updateInstallation]);

  const updateActiveLocation = useCallback((location: { lat: number; lng: number }) => {
    updateInstallation(activeId, { location });
  }, [activeId, updateInstallation]);

  const handleMapClick = useCallback((lng: number, lat: number) => {
    if (placementMode) {
      updateActiveLocation({ lat, lng });
      setPlacementMode(false);
    }
  }, [placementMode, updateActiveLocation]);

  // ===== 保存案 =====

  const handleSaveCase = useCallback((name: string) => {
    const c: DesignCase = { id: Date.now().toString(), name, installations: [...installations], createdAt: new Date().toISOString() };
    setSavedCases((prev) => addDesign(prev, c));
  }, [installations]);

  const handleLoadCase = useCallback((c: DesignCase) => {
    setInstallations(c.installations);
    setActiveId(c.installations[0]?.id ?? '');
  }, []);

  const handleDeleteCase = useCallback((id: string) => {
    setSavedCases((prev) => deleteDesign(prev, id));
  }, []);

  const handleShareURL = useCallback(async () => {
    const url = encodeShare(installations, dateStr);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // クリップボード API が使えない環境向けフォールバック
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2500);
  }, [installations, dateStr]);

  // ===== 藤棚＋法面 テンプレート =====
  const handleAddBothTemplate = useCallback(() => {
    const baseLoc = installations.length > 0 ? installations[installations.length - 1].location : DEF_LOC;
    const pergola = makeInst('pergola', String(installations.filter((i) => i.installationType === 'pergola').length + 1), baseLoc);
    const slopeLoc = { ...baseLoc, lng: baseLoc.lng + 0.0015 };
    const slope = makeInst('slope', String(installations.filter((i) => i.installationType === 'slope').length + 1), slopeLoc);
    setInstallations((prev) => [...prev, pergola, slope]);
    setActiveId(pergola.id);
  }, [installations]);

  // ===== 日平均遮光率の計算 =====
  const handleCalcDailyAvg = useCallback(() => {
    setIsCalcingDaily(true);
    // 計算が重いため次フレームにずらしてUIブロックを避ける
    setTimeout(() => {
      const results: Record<string, number> = {};
      for (const inst of installations) {
        results[inst.id] = calcDailyAverageShadingPct(inst, dateStr);
      }
      setDailyAvgResults(results);
      setIsCalcingDaily(false);
    }, 0);
  }, [installations, dateStr]);

  const handleExportJSON = useCallback(() => {
    const data = {
      version: '0.3', exportedAt: new Date().toISOString(),
      installations,
      dateStr, timeMinutes: Math.floor(timeMinutes),
      shadingResults: installationData.map((d) => d.shading),
      combined: combinedShading,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `solar-design-${dateStr}.json`; a.click();
    URL.revokeObjectURL(url);
  }, [installations, dateStr, timeMinutes, installationData, combinedShading]);

  // 設置構成や日付が変わったら日平均遮光率の結果は古くなるためクリア
  useEffect(() => {
    setDailyAvgResults({});
  }, [installations, dateStr]);

  const activeInst = installations.find((i) => i.id === activeId);

  return (
    <div className="app-layout">
      <SidePanel
        installations={installations}
        activeId={activeId}
        onSelectActive={setActiveId}
        onAddInstallation={addInstallation}
        onAddBothTemplate={handleAddBothTemplate}
        onRemoveInstallation={removeInstallation}
        onUpdateName={(id, name) => updateInstallation(id, { name })}
        activeInst={activeInst}
        onConfigChange={updateActiveConfig}
        onLocationChange={updateActiveLocation}
        installationData={installationData.map((d) => ({ id: d.inst.id, shading: d.shading, summary: d.summary, sunPos: d.sunPos }))}
        combinedShading={combinedShading}
        dateStr={dateStr}
        onDateChange={setDateStr}
        timeMinutes={timeMinutes}
        onTimeChange={setTimeMinutes}
        isPlaying={isPlaying}
        onPlayToggle={() => setIsPlaying((p) => !p)}
        playSpeed={playSpeed}
        onPlaySpeedChange={setPlaySpeed}
        sunPosition={activeData?.sunPos ?? { azimuth: 180, altitude: 45 }}
        onSeasonPreset={(key) => { const p = SEASON_PRESETS[key]; if (p) setDateStr(p.dateStr); }}
        mapStyle={mapStyle}
        onMapStyleChange={setMapStyle}
        placementMode={placementMode}
        onPlacementModeToggle={() => setPlacementMode((p) => !p)}
        savedCases={savedCases}
        onSaveCase={handleSaveCase}
        onLoadCase={handleLoadCase}
        onDeleteCase={handleDeleteCase}
        onExportJSON={handleExportJSON}
        onShareURL={handleShareURL}
        shareCopied={shareCopied}
        dailyAvgResults={dailyAvgResults}
        isCalcingDaily={isCalcingDaily}
        onCalcDailyAvg={handleCalcDailyAvg}
      />
      <MapView
        panelGeoJSON={panelGeoJSON}
        shadowGeoJSON={shadowGeoJSON}
        refPointGeoJSON={refGeoJSON}
        activeId={activeId}
        sunPosition={activeData?.sunPos ?? { azimuth: 180, altitude: 45 }}
        timeMinutes={timeMinutes}
        dateStr={dateStr}
        mapStyle={mapStyle}
        placementMode={placementMode}
        onMapClick={handleMapClick}
        combinedShading={combinedShading}
        installations={installations}
      />
    </div>
  );
}
