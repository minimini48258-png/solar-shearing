import { useState, useCallback } from 'react';
import {
  GeoPoint, PanelConfig, SlopeConfig, SunPosition,
  InstallationType, MapStyle, DesignCase,
} from '../types';
import { geocodeAddress } from '../lib/geoUtils';
import { SEASON_PRESETS, getSunTimes } from '../lib/solar';
import './SidePanel.css';

const NOON = 720;

interface Summary { totalPanels: number; totalArea: number; estimatedKw: number; }

interface Props {
  location: GeoPoint;
  onLocationChange: (loc: GeoPoint) => void;
  installationType: InstallationType;
  onInstallationTypeChange: (t: InstallationType) => void;
  panelConfig: PanelConfig;
  onPanelConfigChange: (c: PanelConfig) => void;
  slopeConfig: SlopeConfig;
  onSlopeConfigChange: (c: SlopeConfig) => void;
  summary: Summary;
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
}

function NumInput({ label, value, onChange, min, max, step, unit }: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; unit?: string;
}) {
  return (
    <div className="field-row">
      <label>{label}</label>
      <div className="field-input-wrap">
        <input
          type="number" value={value} min={min} max={max} step={step ?? 0.1}
          onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); }}
        />
        {unit && <span className="unit">{unit}</span>}
      </div>
    </div>
  );
}

