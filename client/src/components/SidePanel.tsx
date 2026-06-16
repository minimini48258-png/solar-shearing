import { useState, useCallback } from 'react';
import { GeoPoint, PanelConfig, SunPosition } from '../types';

const NOON_MINUTES = 720;
import { geocodeAddress } from '../lib/geoUtils';
import { SEASON_PRESETS, getSunTimes } from '../lib/solar';
import { getPanelSummary } from '../lib/panelGeometry';
import './SidePanel.css';

interface Props {
  location: GeoPoint;
  onLocationChange: (loc: GeoPoint) => void;
  panelConfig: PanelConfig;
  onPanelConfigChange: (cfg: PanelConfig) => void;
  dateStr: string;
  onDateChange: (d: string) => void;
  timeMinutes: number;
  onTimeChange: (t: number) => void;
  isPlaying: boolean;
  onPlayToggle: () => void;
  sunPosition: SunPosition;
  onSeasonPreset: (key: string) => void;
  onExportJSON: () => void;
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.floor(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatDeg(deg: number): string {
  return deg.toFixed(1) + '°';
}

function NumInput({
  label, value, onChange, min, max, step, unit,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; unit?: string;
}) {
  return (
    <div className="field-row">
      <label>{label}</label>
      <div className="field-input-wrap">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step ?? 0.1}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        />
        {unit && <span className="unit">{unit}</span>}
      </div>
    </div>
  );
}

export default function SidePanel({
  location, onLocationChange,
  panelConfig, onPanelConfigChange,
  dateStr, onDateChange,
  timeMinutes, onTimeChange,
  isPlaying, onPlayToggle,
  sunPosition,
  onSeasonPreset,
  onExportJSON,
}: Props) {
  const [addressInput, setAddressInput] = useState('');
  const [latInput, setLatInput] = useState(String(location.lat));
  const [lngInput, setLngInput] = useState(String(location.lng));
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState('');

  const updateConfig = useCallback(
    (key: keyof PanelConfig, value: number | string) => {
      onPanelConfigChange({ ...panelConfig, [key]: value });
    },
    [panelConfig, onPanelConfigChange]
  );

  const handleGeocode = useCallback(async () => {
    if (!addressInput.trim()) return;
    setGeocoding(true);
    setGeocodeError('');
    try {
      const result = await geocodeAddress(addressInput);
      if (result) {
        onLocationChange(result);
        setLatInput(result.lat.toFixed(6));
        setLngInput(result.lng.toFixed(6));
      } else {
        setGeocodeError('住所が見つかりませんでした');
      }
    } catch {
      setGeocodeError('検索エラーが発生しました');
    } finally {
      setGeocoding(false);
    }
  }, [addressInput, onLocationChange]);

  const handleLatLngApply = useCallback(() => {
    const lat = parseFloat(latInput);
    const lng = parseFloat(lngInput);
    if (!isNaN(lat) && !isNaN(lng)) {
      onLocationChange({ lat, lng });
    }
  }, [latInput, lngInput, onLocationChange]);

  const sunTimes = getSunTimes(location.lat, location.lng, dateStr);
  const toJST = (d: Date) =>
    d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });

  const summary = getPanelSummary(panelConfig);
  const isNight = sunPosition.altitude <= 0;

  return (
    <aside className="side-panel">
      <div className="side-panel-header">
        <h1>☀ ソーラーシェアリング<br />設計シミュレーター</h1>
        <p className="beta-badge">MVP β版</p>
      </div>

      <div className="side-panel-body">

        {/* ===== 地点設定 ===== */}
        <section className="section">
          <h2>📍 設置地点</h2>
          <div className="address-search">
            <input
              type="text"
              placeholder="住所・地名で検索（例：上田市）"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleGeocode()}
            />
            <button onClick={handleGeocode} disabled={geocoding} className="btn-primary btn-sm">
              {geocoding ? '検索中…' : '検索'}
            </button>
          </div>
          {geocodeError && <p className="error-text">{geocodeError}</p>}
          <div className="latlng-row">
            <div className="field-input-wrap">
              <label>緯度</label>
              <input type="number" step="0.0001" value={latInput} onChange={(e) => setLatInput(e.target.value)} />
            </div>
            <div className="field-input-wrap">
              <label>経度</label>
              <input type="number" step="0.0001" value={lngInput} onChange={(e) => setLngInput(e.target.value)} />
            </div>
            <button onClick={handleLatLngApply} className="btn-secondary btn-sm">適用</button>
          </div>
        </section>

        {/* ===== パネル設定 ===== */}
        <section className="section">
          <h2>🔆 パネル設定（藤棚型）</h2>

          <div className="subsection">
            <h3>寸法・配置</h3>
            <NumInput label="パネル幅" value={panelConfig.panelWidth} onChange={(v) => updateConfig('panelWidth', v)} min={0.5} max={5} step={0.1} unit="m" />
            <NumInput label="パネル奥行" value={panelConfig.panelDepth} onChange={(v) => updateConfig('panelDepth', v)} min={0.5} max={5} step={0.1} unit="m" />
            <NumInput label="東西列数" value={panelConfig.colsEW} onChange={(v) => updateConfig('colsEW', Math.max(1, Math.round(v)))} min={1} max={20} step={1} unit="列" />
            <NumInput label="南北行数" value={panelConfig.rowsNS} onChange={(v) => updateConfig('rowsNS', Math.max(1, Math.round(v)))} min={1} max={20} step={1} unit="行" />
            <NumInput label="東西間隔(中心)" value={panelConfig.ewSpacing} onChange={(v) => updateConfig('ewSpacing', v)} min={0.5} max={10} step={0.1} unit="m" />
            <NumInput label="南北間隔(中心)" value={panelConfig.nsSpacing} onChange={(v) => updateConfig('nsSpacing', v)} min={1} max={20} step={0.1} unit="m" />
          </div>

          <div className="subsection">
            <h3>高さ・角度</h3>
            <NumInput label="設置高さ" value={panelConfig.mountHeight} onChange={(v) => updateConfig('mountHeight', v)} min={0.5} max={10} step={0.1} unit="m" />
            <NumInput label="傾斜角" value={panelConfig.tiltAngle} onChange={(v) => updateConfig('tiltAngle', v)} min={0} max={60} step={1} unit="°" />
            <NumInput label="傾斜方位" value={panelConfig.facingAzimuth} onChange={(v) => updateConfig('facingAzimuth', v)} min={0} max={360} step={5} unit="°(180=南)" />
            <NumInput label="架台回転" value={panelConfig.rackRotation} onChange={(v) => updateConfig('rackRotation', v)} min={-180} max={180} step={5} unit="°" />
          </div>

          {/* サマリー */}
          <div className="summary-box">
            <div className="summary-row"><span>総パネル数</span><strong>{summary.totalPanels} 枚</strong></div>
            <div className="summary-row"><span>パネル面積</span><strong>{summary.totalArea.toFixed(1)} m²</strong></div>
            <div className="summary-row"><span>推定容量</span><strong>約 {summary.estimatedKw.toFixed(1)} kW</strong></div>
          </div>
        </section>

        {/* ===== 日時設定 ===== */}
        <section className="section">
          <h2>🗓 日時設定</h2>

          {/* 季節プリセット */}
          <div className="season-buttons">
            {Object.entries(SEASON_PRESETS).map(([key, { label }]) => (
              <button
                key={key}
                className={`btn-season ${panelConfig && dateStr === SEASON_PRESETS[key].dateStr ? 'active' : ''}`}
                onClick={() => onSeasonPreset(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="field-row">
            <label>日付</label>
            <input type="date" value={dateStr} onChange={(e) => onDateChange(e.target.value)} />
          </div>

          <div className="sun-times">
            <span>日の出 {isNaN(sunTimes.sunrise.getTime()) ? '--:--' : toJST(sunTimes.sunrise)}</span>
            <span>正午 {toJST(sunTimes.solarNoon)}</span>
            <span>日の入 {isNaN(sunTimes.sunset.getTime()) ? '--:--' : toJST(sunTimes.sunset)}</span>
          </div>

          {/* 24時間スライダー */}
          <div className="time-slider-section">
            <div className="time-display">
              <span className="time-label">{formatTime(timeMinutes)} (JST)</span>
              {isNight && <span className="night-badge">🌙 夜間</span>}
            </div>
            <input
              type="range"
              min={0}
              max={1439}
              step={1}
              value={Math.floor(timeMinutes)}
              onChange={(e) => onTimeChange(parseInt(e.target.value))}
              className="time-slider"
            />
            <div className="slider-labels">
              <span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
            </div>
          </div>

          <div className="play-controls">
            <button className={`btn-play ${isPlaying ? 'playing' : ''}`} onClick={onPlayToggle}>
              {isPlaying ? '⏸ 停止' : '▶ 24時間再生'}
            </button>
            <button className="btn-secondary btn-sm" onClick={() => onTimeChange(NOON_MINUTES)}>
              正午に戻す
            </button>
          </div>

          {/* 太陽位置情報 */}
          <div className="sun-info">
            <div className="sun-info-row">
              <span>太陽方位</span>
              <strong>{isNight ? '---' : formatDeg(sunPosition.azimuth)}</strong>
            </div>
            <div className="sun-info-row">
              <span>太陽高度</span>
              <strong className={isNight ? 'night' : sunPosition.altitude > 30 ? 'high' : 'low'}>
                {formatDeg(sunPosition.altitude)}
              </strong>
            </div>
          </div>
        </section>

        {/* ===== 出力 ===== */}
        <section className="section">
          <h2>💾 出力</h2>
          <button className="btn-primary btn-block" onClick={onExportJSON}>
            JSON でダウンロード
          </button>
          <p className="note">※ 本ツールは初期検討用の簡易シミュレーターです。発電量計算・構造計算の代替にはなりません。</p>
        </section>
      </div>
    </aside>
  );
}
