import { GeoPoint } from '../types';

// 緯度1度 ≈ 111,000 m（定数近似）
const METERS_PER_DEG_LAT = 111000;

// ローカル ENU 座標 → 緯度経度
export function localToGeo(
  local: { x: number; y: number },
  ref: GeoPoint
): GeoPoint {
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((ref.lat * Math.PI) / 180);
  return {
    lat: ref.lat + local.y / METERS_PER_DEG_LAT,
    lng: ref.lng + local.x / metersPerDegLng,
  };
}

// 緯度経度 → ローカル ENU 座標
export function geoToLocal(point: GeoPoint, ref: GeoPoint): { x: number; y: number } {
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((ref.lat * Math.PI) / 180);
  return {
    x: (point.lng - ref.lng) * metersPerDegLng,
    y: (point.lat - ref.lat) * METERS_PER_DEG_LAT,
  };
}

// ハーバーサイン公式による2点間距離 (m)
export function haversineDistance(
  p1: [number, number],  // [lng, lat]
  p2: [number, number]
): number {
  const R = 6371000;
  const lat1 = p1[1] * (Math.PI / 180);
  const lat2 = p2[1] * (Math.PI / 180);
  const dLat = (p2[1] - p1[1]) * (Math.PI / 180);
  const dLon = (p2[0] - p1[0]) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ポリゴン面積 (m²) — ローカル平面近似 (< 5km² 程度で十分な精度)
export function polygonArea(points: [number, number][], ref: GeoPoint): number {
  if (points.length < 3) return 0;
  const local = points.map(([lng, lat]) => geoToLocal({ lat, lng }, ref));
  let area = 0;
  for (let i = 0; i < local.length; i++) {
    const { x: x1, y: y1 } = local[i];
    const { x: x2, y: y2 } = local[(i + 1) % local.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

// Nominatim API を使った住所 → 緯度経度（フリー、APIキー不要）
export async function geocodeAddress(query: string): Promise<GeoPoint | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=ja`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'solar-sharing-sim/0.1 (educational)' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}
