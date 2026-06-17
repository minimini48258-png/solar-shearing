import { useState, useCallback } from 'react';
import {
  FieldInstallation, PanelConfig, SlopeConfig, AnyConfig,
  InstallationType, MapStyle, DesignCase, ShadingResult, SunPosition, GroundSlope, TerrainElevation,
} from '../types';
import { geocodeAddress } from '../lib/geoUtils';
import { SEASON_PRESETS, getSunTimes } from '../lib/solar';
import './SidePanel.css';

const NOON = 720;
const SPEED_OPTIONS = [
  { label: '×½', value: 10 }, { label: '×1', value: 20 },
  { label: '×2', value: 40 }, { label: '×4', value: 80 }, { label: '×8', value: 160 },
];

interface InstData { id: string; shading: ShadingResult; summary: { totalPanels: number; totalArea: number; estimatedKw: number }; sunPos: SunPosition; }

interface Props {
  installations: FieldInstallation[];
  activeId: string;
  onSelectActive: (id: string) => void;
  onAddInstallation: (type: InstallationType) => void;
  onAddBothTemplate: () => void;
  onRemoveInstallation: (id: string) => void;
  onUpdateName: (id: string, name: string) => void;
  activeInst?: FieldInstallation;
  onConfigChange: (c: AnyConfig) => void;
  onGroundSlopeChange: (gs: GroundSlope) => void;
  onLocationChange: (loc: { lat: number; lng: number }) => void;
  installationData: InstData[];
  combinedShading: ShadingResult;
  dateStr: string;
  onDateChange: (d: string) => void;
  timeMinutes: number;
  onTimeChange: (t: number) => void;
  isPlaying: boolean;
  onPlayToggle: () => void;
  playSpeed: number;
  onPlaySpeedChange: (s: number) => void;
  sunPosition: SunPosition;
  onSeasonPreset: (key: string) => void;
  mapStyle: MapStyle;
  onMapStyleChange: (s: MapStyle) => void;
  placementMode: boolean;
  onPlacementModeToggle: () => void;
  savedCases: DesignCase[];
  onSaveCase: (name: string) => void;
  onLoadCase: (c: DesignCase) => void;
  onDeleteCase: (id: string) => void;
  onExportJSON: () => void;
  onShareURL: () => void;
  shareCopied: boolean;
  dailyAvgResults: Record<string, number>;
  isCalcingDaily: boolean;
  onCalcDailyAvg: () => void;
  terrainElevations: TerrainElevation[];
  pendingTerrainHeight: number;
  pendingTerrainRadius: number;
  terrainPlacementMode: boolean;
  onTerrainHeightChange: (h: number) => void;
  onTerrainRadiusChange: (r: number) => void;
  onTerrainPlacementToggle: () => void;
  onRemoveTerrain: (id: string) => void;
}

function NumInput({ label, value, onChange, min, max, step, unit }: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; unit?: string;
}) {
  return (
    <div className="field-row">
      <label>{label}</label>
      <div className="field-input-wrap">
        <input type="number" value={value} min={min} max={max} step={step ?? 0.1}
          onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); }} />
        {unit && <span className="unit">{unit}</span>}
      </div>
    </div>
  );
}

function formatTime(m: number) {
  return `${String(Math.floor(m / 60) % 24).padStart(2,'0')}:${String(Math.floor(m % 60)).padStart(2,'0')}`;
}

function ShadingBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="shading-bar-wrap">
      <div className="shading-bar-bg">
        <div className="shading-bar-fill" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
      </div>
      <span className="shading-bar-label">{pct.toFixed(1)}%</span>
    </div>
  );
}

