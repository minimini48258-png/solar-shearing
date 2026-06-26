/**
 * 遮光率計算モジュール
 *
 * 遮光率の定義（農業用ソーラーシェアリング）:
 *   遮光率(t) = 地表に落ちる影面積(t) / 設置エリアの地表面積 × 100 (%)
 *
 * 注意事項:
 *  - 複数パネルの影が重なる場合、重複分は二重計算される（簡易モデル）
 *  - 正確な計算には影ポリゴンのブーリアン和集合が必要（将来の拡張ポイント）
 *  - 太陽高度が低い朝夕は影が長くなり 100% を超えることがあるため上限 100% でクランプ
 *  - 設置エリア面積: 配列の外形 (bounding box 近似)
 */

import { AnyConfig, PanelConfig, SlopeConfig, SingleAxisConfig, ShadowPolygon, ShadingResult } from '../types';

const DEG2RAD = Math.PI / 180;

// シューレースの公式による多角形面積 (m²)
// corners は [東(m), 北(m)] のリスト
export function polygonArea2D(corners: [number, number][]): number {
  const n = corners.length;
  if (n < 3) return 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = corners[i];
    const [x2, y2] = corners[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

// 影ポリゴン群の合計面積 (m²) — 重複を含む簡易値
export function totalShadowAreaM2(shadows: ShadowPolygon[]): number {
  return shadows.reduce((sum, s) => sum + polygonArea2D(s.corners), 0);
}

// 設置エリアの地表面積 (m²) — バウンディングボックス近似
export function getFieldAreaM2(config: AnyConfig): number {
  if (config.type === 'pergola' || config.type === 'single_axis') {
    const c = config as PanelConfig | SingleAxisConfig;
    const w = (c.colsEW - 1) * c.ewSpacing + c.panelWidth;
    const d = (c.rowsNS - 1) * c.nsSpacing + c.panelDepth * Math.cos(c.tiltAngle * DEG2RAD);
    return w * d;
  } else {
    const c = config as SlopeConfig;
    const w = (c.colsAcross - 1) * c.acrossSpacing + c.panelWidth;
    const d = (c.rowsDown - 1) * c.downSpacing * Math.cos(c.slopeAngle * DEG2RAD)
              + c.panelDepth * Math.cos((c.slopeAngle + c.additionalTilt) * DEG2RAD);
    return w * d;
  }
}

// パネルの総面積 (m²)
export function getTotalPanelAreaM2(config: AnyConfig): number {
  if (config.type === 'pergola' || config.type === 'single_axis') {
    const c = config as PanelConfig | SingleAxisConfig;
    return c.colsEW * c.rowsNS * c.panelWidth * c.panelDepth;
  } else {
    const c = config as SlopeConfig;
    return c.colsAcross * c.rowsDown * c.panelWidth * c.panelDepth;
  }
}

// 設置ごとの遮光率を計算
export function calcShadingResult(
  installationId: string,
  config: AnyConfig,
  shadows: ShadowPolygon[]
): ShadingResult {
  const shadowArea = totalShadowAreaM2(shadows);
  const fieldArea  = getFieldAreaM2(config);
  const panelArea  = getTotalPanelAreaM2(config);
  const shadingRatioPct  = fieldArea > 0 ? Math.min(100, (shadowArea / fieldArea) * 100) : 0;
  const coverageRatioPct = fieldArea > 0 ? Math.min(100, (panelArea  / fieldArea) * 100) : 0;
  return { installationId, shadowAreaM2: shadowArea, fieldAreaM2: fieldArea, shadingRatioPct, panelAreaM2: panelArea, coverageRatioPct };
}