function formatTime(m: number) {
  const h = Math.floor(m / 60) % 24;
  const mm = Math.floor(m % 60);
  return `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}

const SPEED_OPTIONS = [
  { label: '×½', value: 10 },
  { label: '×1', value: 20 },
  { label: '×2', value: 40 },
  { label: '×4', value: 80 },
  { label: '×8', value: 160 },
];

export default function SidePanel({
  location, onLocationChange,
  installationType, onInstallationTypeChange,
  panelConfig, onPanelConfigChange,
  slopeConfig, onSlopeConfigChange,
  summary,
  dateStr, onDateChange,
  timeMinutes, onTimeChange,
  isPlaying, onPlayToggle,
  playSpeed, onPlaySpeedChange,
  sunPosition,
  onSeasonPreset,
  mapStyle, onMapStyleChange,
  placementMode, onPlacementModeToggle,
  savedCases, onSaveCase, onLoadCase, onDeleteCase,
  onExportJSON,
}: Props) {
  const [addressInput, setAddressInput] = useState('');
  const [latInput, setLatInput] = useState(String(location.lat));
  const [lngInput, setLngInput] = useState(String(location.lng));
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState('');
  const [caseName, setCaseName] = useState('');
  const [activeTab, setActiveTab] = useState<'config' | 'cases'>('config');

  const pc = panelConfig;
  const sc = slopeConfig;
  const updP = useCallback((k: keyof PanelConfig, v: number) => onPanelConfigChange({ ...pc, [k]: v }), [pc, onPanelConfigChange]);
  const updS = useCallback((k: keyof SlopeConfig, v: number) => onSlopeConfigChange({ ...sc, [k]: v }), [sc, onSlopeConfigChange]);

  const handleGeocode = useCallback(async () => {
    if (!addressInput.trim()) return;
    setGeocoding(true); setGeocodeError('');
    try {
      const r = await geocodeAddress(addressInput);
      if (r) {
        onLocationChange(r);
        setLatInput(r.lat.toFixed(6));
        setLngInput(r.lng.toFixed(6));
      } else {
        setGeocodeError('住所が見つかりませんでした');
      }
    } catch { setGeocodeError('検索エラー'); }
    finally { setGeocoding(false); }
  }, [addressInput, onLocationChange]);

  const handleLatLngApply = useCallback(() => {
    const lat = parseFloat(latInput), lng = parseFloat(lngInput);
    if (!isNaN(lat) && !isNaN(lng)) onLocationChange({ lat, lng });
  }, [latInput, lngInput, onLocationChange]);

  const sunTimes = getSunTimes(location.lat, location.lng, dateStr);
  const toJST = (d: Date) => isNaN(d.getTime()) ? '--:--'
    : d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
  const isNight = sunPosition.altitude <= 0;

  return (
    <aside className="side-panel">
      <div className="side-panel-header">
        <h1>☀ ソーラーシェアリング設計シミュレーター</h1>
        <p className="beta-badge">MVP β版</p>
      </div>

      {/* タブ */}
      <div className="tabs">
        <button className={`tab ${activeTab === 'config' ? 'active' : ''}`} onClick={() => setActiveTab('config')}>設計</button>
        <button className={`tab ${activeTab === 'cases' ? 'active' : ''}`} onClick={() => setActiveTab('cases')}>
          設計案 {savedCases.length > 0 && <span className="badge">{savedCases.length}</span>}
        </button>
      </div>

      <div className="side-panel-body">

        {activeTab === 'config' && (
          <>
            {/* ===== 地点設定 ===== */}
            <section className="section">
              <h2>📍 設置地点</h2>
              <div className="address-search">
                <input type="text" placeholder="住所・地名（例：上田市）"
                  value={addressInput} onChange={(e) => setAddressInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleGeocode()} />
                <button onClick={handleGeocode} disabled={geocoding} className="btn-primary btn-sm">
                  {geocoding ? '…' : '検索'}
                </button>
              </div>
              {geocodeError && <p className="error-text">{geocodeError}</p>}
              <div className="latlng-row">
                <div className="field-input-wrap col">
                  <label>緯度</label>
                  <input type="number" step="0.0001" value={latInput} onChange={(e) => setLatInput(e.target.value)} />
                </div>
                <div className="field-input-wrap col">
                  <label>経度</label>
                  <input type="number" step="0.0001" value={lngInput} onChange={(e) => setLngInput(e.target.value)} />
                </div>
                <button onClick={handleLatLngApply} className="btn-secondary btn-sm">適用</button>
              </div>
              <button
                className={`btn-placement ${placementMode ? 'active' : ''}`}
                onClick={onPlacementModeToggle}
              >
                {placementMode ? '🎯 地図をクリックして配置（ESCで解除）' : '🗺 地図上でクリック配置'}
              </button>
            </section>

            {/* ===== 地図スタイル ===== */}
            <section className="section section-compact">
              <h2>🗺 地図</h2>
              <div className="map-style-toggle">
                <button className={`btn-style ${mapStyle === 'street' ? 'active' : ''}`} onClick={() => onMapStyleChange('street')}>道路地図</button>
                <button className={`btn-style ${mapStyle === 'satellite' ? 'active' : ''}`} onClick={() => onMapStyleChange('satellite')}>航空写真</button>
              </div>
            </section>

            {/* ===== 設置タイプ ===== */}
            <section className="section">
              <h2>⚡ 設置タイプ</h2>
              <div className="type-toggle">
                <button
                  className={`btn-type ${installationType === 'pergola' ? 'active' : ''}`}
                  onClick={() => onInstallationTypeChange('pergola')}
                >🌿 藤棚型</button>
                <button
                  className={`btn-type ${installationType === 'slope' ? 'active' : ''}`}
                  onClick={() => onInstallationTypeChange('slope')}
                >⛰ 法面型</button>
              </div>

              {installationType === 'pergola' && (
                <>
                  <div className="subsection">
                    <h3>寸法・配置</h3>
                    <NumInput label="パネル幅" value={pc.panelWidth} onChange={(v) => updP('panelWidth', v)} min={0.5} max={5} unit="m" />
                    <NumInput label="パネル奥行" value={pc.panelDepth} onChange={(v) => updP('panelDepth', v)} min={0.5} max={5} unit="m" />
                    <NumInput label="東西列数" value={pc.colsEW} onChange={(v) => updP('colsEW', Math.max(1, Math.round(v)))} min={1} max={30} step={1} unit="列" />
                    <NumInput label="南北行数" value={pc.rowsNS} onChange={(v) => updP('rowsNS', Math.max(1, Math.round(v)))} min={1} max={30} step={1} unit="行" />
                    <NumInput label="東西間隔" value={pc.ewSpacing} onChange={(v) => updP('ewSpacing', v)} min={0.5} max={10} unit="m" />
                    <NumInput label="南北間隔" value={pc.nsSpacing} onChange={(v) => updP('nsSpacing', v)} min={1} max={20} unit="m" />
                  </div>
                  <div className="subsection">
                    <h3>高さ・角度</h3>
                    <NumInput label="設置高さ" value={pc.mountHeight} onChange={(v) => updP('mountHeight', v)} min={0.5} max={10} unit="m" />
                    <NumInput label="傾斜角" value={pc.tiltAngle} onChange={(v) => updP('tiltAngle', v)} min={0} max={60} step={1} unit="°" />
                    <NumInput label="傾斜方位" value={pc.facingAzimuth} onChange={(v) => updP('facingAzimuth', v)} min={0} max={360} step={5} unit="° (180=南)" />
                    <NumInput label="架台回転" value={pc.rackRotation} onChange={(v) => updP('rackRotation', v)} min={-180} max={180} step={5} unit="°" />
                  </div>
                </>
              )}

              {installationType === 'slope' && (
                <>
                  <div className="subsection">
                    <h3>法面条件</h3>
                    <NumInput label="法面傾斜角" value={sc.slopeAngle} onChange={(v) => updS('slopeAngle', v)} min={5} max={70} step={1} unit="°" />
                    <NumInput label="法面方位" value={sc.facingAzimuth} onChange={(v) => updS('facingAzimuth', v)} min={0} max={360} step={5} unit="° (180=南)" />
                    <NumInput label="追加傾斜" value={sc.additionalTilt} onChange={(v) => updS('additionalTilt', v)} min={0} max={30} step={1} unit="°" />
                    <NumInput label="下端高さ" value={sc.baseMountHeight} onChange={(v) => updS('baseMountHeight', v)} min={0} max={3} unit="m" />
                  </div>
                  <div className="subsection">
                    <h3>パネル配置</h3>
                    <NumInput label="パネル幅" value={sc.panelWidth} onChange={(v) => updS('panelWidth', v)} min={0.5} max={5} unit="m" />
                    <NumInput label="パネル奥行" value={sc.panelDepth} onChange={(v) => updS('panelDepth', v)} min={0.5} max={5} unit="m" />
                    <NumInput label="横列数" value={sc.colsAcross} onChange={(v) => updS('colsAcross', Math.max(1, Math.round(v)))} min={1} max={30} step={1} unit="列" />
                    <NumInput label="縦行数" value={sc.rowsDown} onChange={(v) => updS('rowsDown', Math.max(1, Math.round(v)))} min={1} max={30} step={1} unit="行" />
                    <NumInput label="横間隔" value={sc.acrossSpacing} onChange={(v) => updS('acrossSpacing', v)} min={0.5} max={10} unit="m" />
                    <NumInput label="縦間隔(斜面)" value={sc.downSpacing} onChange={(v) => updS('downSpacing', v)} min={0.5} max={10} unit="m" />
                  </div>
                </>
              )}

              {/* サマリー */}
              <div className="summary-box">
                <div className="summary-row"><span>総パネル数</span><strong>{summary.totalPanels} 枚</strong></div>
                <div className="summary-row"><span>設置面積</span><strong>{summary.totalArea.toFixed(1)} m²</strong></div>
                <div className="summary-row"><span>推定容量</span><strong>約 {summary.estimatedKw.toFixed(1)} kW</strong></div>
              </div>
            </section>

            {/* ===== 日時設定 ===== */}
            <section className="section">
              <h2>🗓 日時</h2>
              <div className="season-buttons">
                {Object.entries(SEASON_PRESETS).map(([key, { label }]) => (
                  <button key={key}
                    className={`btn-season ${dateStr === SEASON_PRESETS[key].dateStr ? 'active' : ''}`}
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

              {/* タイムスライダー */}
              <div className="time-slider-section">
                <div className="time-display">
                  <span className="time-label">{formatTime(timeMinutes)}</span>
                  {isNight && <span className="night-badge">🌙</span>}
                </div>
                <input type="range" min={0} max={1439} step={1}
                  value={Math.floor(timeMinutes)} className="time-slider"
                  onChange={(e) => onTimeChange(parseInt(e.target.value))} />
                <div className="slider-labels">
                  <span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
                </div>
              </div>

              {/* 再生コントロール */}
              <div className="play-controls">
                <button className={`btn-play ${isPlaying ? 'playing' : ''}`} onClick={onPlayToggle}>
                  {isPlaying ? '⏸ 停止' : '▶ 24h 再生'}
                </button>
                <button className="btn-secondary btn-sm" onClick={() => onTimeChange(NOON)}>正午</button>
              </div>

              {/* 再生スピード */}
              <div className="speed-row">
                <span className="speed-label">速度</span>
                {SPEED_OPTIONS.map(({ label, value }) => (
                  <button key={value}
                    className={`btn-speed ${playSpeed === value ? 'active' : ''}`}
                    onClick={() => onPlaySpeedChange(value)}>{label}</button>
                ))}
              </div>

              {/* 太陽位置 */}
              <div className="sun-info">
                <div className="sun-info-row"><span>方位</span>
                  <strong>{isNight ? '---' : `${sunPosition.azimuth.toFixed(1)}°`}</strong></div>
                <div className="sun-info-row"><span>高度</span>
                  <strong className={isNight ? 'night' : sunPosition.altitude > 30 ? 'high' : 'low'}>
                    {sunPosition.altitude.toFixed(1)}°</strong></div>
              </div>
            </section>

            {/* ===== 出力 ===== */}
            <section className="section">
              <h2>💾 出力</h2>
              <button className="btn-primary btn-block" onClick={onExportJSON}>JSON ダウンロード</button>
              <p className="note">※ 初期検討用の簡易シミュレーターです。構造計算・発電量計算の代替にはなりません。</p>
            </section>
          </>
        )}

        {activeTab === 'cases' && (
          <section className="section">
            <h2>📁 設計案の保存・管理</h2>
            <div className="save-form">
              <input type="text" placeholder="設計案の名前を入力"
                value={caseName} onChange={(e) => setCaseName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && caseName.trim() && (onSaveCase(caseName.trim()), setCaseName(''))} />
              <button className="btn-primary btn-sm"
                disabled={!caseName.trim()}
                onClick={() => { onSaveCase(caseName.trim()); setCaseName(''); }}>
                保存
              </button>
            </div>

            {savedCases.length === 0 ? (
              <p className="empty-hint">まだ保存された設計案はありません。<br />「設計」タブで条件を設定して保存できます。</p>
            ) : (
              <div className="case-list">
                {[...savedCases].reverse().map((c) => (
                  <div key={c.id} className="case-item">
                    <div className="case-info">
                      <span className="case-name">{c.name}</span>
                      <span className="case-meta">
                        {c.installationType === 'pergola' ? '藤棚型' : '法面型'} ·{' '}
                        {new Date(c.createdAt).toLocaleDateString('ja-JP')}
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
        )}
      </div>
    </aside>
  );
}
