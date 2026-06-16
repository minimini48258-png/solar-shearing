/**
 * 日平均遮光率計算モジュール
 *
 * 指定日の日の出〜日没を一定間隔でサンプリングし、各時刻の遮光率を平均する。
 * 瞬間値（現在時刻）とは異なり、その日全体での営農への影響度の目安となる。
 */

import { FieldInstallation, PanelConfig } from '../types';
import { getSunPosition } from './solar';
import { generatePanels } from './panelGeometry';
import { generateSlopePanels } from './slopePanelGeometry';
import { computeShadows } from './shadow';
import { calcShadingResult } from './shadingCalc';

export function calcDailyAverageShadingPct(
  inst: FieldInstallation,
  dateStr: string,
  intervalMinutes = 15
): number {
  const panels = inst.installationType === 'pergola'
    ? generatePanels(inst.config as PanelConfig)
    : generateSlopePanels(inst.config as import('../types').SlopeConfig);

  const samples: number[] = [];
  for (let m = 0; m < 1440; m += intervalMinutes) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    const dt = new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+09:00`);
    const sunPos = getSunPosition(inst.location.lat, inst.location.lng, dt);
    if (sunPos.altitude > 0.5) {
      const shadows = computeShadows(panels, sunPos);
      const result = calcShadingResult(inst.id, inst.config, shadows);
      samples.push(result.shadingRatioPct);
    }
  }
  return samples.length > 0 ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
}
