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
