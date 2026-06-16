// ===== 座標 =====

export interface GeoPoint { lat: number; lng: number; }

export interface LocalPoint3D { x: number; y: number; z: number; }

export interface SunPosition {
  azimuth: number;   // 北から時計回り (度)
  altitude: number;  // 水平線からの角度 (度)
}

// ===== 設置タイプ =====

export type InstallationType = 'pergola' | 'slope';
export type MapStyle = 'street' | 'satellite';

// ===== 藤棚型 =====

export interface PanelConfig {
  type: 'pergola';
  mountHeight: number;    // 設置高さ (m)
  tiltAngle: number;      // 傾斜角 (度)
  panelWidth: number;     // パネル幅 (m)
  panelDepth: number;     // パネル奥行き (m)
  colsEW: number;
  rowsNS: number;
  ewSpacing: number;      // 東西中心間隔 (m)
  nsSpacing: number;      // 南北中心間隔 (m)
  facingAzimuth: number;  // 傾斜下端方向 (度、180=南)
  rackRotation: number;   // 架台回転 (度)
}

// ===== 法面型 =====

export interface SlopeConfig {
  type: 'slope';
  slopeAngle: number;       // 法面傾斜角 (度、水平から)
  facingAzimuth: number;    // 法面の向き (度、下り方向)
  additionalTilt: number;   // 法面に対する追加傾斜 (度)
  panelWidth: number;       // パネル幅 (m)
  panelDepth: number;       // パネル奥行き (m)
  colsAcross: number;       // 横列数（法面幅方向）
  rowsDown: number;         // 縦行数（法面斜面方向）
  acrossSpacing: number;    // 横中心間隔 (m)
  downSpacing: number;      // 縦中心間隔 (m; 斜面に沿った距離)
  baseMountHeight: number;  // 法面下端の高さ (m)
}

export type AnyConfig = PanelConfig | SlopeConfig;

// ===== 形状データ =====

export interface PanelPolygon {
  corners: LocalPoint3D[];
  panelIndex: number;
}

export interface ShadowPolygon {
  corners: [number, number][];
  panelIndex: number;
}

// ===== 設計案 =====

export interface DesignCase {
  id: string;
  name: string;
  location: GeoPoint;
  installationType: InstallationType;
  config: AnyConfig;
  createdAt: string;
}

// ===== 計測 =====

export interface MeasurementState {
  active: boolean;
  points: [number, number][];  // [lng, lat]
}