export default function SidePanel({
  installations, activeId, onSelectActive, onAddInstallation, onAddBothTemplate, onRemoveInstallation, onUpdateName,
  activeInst, onConfigChange, onGroundSlopeChange, onLocationChange,
  installationData, combinedShading,
  dateStr, onDateChange, timeMinutes, onTimeChange,
  isPlaying, onPlayToggle, playSpeed, onPlaySpeedChange,
  sunPosition, onSeasonPreset,
  mapStyle, onMapStyleChange,
  placementMode, onPlacementModeToggle,
  savedCases, onSaveCase, onLoadCase, onDeleteCase,
  onExportJSON,
  onShareURL, shareCopied,
  dailyAvgResults, isCalcingDaily, onCalcDailyAvg,
  terrainElevations, pendingTerrainHeight, pendingTerrainRadius, terrainPlacementMode,
  onTerrainHeightChange, onTerrainRadiusChange, onTerrainPlacementToggle, onRemoveTerrain,
}: Props) {
  const [addressInput, setAddressInput] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState('');
  const [caseName, setCaseName] = useState('');
  const [tab, setTab] = useState<'design' | 'shading' | 'cases'>('design');
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');

  const activeConfig = activeInst?.config;
  const updP = useCallback((k: keyof PanelConfig, v: number) => {
    if (!activeConfig || activeConfig.type !== 'pergola') return;
    onConfigChange({ ...activeConfig as PanelConfig, [k]: v });
  }, [activeConfig, onConfigChange]);
  const updS = useCallback((k: keyof SlopeConfig, v: number) => {
    if (!activeConfig || activeConfig.type !== 'slope') return;
    onConfigChange({ ...activeConfig as SlopeConfig, [k]: v });
  }, [activeConfig, onConfigChange]);

  const handleGeocode = useCallback(async () => {
    if (!addressInput.trim()) return;
    setGeocoding(true); setGeocodeError('');
    try {
      const r = await geocodeAddress(addressInput);
      if (r) onLocationChange(r);
      else setGeocodeError('住所が見つかりません');
    } catch { setGeocodeError('検索エラー'); }
    finally { setGeocoding(false); }
  }, [addressInput, onLocationChange]);

  const sunTimes = getSunTimes(
    activeInst?.location.lat ?? 36.4, activeInst?.location.lng ?? 138.2, dateStr
  );
  const toJST = (d: Date) => isNaN(d.getTime()) ? '--:--'
    : d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
  const isNight = sunPosition.altitude <= 0;

  // 設置タイプ色
  const typeColor = (t: InstallationType) => t === 'pergola' ? '#3b82f6' : '#f97316';
  const typeLabel = (t: InstallationType) => t === 'pergola' ? '藤棚' : '法面';

  const pc = activeConfig?.type === 'pergola' ? activeConfig as PanelConfig : null;
  const sc = activeConfig?.type === 'slope' ? activeConfig as SlopeConfig : null;

  return (
    <aside className="side-panel">
      <div className="side-panel-header">
        <h1>☀ ソーラーシェアリング設計シミュレーター</h1>
        <p className="beta-badge">MVP β版</p>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'design' ? 'active' : ''}`} onClick={() => setTab('design')}>設計</button>
        <button className={`tab ${tab === 'shading' ? 'active' : ''}`} onClick={() => setTab('shading')}>遮光率</button>
        <button className={`tab ${tab === 'cases' ? 'active' : ''}`} onClick={() => setTab('cases')}>
          設計案{savedCases.length > 0 && <span className="badge">{savedCases.length}</span>}
        </button>
      </div>

      <div className="side-panel-body">

        {/* ============================================================
            設計タブ
        ============================================================ */}
        {tab === 'design' && (
          <>
            {/* 設置リスト */}
            <section className="section">
              <h2>⚡ 設置リスト</h2>
              <div className="inst-list">
                {installations.map((inst) => (
                  <div key={inst.id}
                    className={`inst-card ${inst.id === activeId ? 'active' : ''}`}
                    onClick={() => onSelectActive(inst.id)}
                  >
                    <span className="inst-dot" style={{ background: typeColor(inst.installationType) }} />
                    {editingNameId === inst.id ? (
                      <input className="inst-name-input" autoFocus value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        onBlur={() => { onUpdateName(inst.id, nameInput || inst.name); setEditingNameId(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { onUpdateName(inst.id, nameInput || inst.name); setEditingNameId(null); } }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="inst-name" onDoubleClick={(e) => { e.stopPropagation(); setEditingNameId(inst.id); setNameInput(inst.name); }}>
                        {inst.name}
                      </span>
                    )}
                    <span className="inst-type-tag">{typeLabel(inst.installationType)}</span>
                    {installations.length > 1 && (
                      <button className="inst-del" onClick={(e) => { e.stopPropagation(); if (confirm(`「${inst.name}」を削除しますか？`)) onRemoveInstallation(inst.id); }}>✕</button>
                    )}
                  </div>
                ))}
              </div>
              <div className="add-inst-row">
                <button className="btn-add-inst pergola" onClick={() => onAddInstallation('pergola')}>＋ 藤棚を追加</button>
                <button className="btn-add-inst slope" onClick={() => onAddInstallation('slope')}>＋ 法面を追加</button>
              </div>
              <button className="btn-secondary btn-block btn-sm" style={{ marginTop: 8 }} onClick={onAddBothTemplate}>
                ＋ 藤棚＋法面をまとめて追加（一緒に設計）
              </button>
              <p className="note">※ 設置は何個でも追加できます。藤棚と法面を両方追加すると、同じ地図上で重ねて比較・設計できます。</p>
            </section>

            {/* アクティブ設置の設定 */}
            {activeInst && (
              <>
                <section className="section">
                  <h2 style={{ color: typeColor(activeInst.installationType) }}>
                    ● {activeInst.name} の設定
                  </h2>

                  {/* 地点 */}
                  <div className="subsection">
                    <h3>設置地点</h3>
                    <div className="address-search">
                      <input type="text" placeholder="住所・地名で検索"
                        value={addressInput} onChange={(e) => setAddressInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleGeocode()} />
                      <button onClick={handleGeocode} disabled={geocoding} className="btn-primary btn-sm">
                        {geocoding ? '…' : '検索'}
                      </button>
                    </div>
                    {geocodeError && <p className="error-text">{geocodeError}</p>}
                    <div className="latlng-compact">
                      <span className="latlng-val">緯度 {activeInst.location.lat.toFixed(5)}</span>
                      <span className="latlng-val">経度 {activeInst.location.lng.toFixed(5)}</span>
                    </div>
                    <button className={`btn-placement ${placementMode ? 'active' : ''}`} onClick={onPlacementModeToggle}>
                      {placementMode ? '🎯 地図をクリックして配置中…' : '🗺 地図上でクリック配置'}
                    </button>
                  </div>

                  {/* 藤棚型 */}
                  {pc && (
                    <>
                      <div className="subsection">
                        <h3>寸法・配置</h3>
                        <NumInput label="パネル幅" value={pc.panelWidth} onChange={(v) => updP('panelWidth', v)} min={0.5} max={5} unit="m" />
                        <NumInput label="奥行き" value={pc.panelDepth} onChange={(v) => updP('panelDepth', v)} min={0.5} max={5} unit="m" />
                        <NumInput label="東西列数" value={pc.colsEW} onChange={(v) => updP('colsEW', Math.max(1,Math.round(v)))} min={1} max={30} step={1} unit="列" />
                        <NumInput label="南北行数" value={pc.rowsNS} onChange={(v) => updP('rowsNS', Math.max(1,Math.round(v)))} min={1} max={30} step={1} unit="行" />
                        <NumInput label="東西間隔" value={pc.ewSpacing} onChange={(v) => updP('ewSpacing', v)} min={0.5} max={10} unit="m" />
                        <NumInput label="南北間隔" value={pc.nsSpacing} onChange={(v) => updP('nsSpacing', v)} min={1} max={20} unit="m" />
                      </div>
                      <div className="subsection">
                        <h3>高さ・角度</h3>
                        <NumInput label="設置高さ" value={pc.mountHeight} onChange={(v) => updP('mountHeight', v)} min={0.5} max={10} unit="m" />
                        <NumInput label="傾斜角" value={pc.tiltAngle} onChange={(v) => updP('tiltAngle', v)} min={0} max={60} step={1} unit="°" />
                        <NumInput label="傾斜方位" value={pc.facingAzimuth} onChange={(v) => updP('facingAzimuth', v)} min={0} max={360} step={5} unit="°" />
                        <NumInput label="架台回転" value={pc.rackRotation} onChange={(v) => updP('rackRotation', v)} min={-180} max={180} step={5} unit="°" />
                      </div>
                    </>
                  )}

                  {/* 法面型 */}
                  {sc && (
                    <>
                      <div className="subsection">
                        <h3>法面条件</h3>
                        <NumInput label="傾斜角" value={sc.slopeAngle} onChange={(v) => updS('slopeAngle', v)} min={5} max={70} step={1} unit="°" />
                        <NumInput label="法面方位" value={sc.facingAzimuth} onChange={(v) => updS('facingAzimuth', v)} min={0} max={360} step={5} unit="°" />
                        <NumInput label="追加傾斜" value={sc.additionalTilt} onChange={(v) => updS('additionalTilt', v)} min={0} max={30} step={1} unit="°" />
                        <NumInput label="下端高さ" value={sc.baseMountHeight} onChange={(v) => updS('baseMountHeight', v)} min={0} max={3} unit="m" />
                      </div>
                      <div className="subsection">
                        <h3>パネル配置</h3>
                        <NumInput label="パネル幅" value={sc.panelWidth} onChange={(v) => updS('panelWidth', v)} min={0.5} max={5} unit="m" />
                        <NumInput label="奥行き" value={sc.panelDepth} onChange={(v) => updS('panelDepth', v)} min={0.5} max={5} unit="m" />
                        <NumInput label="横列数" value={sc.colsAcross} onChange={(v) => updS('colsAcross', Math.max(1,Math.round(v)))} min={1} max={30} step={1} unit="列" />
                        <NumInput label="縦行数" value={sc.rowsDown} onChange={(v) => updS('rowsDown', Math.max(1,Math.round(v)))} min={1} max={30} step={1} unit="行" />
                        <NumInput label="横間隔" value={sc.acrossSpacing} onChange={(v) => updS('acrossSpacing', v)} min={0.5} max={10} unit="m" />
                        <NumInput label="縦間隔(斜面)" value={sc.downSpacing} onChange={(v) => updS('downSpacing', v)} min={0.5} max={10} unit="m" />
                      </div>
                    </>
                  )}

                  {/* 地盤傾斜設定 */}
                  <div className="subsection">
                    <h3>🏔 地盤傾斜（影の精度向上）</h3>
                    <NumInput
                      label="傾斜角"
                      value={activeInst.groundSlope?.angle ?? 0}
                      onChange={(v) => onGroundSlopeChange({ angle: v, facingAzimuth: activeInst.groundSlope?.facingAzimuth ?? 180 })}
                      min={0} max={70} step={1} unit="°"
                    />
                    <NumInput
                      label="傾斜方位"
                      value={activeInst.groundSlope?.facingAzimuth ?? 180}
                      onChange={(v) => onGroundSlopeChange({ angle: activeInst.groundSlope?.angle ?? 0, facingAzimuth: v })}
                      min={0} max={360} step={5} unit="°"
                    />
                    <p className="note">0°=平地。段差・のり面がある場合は傾斜角と方位（下り方向）を設定すると影の計算が精確になります。</p>
                  </div>

                  {/* アクティブ設置のサマリー */}
                  {(() => {
                    const d = installationData.find((x) => x.id === activeId);
                    if (!d) return null;
                    return (
                      <div className="summary-box">
                        <div className="summary-row"><span>パネル枚数</span><strong>{d.summary.totalPanels} 枚</strong></div>
                        <div className="summary-row"><span>パネル面積</span><strong>{d.summary.totalArea.toFixed(1)} m²</strong></div>
                        <div className="summary-row"><span>推定容量</span><strong>約 {d.summary.estimatedKw.toFixed(1)} kW</strong></div>
                      </div>
                    );
                  })()}
                </section>
              </>
            )}

            {/* 地形段差ゾーン */}
            <section className="section">
              <h2>🏔 周辺の地形段差（影の到達先）</h2>
              <p className="note">
                段差がある場所を地図に置くと、その高さへの影（紫色）が表示されます。<br />
                例：北東側に2mの盛り土 → 高さ2m・北東側に配置。
              </p>
              <NumInput label="高さ" value={pendingTerrainHeight} onChange={onTerrainHeightChange} min={0.5} max={20} step={0.5} unit="m" />
              <NumInput label="ゾーン範囲" value={pendingTerrainRadius} onChange={onTerrainRadiusChange} min={5} max={200} step={5} unit="m" />
              <button
                className={`btn-placement ${terrainPlacementMode ? 'active' : ''}`}
                onClick={onTerrainPlacementToggle}
                style={{ marginTop: 8 }}
              >
                {terrainPlacementMode ? '🎯 地図をクリックして配置中…' : '📍 地図上で配置'}
              </button>
              {terrainElevations.length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {terrainElevations.map((te) => (
                    <div key={te.id} className="terrain-item">
                      <span className="terrain-label">
                        {te.label}（{te.heightM}m・範囲{te.radiusM}m）
                      </span>
                      <button className="btn-danger btn-sm" onClick={() => onRemoveTerrain(te.id)}>削除</button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* 地図スタイル */}
            <section className="section section-compact">
              <h2>🗺 地図スタイル</h2>
              <div className="map-style-toggle">
                <button className={`btn-style ${mapStyle === 'street' ? 'active' : ''}`} onClick={() => onMapStyleChange('street')}>道路地図</button>
                <button className={`btn-style ${mapStyle === 'satellite' ? 'active' : ''}`} onClick={() => onMapStyleChange('satellite')}>航空写真</button>
              </div>
            </section>

            {/* 日時 */}
            <section className="section">
              <h2>🗓 日時</h2>
              <div className="season-buttons">
                {Object.entries(SEASON_PRESETS).map(([key, { label }]) => (
                  <button key={key} className={`btn-season ${dateStr === SEASON_PRESETS[key].dateStr ? 'active' : ''}`}
                    onClick={() => onSeasonPreset(key)}>{label}</button>
                ))}
              </div>
              <div className="field-row">
                <label>日付</label>
                <input type="date" value={dateStr} onChange={(e) => onDateChange(e.target.value)} />
              </div>
              <div className="sun-times">
                <span>日出 {toJST(sunTimes.sunrise)}</span>
                <span>正午 {toJST(sunTimes.solarNoon)}</span>
                <span>日没 {toJST(sunTimes.sunset)}</span>
              </div>
              <div className="time-slider-section">
                <div className="time-display">
                  <span className="time-label">{formatTime(timeMinutes)}</span>
                  {isNight && <span className="night-badge">🌙</span>}
                </div>
                <input type="range" min={0} max={1439} step={1} value={Math.floor(timeMinutes)}
                  className="time-slider" onChange={(e) => onTimeChange(parseInt(e.target.value))} />
                <div className="slider-labels">
                  <span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
                </div>
              </div>
              <div className="play-controls">
                <button className={`btn-play ${isPlaying ? 'playing' : ''}`} onClick={onPlayToggle}>
                  {isPlaying ? '⏸ 停止' : '▶ 24h 再生'}
                </button>
                <button className="btn-secondary btn-sm" onClick={() => onTimeChange(NOON)}>正午</button>
              </div>
              <div className="speed-row">
                <span className="speed-label">速度</span>
                {SPEED_OPTIONS.map(({ label, value }) => (
                  <button key={value} className={`btn-speed ${playSpeed === value ? 'active' : ''}`}
                    onClick={() => onPlaySpeedChange(value)}>{label}</button>
                ))}
              </div>
              <div className="sun-info">
                <div className="sun-info-row"><span>方位</span>
                  <strong>{isNight ? '---' : `${sunPosition.azimuth.toFixed(1)}°`}</strong></div>
                <div className="sun-info-row"><span>高度</span>
                  <strong className={isNight ? 'night' : sunPosition.altitude > 30 ? 'high' : 'low'}>
                    {sunPosition.altitude.toFixed(1)}°</strong></div>
              </div>
            </section>

            <section className="section">
              <h2>💾 出力</h2>
              <button className="btn-primary btn-block" onClick={onExportJSON}>JSON ダウンロード</button>
              <p className="note">※ 初期検討用の簡易シミュレーターです。構造計算・発電量計算の代替にはなりません。</p>
            </section>
          </>
        )}

        {/* ============================================================
            遮光率タブ
        ============================================================ */}
        {tab === 'shading' && (
          <>
            <section className="section">
              <h2>🌤 遮光率（現在時刻）</h2>
              <p className="shading-note">
                太陽位置から計算した地表への影面積 ÷ 設置エリア面積。
                パネルが重なる影は簡易加算のため目安値です。
              </p>

              {/* 設置ごと */}
              {installationData.map((d) => {
                const inst = installations.find((i) => i.id === d.id);
                if (!inst) return null;
                const color = inst.installationType === 'pergola' ? '#3b82f6' : '#f97316';
                return (
                  <div key={d.id} className="shading-block">
                    <div className="shading-title">
                      <span className="inst-dot" style={{ background: color }} />
                      <strong>{inst.name}</strong>
                      <span className="shading-type">{inst.installationType === 'pergola' ? '藤棚型' : '法面型'}</span>
                    </div>
                    {isNight ? (
                      <p className="shading-night">🌙 夜間のため影なし (0%)</p>
                    ) : (
                      <>
                        <div className="shading-metric">
                          <span>遮光率（現在）</span>
                          <ShadingBar pct={d.shading.shadingRatioPct} color={color} />
                        </div>
                        <div className="shading-metric">
                          <span>パネル面積率</span>
                          <ShadingBar pct={d.shading.coverageRatioPct} color="#94a3b8" />
                        </div>
                        <div className="shading-vals">
                          <div><span>影面積</span><strong>{d.shading.shadowAreaM2.toFixed(1)} m²</strong></div>
                          <div><span>設置エリア</span><strong>{d.shading.fieldAreaM2.toFixed(1)} m²</strong></div>
                          <div><span>パネル面積</span><strong>{d.shading.panelAreaM2.toFixed(1)} m²</strong></div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}

              {/* 合計 */}
              {installations.length > 1 && (
                <div className="shading-block combined">
                  <div className="shading-title"><strong>合計（全設置）</strong></div>
                  {isNight ? (
                    <p className="shading-night">🌙 夜間のため影なし (0%)</p>
                  ) : (
                    <>
                      <div className="shading-metric">
                        <span>合計遮光率</span>
                        <ShadingBar pct={combinedShading.shadingRatioPct} color="#6366f1" />
                      </div>
                      <div className="shading-vals">
                        <div><span>総影面積</span><strong>{combinedShading.shadowAreaM2.toFixed(1)} m²</strong></div>
                        <div><span>総設置エリア</span><strong>{combinedShading.fieldAreaM2.toFixed(1)} m²</strong></div>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="shading-guidance">
                <h3>農業用ソーラーシェアリングの目安</h3>
                <div className="guidance-row"><span className="guidance-bar g20"></span>10〜30%: 作物の影響が少ない</div>
                <div className="guidance-row"><span className="guidance-bar g40"></span>30〜50%: 一部作物に影響の可能性</div>
                <div className="guidance-row"><span className="guidance-bar g60"></span>50%以上: 遮光に強い作物が必要</div>
                <p className="note">※ 年間平均遮光率は時刻・季節ごとの積分値です。現在時刻の瞬間値とは異なります。</p>
              </div>
            </section>

            <section className="section">
              <h2>📊 日平均遮光率（{dateStr}）</h2>
              <p className="shading-note">
                日の出〜日没を15分間隔でサンプリングし、その日1日分の遮光率を平均します。
                現在時刻の瞬間値より、営農への影響度に近い目安になります。
              </p>
              <button className="btn-primary btn-block" onClick={onCalcDailyAvg} disabled={isCalcingDaily}>
                {isCalcingDaily ? '計算中…' : 'この日の平均を計算'}
              </button>
              {Object.keys(dailyAvgResults).length > 0 && (
                <div className="daily-avg-results" style={{ marginTop: 12 }}>
                  {installations.map((inst) => {
                    const pct = dailyAvgResults[inst.id];
                    if (pct === undefined) return null;
                    const color = inst.installationType === 'pergola' ? '#3b82f6' : '#f97316';
                    return (
                      <div key={inst.id} className="shading-metric">
                        <span>{inst.name}</span>
                        <ShadingBar pct={pct} color={color} />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}

        {/* ============================================================
            設計案タブ
        ============================================================ */}
        {tab === 'cases' && (
          <>
          <section className="section">
            <h2>🔗 他の人と共有</h2>
            <p className="shading-note">
              現在の設計（全設置・日付）を含むリンクを発行します。
              サーバーには保存されず、リンクの中に設計データが入っているので、誰でもそのリンクを開くだけで同じ設計を確認できます。
            </p>
            <button className="btn-primary btn-block" onClick={onShareURL}>
              {shareCopied ? '✅ リンクをコピーしました' : '🔗 共有リンクをコピー'}
            </button>
          </section>
          <section className="section">
            <h2>📁 設計案の保存・管理</h2>
            <p className="note">※ この一覧はこの端末のブラウザにのみ保存されます（他の人には見えません）。他の人に見せたい場合は上の共有リンクを使ってください。</p>
            <div className="save-form">
              <input type="text" placeholder="設計案の名前" value={caseName}
                onChange={(e) => setCaseName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && caseName.trim() && (onSaveCase(caseName.trim()), setCaseName(''))} />
              <button className="btn-primary btn-sm" disabled={!caseName.trim()}
                onClick={() => { onSaveCase(caseName.trim()); setCaseName(''); }}>保存</button>
            </div>
            {savedCases.length === 0 ? (
              <p className="empty-hint">まだ設計案がありません。「設計」タブで条件を整えて保存できます。</p>
            ) : (
              <div className="case-list">
                {[...savedCases].reverse().map((c) => (
                  <div key={c.id} className="case-item">
                    <div className="case-info">
                      <span className="case-name">{c.name}</span>
                      <span className="case-meta">
                        {c.installations.length}設置 · {new Date(c.createdAt).toLocaleDateString('ja-JP')}
                      </span>
                    </div>
                    <div className="case-actions">
                      <button className="btn-secondary btn-sm" onClick={() => onLoadCase(c)}>読込</button>
                      <button className="btn-danger btn-sm" onClick={() => { if (confirm(`「${c.name}」を削除しますか？`)) onDeleteCase(c.id); }}>削除</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          </>
        )}
      </div>
    </aside>
  );
}
