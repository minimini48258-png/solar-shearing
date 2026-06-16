/**
 * 影計算モジュール
 *
 * 計算原理（簡易モデル）:
 *  高さ z [m] にある点 (x, y, z) が太陽方位角 A [度, 北から時計回り]、
 *  太陽高度角 α [度] のとき、地表面 (z=0) への投影点:
 *
 *    sx = x − z × sin(A_rad) / tan(α_rad)
 *    sy = y − z × cos(A_rad) / tan(α_rad)
 *
 * 前提:
 *  - α > 0°（太陽が地平線より上）のときのみ影を計算
 *  - 地形の起伏・他物体による遮蔽は未考慮（将来の拡張ポイント）
 *  - パネルは剛体平板として扱い、4頂点を独立に投影
 */

import { PanelPolygon, ShadowPolygon, SunPosition } from '../types';

const DEG2RAD = Math.PI / 180;
const MIN_ALTITUDE_DEG = 0.5; // これ以下の太陽高度では影計算しない

// 高さ z の点を太陽位置から地表に投影する
function projectPoint(
  x: number, y: number, z: number,
  sunAzRad: number, tanAlt: number
): [number, number] {
  const shadowLen = z / tanAlt;  // 水平距離 = 高さ / tan(高度角)
  return [
    x - shadowLen * Math.sin(sunAzRad),
    y - shadowLen * Math.cos(sunAzRad),
  ];
}

// パネル群の影ポリゴン群を計算
export function computeShadows(
  panels: PanelPolygon[],
  sun: SunPosition
): ShadowPolygon[] {
  if (sun.altitude < MIN_ALTITUDE_DEG) return [];

  const azRad = sun.azimuth * DEG2RAD;
  const tanAlt = Math.tan(sun.altitude * DEG2RAD);

  return panels
    .map((panel) => {
      const projectedCorners = panel.corners
        .filter((c) => c.z > 0)
        .map((c) => projectPoint(c.x, c.y, c.z, azRad, tanAlt));

      if (projectedCorners.length < 3) return null;

      return {
        corners: projectedCorners as [number, number][],
        panelIndex: panel.panelIndex,
      };
    })
    .filter((s): s is ShadowPolygon => s !== null);
}

// 影面積の概算（平行四辺形近似）
export function estimateShadowArea(shadow: ShadowPolygon): number {
  if (shadow.corners.length < 3) return 0;
  // シューレースの公式（符号付き面積）
  const pts = shadow.corners;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}
