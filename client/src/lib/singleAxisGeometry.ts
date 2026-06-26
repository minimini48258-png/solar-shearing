/**
 * 1軸型（中央1本柱・クロスアーム式）パネル形状計算
 * パネル配置は藤棚型と同等（中央対称グリッド）のため generatePanels を再利用
 */

import { SingleAxisConfig, PanelPolygon } from '../types';
import { generatePanels } from './panelGeometry';

export function generateSingleAxisPanels(config: SingleAxisConfig): PanelPolygon[] {
  return generatePanels({
    type: 'pergola',
    mountHeight: config.mountHeight,
    tiltAngle: config.tiltAngle,
    panelWidth: config.panelWidth,
    panelDepth: config.panelDepth,
    colsEW: config.colsEW,
    rowsNS: config.rowsNS,
    ewSpacing: config.ewSpacing,
    nsSpacing: config.nsSpacing,
    facingAzimuth: config.facingAzimuth,
    rackRotation: config.rackRotation,
  });
}

export function getSingleAxisSummary(config: SingleAxisConfig) {
  const totalPanels = config.colsEW * config.rowsNS;
  const panelArea = config.panelWidth * config.panelDepth;
  const totalArea = totalPanels * panelArea;
  const estimatedKw = (totalArea * 220) / 1000;
  return { totalPanels, panelArea, totalArea, estimatedKw };
}
