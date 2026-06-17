/**
 * 影計算モジュール
 *
 * 計算原理（地盤傾斜対応モデル）:
 *  パネル頂点 P = (x, y, z) から太陽方向に向かう光線を追い、地盤面との交点を求める。
 *
 *  地盤面の法線ベクトル（上向き）:
 *    nE = sin(φ) × sin(θ)
 *    nN = cos(φ) × sin(θ)
 *    nZ = cos(θ)
 *  ここで θ = 地盤傾斜角、φ = 傾斜方位（下り方向、北から時計回り）
 *
 *  影投影パラメータ T（水平距離係数）:
 *    T = (nE×x + nN×y + nZ×z) / (nE×sin(Az) + nN×cos(Az) + nZ×tan(α))
 *
 *  影の (E, N) 座標:
 *    sE = x − T × sin(Az)
 *    sN = y − T × cos(Az)
 *
 *  θ=0（平地）のとき T = z/tan(α) となり既存の計算と一致する。
 *
 *  前提:
 *  - α > 0°（太陽が地平線より上）のときのみ影を計算
 *  - 地面の起伏は設置ごとに一定傾斜として近似（均一傾斜モデル）
 *  - 遮蔽物（建物・山）による日影は未考慮
 */

import { PanelPolygon, ShadowPolygon, SunPosition } from '../types';

const DEG2RAD = Math.PI / 180;
const MIN_ALTITUDE_DEG = 0.5;

export function computeShadows(
  panels: PanelPolygon[],
  sun: SunPosition,
  groundSlopeAngle = 0,
  groundFacingAzimuth = 180
): ShadowPolygon[] {
  if (sun.altitude < MIN_ALTITUDE_DEG) return [];

  const azRad = sun.azimuth * DEG2RAD;
  const tanAlt = Math.tan(sun.altitude * DEG2RAD);

  // 地盤面の上向き法線
  const sRad = groundSlopeAngle * DEG2RAD;
  const fRad = groundFacingAzimuth * DEG2RAD;
  const nE = Math.sin(fRad) * Math.sin(sRad);
  const nN = Math.cos(fRad) * Math.sin(sRad);
  const nZ = Math.cos(sRad);

  // 分母（太陽方向と法線の内積）。≤0 なら法面が太陽と逆を向いており影が乗らない
  const denom = nE * Math.sin(azRad) + nN * Math.cos(azRad) + nZ * tanAlt;

  return panels
    .map((panel) => {
      const projectedCorners = panel.corners
        .filter((c) => c.z > 0)
        .map((c): [number, number] | null => {
          if (denom <= 0) return null; // 地盤が太陽と逆向き
          const T = (nE * c.x + nN * c.y + nZ * c.z) / denom;
          if (T < 0) return null; // 交点が逆方向（パネル裏側）
          return [c.x - T * Math.sin(azRad), c.y - T * Math.cos(azRad)];
        })
        .filter((p): p is [number, number] => p !== null);

      if (projectedCorners.length < 3) return null;
      return { corners: projectedCorners, panelIndex: panel.panelIndex };
    })
    .filter((s): s is ShadowPolygon => s !== null);
}

/**
 * 標高 heightM の地面への影ポリゴンを返す。
 * 高さ h の面への影 = 平地影を太陽方向へ h/tan(alt) メートルシフトした位置。
 */
export function shiftShadowsForElevation(
  shadows: ShadowPolygon[],
  sun: SunPosition,
  heightM: number
): ShadowPolygon[] {
  if (sun.altitude < MIN_ALTITUDE_DEG || heightM <= 0) return [];
  const tanAlt = Math.tan(sun.altitude * DEG2RAD);
  if (tanAlt < 0.02) return []; // 太陽高度 <~1.1° は影が遠すぎるためスキップ
  const azRad = sun.azimuth * DEG2RAD;
  const shiftM = heightM / tanAlt;
  const shiftE = shiftM * Math.sin(azRad);
  const shiftN = shiftM * Math.cos(azRad);
  return shadows.map((s) => ({
    ...s,
    corners: s.corners.map(([e, n]) => [e + shiftE, n + shiftN] as [number, number]),
  }));
}

// 影面積の概算（シューレース公式）
export function estimateShadowArea(shadow: ShadowPolygon): number {
  if (shadow.corners.length < 3) return 0;
  const pts = shadow.corners;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}
