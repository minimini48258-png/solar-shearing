/**
 * パネル形状計算モジュール（藤棚型）
 *
 * 座標系: ローカル ENU (East=x, North=y, Up=z)、単位: メートル
 *
 * 藤棚型パネルの配置モデル:
 *  - パネルは facingAzimuth 方向に傾く（通常 180°=南面）
 *  - 傾斜上端が mountHeight + dz、下端が mountHeight - dz
 *  - 地面への水平投影奥行き = panelDepth * cos(tiltAngle)
 *  - 架台全体を rackRotation 度だけ時計回りに回転可能
 */

import { PanelConfig, PanelPolygon, LocalPoint3D } from '../types';

const DEG2RAD = Math.PI / 180;

// 2D ベクトルを angle 度だけ時計回りに回転
function rotateCW(x: number, y: number, angleDeg: number): { x: number; y: number } {
  const r = angleDeg * DEG2RAD;
  return {
    x: x * Math.cos(r) + y * Math.sin(r),
    y: -x * Math.sin(r) + y * Math.cos(r),
  };
}

export function generatePanels(config: PanelConfig): PanelPolygon[] {
  const {
    mountHeight, tiltAngle, panelWidth, panelDepth,
    colsEW, rowsNS, ewSpacing, nsSpacing,
    facingAzimuth, rackRotation,
  } = config;

  const tiltRad = tiltAngle * DEG2RAD;

  // 傾斜方向 (facingAzimuth: 北から時計回り)
  // facingAzimuth=180 → 南面 → 下端が南、上端が北
  const fRad = facingAzimuth * DEG2RAD;
  const fwdE = Math.sin(fRad);   // 傾斜下端方向の東成分
  const fwdN = Math.cos(fRad);   // 傾斜下端方向の北成分

  // 傾斜方向に直交する方向（右手系: fwd を右 90° 回転）
  const rgtE = fwdN;
  const rgtN = -fwdE;

  // 水平投影奥行きと高さ差
  const depthH = panelDepth * Math.cos(tiltRad);  // 水平投影
  const dz = (panelDepth / 2) * Math.sin(tiltRad); // 高端と中心の高さ差

  // パネル中心からの4頂点オフセット（パネルローカル座標）
  // fd: 傾斜方向の距離（+ が下端方向）
  // rd: 直交方向の距離（+ が右手方向）
  // dh: 高さのオフセット（上端側は+、下端側は-）
  const cornerDefs = [
    { fd: -depthH / 2, rd: +panelWidth / 2, dh: +dz },  // 上端-右
    { fd: -depthH / 2, rd: -panelWidth / 2, dh: +dz },  // 上端-左
    { fd: +depthH / 2, rd: -panelWidth / 2, dh: -dz },  // 下端-左
    { fd: +depthH / 2, rd: +panelWidth / 2, dh: -dz },  // 下端-右
  ];

  const panels: PanelPolygon[] = [];
  let idx = 0;

  for (let row = 0; row < rowsNS; row++) {
    for (let col = 0; col < colsEW; col++) {
      // グリッド座標（東西・南北）
      const gridX = (col - (colsEW - 1) / 2) * ewSpacing;
      const gridY = (row - (rowsNS - 1) / 2) * nsSpacing;

      // 架台回転適用（時計回り）
      const { x: pcx, y: pcy } = rotateCW(gridX, gridY, rackRotation);

      // 各頂点の3D座標
      const corners: LocalPoint3D[] = cornerDefs.map(({ fd, rd, dh }) => ({
        x: pcx + fd * fwdE + rd * rgtE,
        y: pcy + fd * fwdN + rd * rgtN,
        z: mountHeight + dh,
      }));

      panels.push({ corners, panelIndex: idx++ });
    }
  }

  return panels;
}

// パネル情報のサマリー
export function getPanelSummary(config: PanelConfig) {
  const totalPanels = config.colsEW * config.rowsNS;
  const panelArea = config.panelWidth * config.panelDepth;
  const totalArea = totalPanels * panelArea;
  // 一般的な変換効率: 約 220 W/m²（単結晶シリコン系パネルの目安）
  const estimatedKw = (totalArea * 220) / 1000;
  return { totalPanels, panelArea, totalArea, estimatedKw };
}
