/**
 * ローカル座標 → GeoJSON 変換モジュール
 * MapLibre GL JS 用の GeoJSON FeatureCollection を生成する
 */

import { GeoPoint, PanelPolygon, ShadowPolygon } from '../types';
import { localToGeo } from './geoUtils';

type LngLat = [number, number];  // GeoJSON は [経度, 緯度] の順

function localXYtoLngLat(x: number, y: number, ref: GeoPoint): LngLat {
  const geo = localToGeo({ x, y }, ref);
  return [geo.lng, geo.lat];
}

// 閉じたリングに変換（最後に先頭点を追加）
function toRing(pts: LngLat[]): LngLat[] {
  return [...pts, pts[0]];
}

// パネル群 → GeoJSON FeatureCollection
export function panelsToGeoJSON(
  panels: PanelPolygon[],
  ref: GeoPoint
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: panels.map((panel) => ({
      type: 'Feature',
      id: panel.panelIndex,
      properties: { panelIndex: panel.panelIndex },
      geometry: {
        type: 'Polygon',
        coordinates: [
          toRing(panel.corners.map((c) => localXYtoLngLat(c.x, c.y, ref))),
        ],
      },
    })),
  };
}

// 影群 → GeoJSON FeatureCollection
export function shadowsToGeoJSON(
  shadows: ShadowPolygon[],
  ref: GeoPoint
): GeoJSON.FeatureCollection {
  if (shadows.length === 0) {
    return { type: 'FeatureCollection', features: [] };
  }
  return {
    type: 'FeatureCollection',
    features: shadows.map((shadow) => ({
      type: 'Feature',
      id: shadow.panelIndex,
      properties: { panelIndex: shadow.panelIndex },
      geometry: {
        type: 'Polygon',
        coordinates: [
          toRing(shadow.corners.map(([x, y]) => localXYtoLngLat(x, y, ref))),
        ],
      },
    })),
  };
}

// 基準点マーカー → GeoJSON
export function refPointToGeoJSON(ref: GeoPoint): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 0,
        properties: {},
        geometry: {
          type: 'Point',
          coordinates: [ref.lng, ref.lat],
        },
      },
    ],
  };
}
