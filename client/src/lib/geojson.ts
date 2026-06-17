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

// 地形段差ゾーン → GeoJSON（円形ポリゴン近似）
function geoCircleRing(center: GeoPoint, radiusM: number, n = 32): [number, number][] {
  const latRad = center.lat * Math.PI / 180;
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos(latRad));
  const ring: [number, number][] = Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return [center.lng + dLng * Math.sin(a), center.lat + dLat * Math.cos(a)];
  });
  ring.push(ring[0]);
  return ring;
}

export function terrainElevationsToGeoJSON(elevations: TerrainElevation[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: elevations.map((e, i) => ({
      type: 'Feature',
      id: i,
      properties: { id: e.id, label: e.label, heightM: e.heightM, radiusM: e.radiusM },
      geometry: { type: 'Polygon', coordinates: [geoCircleRing(e.location, e.radiusM)] },
    })),
  };
}

export function terrainElevationLabelsToGeoJSON(elevations: TerrainElevation[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: elevations.map((e, i) => ({
      type: 'Feature',
      id: i,
      properties: { id: e.id, label: e.label || `+${e.heightM}m` },
      geometry: { type: 'Point', coordinates: [e.location.lng, e.location.lat] },
    })),
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
