/**
 * ローカル座標 → GeoJSON 変換モジュール
 * installationType プロパティを付与して MapLibre の data-driven styling に対応
 */

import { GeoPoint, PanelPolygon, ShadowPolygon, InstallationType, TerrainElevation } from '../types';
import { localToGeo } from './geoUtils';

type LngLat = [number, number];

function localXYtoLngLat(x: number, y: number, ref: GeoPoint): LngLat {
  const g = localToGeo({ x, y }, ref);
  return [g.lng, g.lat];
}

function toRing(pts: LngLat[]): LngLat[] {
  return [...pts, pts[0]];
}

// パネル群 → GeoJSON
export function panelsToGeoJSON(
  panels: PanelPolygon[],
  ref: GeoPoint,
  installationType: InstallationType = 'pergola',
  installationId = ''
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: panels.map((panel) => ({
      type: 'Feature',
      id: panel.panelIndex,
      properties: { panelIndex: panel.panelIndex, installationType, installationId },
      geometry: {
        type: 'Polygon',
        coordinates: [toRing(panel.corners.map((c) => localXYtoLngLat(c.x, c.y, ref)))],
      },
    })),
  };
}

// 影群 → GeoJSON
export function shadowsToGeoJSON(
  shadows: ShadowPolygon[],
  ref: GeoPoint,
  installationType: InstallationType = 'pergola',
  installationId = ''
): GeoJSON.FeatureCollection {
  if (!shadows.length) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: shadows.map((shadow) => ({
      type: 'Feature',
      id: shadow.panelIndex,
      properties: { panelIndex: shadow.panelIndex, installationType, installationId },
      geometry: {
        type: 'Polygon',
        coordinates: [toRing(shadow.corners.map(([x, y]) => localXYtoLngLat(x, y, ref)))],
      },
    })),
  };
}

// 基準点群 → GeoJSON
export function refPointsToGeoJSON(
  installations: Array<{ id: string; name: string; installationType: InstallationType; location: GeoPoint }>
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: installations.map((inst, i) => ({
      type: 'Feature',
      id: i,
      properties: { id: inst.id, name: inst.name, installationType: inst.installationType },
      geometry: { type: 'Point', coordinates: [inst.location.lng, inst.location.lat] },
    })),
  };
}

// 地形段差ブロック → GeoJSON（任意ポリゴン）
export function terrainElevationsToGeoJSON(elevations: TerrainElevation[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: elevations
      .filter((e) => e.polygon.length >= 3)
      .map((e, i) => ({
        type: 'Feature',
        id: i,
        properties: { id: e.id, label: e.label, heightM: e.heightM },
        geometry: {
          type: 'Polygon',
          coordinates: [[...e.polygon, e.polygon[0]]],  // GeoJSON closed ring
        },
      })),
  };
}

export function terrainElevationLabelsToGeoJSON(elevations: TerrainElevation[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: elevations
      .filter((e) => e.polygon.length >= 1)
      .map((e, i) => {
        const cx = e.polygon.reduce((s, p) => s + p[0], 0) / e.polygon.length;
        const cy = e.polygon.reduce((s, p) => s + p[1], 0) / e.polygon.length;
        return {
          type: 'Feature',
          id: i,
          properties: { id: e.id, label: e.label || `+${e.heightM}m` },
          geometry: { type: 'Point', coordinates: [cx, cy] },
        };
      }),
  };
}

// 全設置のGeoJSONをマージ
export function mergeFeatureCollections(
  collections: GeoJSON.FeatureCollection[]
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: collections.flatMap((c) => c.features),
  };
}
