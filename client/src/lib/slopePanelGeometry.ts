/**
 * 法面（野立て）パネル形状計算モジュール
 *
 * 座標系: ローカル ENU (East=x, North=y, Up=z)、単位: メートル
 *
 * モデルの前提:
 *  - 法面は slopeAngle の傾斜角で facingAzimuth 方向に下がる
 *  - パネルは法面表面に並列設置 + additionalTilt の追加傾斜
 *  - 実効傾斜角 = slopeAngle + additionalTilt
 *  - row=0 が法面下端（最低高さ）、row が増えるにつれ上昇
 *  - 影計算は藤棚型と同じ投影式を利用
 */

import { SlopeConfig, PanelPolygon, LocalPoint3D } from '../types';

const DEG2RAD = Math.PI / 180;

export function generateSlopePanels(config: SlopeConfig): PanelPolygon[] {
  const {
    slopeAngle, facingAzimuth, additionalTilt,
    panelWidth, panelDepth,
    colsAcross, rowsDown,
    acrossSpacing, downSpacing,
    baseMountHeight,
  } = config;

  const slopeRad = slopeAngle * DEG2RAD;
  // 実効傾斜（法面角度 + 追加傾斜）
  const effTiltRad = (slopeAngle + additionalTilt) * DEG2RAD;

  // パネル水平投影奥行きと高さ差
  const depthH = panelDepth * Math.cos(effTiltRad);
  const dz = (panelDepth / 2) * Math.sin(effTiltRad);

  // 傾斜下り方向ベクトル（ENU）
  const fRad = facingAzimuth * DEG2RAD;
  const fwdE = Math.sin(fRad);
  const fwdN = Math.cos(fRad);

  // 横方向ベクトル（直交）
  const rgtE = fwdN;
  const rgtN = -fwdE;

  // 斜面を上る方向
  const upE = -fwdE;
  const upN = -fwdN;

  const cornerDefs = [
    { fd: -depthH / 2, rd: +panelWidth / 2, dh: +dz },  // 上端-右
    { fd: -depthH / 2, rd: -panelWidth / 2, dh: +dz },  // 上端-左
    { fd: +depthH / 2, rd: -panelWidth / 2, dh: -dz },  // 下端-左
    { fd: +depthH / 2, rd: +panelWidth / 2, dh: -dz },  // 下端-右
  ];

  const panels: PanelPolygon[] = [];
  let idx = 0;

  for (let row = 0; row < rowsDown; row++) {
    for (let col = 0; col < colsAcross; col++) {
      // row=0 が法面下端
      const slopeDist = row * downSpacing;           // 斜面に沿った距離
      const horizDist = slopeDist * Math.cos(slopeRad); // 水平投影距離
      const heightOffset = slopeDist * Math.sin(slopeRad); // 高さオフセット

      // 横方向オフセット
      const lateralOffset = (col - (colsAcross - 1) / 2) * acrossSpacing;

      // パネル中心位置
      const pcx = horizDist * upE + lateralOffset * rgtE;
      const pcy = horizDist * upN + lateralOffset * rgtN;
      const pcz = baseMountHeight + heightOffset;

      const corners: LocalPoint3D[] = cornerDefs.map(({ fd, rd, dh }) => ({
        x: pcx + fd * fwdE + rd * rgtE,
        y: pcy + fd * fwdN + rd * rgtN,
        z: pcz + dh,
      }));

      panels.push({ corners, panelIndex: idx++ });
    }
  }

  return panels;
}

export function getSlopeSummary(config: SlopeConfig) {
  const totalPanels = config.colsAcross * config.rowsDown;
  const panelArea = config.panelWidth * config.panelDepth;
  const totalArea = totalPanels * panelArea;
  const estimatedKw = (totalArea * 220) / 1000;
  return { totalPanels, panelArea, totalArea, estimatedKw };
}
