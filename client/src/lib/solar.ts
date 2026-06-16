/**
 * 太陽位置計算モジュール
 *
 * SunCalc ライブラリを利用。
 * SunCalc の azimuth は「南から反時計回り（ラジアン）」なので、
 * 気象学的慣例「北から時計回り（度）」に変換する。
 *
 * 変換式: azimuth_north_cw_deg = azimuth_suncalc_rad * (180/π) + 180
 */

import SunCalc from 'suncalc';
import { SunPosition } from '../types';

const RAD2DEG = 180 / Math.PI;

export function getSunPosition(lat: number, lng: number, date: Date): SunPosition {
  const pos = SunCalc.getPosition(date, lat, lng);

  // SunCalc azimuth: radians from south, counterclockwise
  // → degrees from north, clockwise
  let azimuth = pos.azimuth * RAD2DEG + 180;
  if (azimuth < 0) azimuth += 360;
  if (azimuth >= 360) azimuth -= 360;

  const altitude = pos.altitude * RAD2DEG;

  return { azimuth, altitude };
}

// 代表日プリセット（日本時間、UTC+9）
export const SEASON_PRESETS: Record<string, { label: string; dateStr: string }> = {
  springEquinox:  { label: '春分 (3/20)',   dateStr: '2025-03-20' },
  summerSolstice: { label: '夏至 (6/21)',   dateStr: '2025-06-21' },
  autumnEquinox:  { label: '秋分 (9/23)',   dateStr: '2025-09-23' },
  winterSolstice: { label: '冬至 (12/21)', dateStr: '2025-12-21' },
};

// 日の出・日の入り時刻（地方時）を返す
export function getSunTimes(lat: number, lng: number, dateStr: string) {
  const date = new Date(dateStr + 'T12:00:00+09:00');
  const times = SunCalc.getTimes(date, lat, lng);
  return {
    sunrise: times.sunrise,
    sunset: times.sunset,
    solarNoon: times.solarNoon,
  };
}
