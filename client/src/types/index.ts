// ===== 座標 =====
export interface GeoPoint { lat: number; lng: number; }
export interface LocalPoint3D { x: number; y: number; z: number; }
export interface SunPosition { azimuth: number; altitude: number; }

// ===== 設置タイプ =====
export type InstallationType = 'pergola' | 'slope';
export type MapStyle = 'street' | 'satellite';

// ===== 藤棚型 =====
export interface PanelConfig {
  type: 'pergola';
  mountHeight: number;
  tiltAngle: number;
  panelWidth: number;
  panelDepth: number;
  colsEW: number;
  rowsNS: number;
  ewSpacing: number;
  nsSpacing: number;
  facingAzimuth: number;
  rackRotation: number;
}

// ===== 法面型 =====
export interface SlopeConfig {
  type: 'slope';
  slopeAngle: number;
  facingAzimuth: number;
  additionalTilt: number;
  panelWidth: number;
  panelDepth: number;
  colsAcross: number;
  rowsDown: number;
  acrossSpacing: number;
  downSpacing: number;
  baseMountHeight: number;
}

export type AnyConfig = PanelConfig | SlopeConfig;

// ===== 形状データ =====
export interface PanelPolygon { corners: LocalPoint3D[]; panelIndex: number; }
export interface ShadowPolygon { corners: [number, number][]; panelIndex: number; }

// ===== 地盤傾斜 =====
export interface GroundSlope {
  angle: number;          // 地盤傾斜角 (degrees, 0=平地)
  facingAzimuth: number;  // 傾斜方位 (degrees from N, 180=南向き斜面)
}

// ===== 複数設置管理 =====
export interface FieldInstallation {
  id: string;
  name: string;
  installationType: InstallationType;
  location: GeoPoint;
  config: AnyConfig;
  groundSlope?: GroundSlope; // 省略時は平地 (angle=0)
}

// ===== 遮光率計算結果 =====
export interface ShadingResult {
  installationId: string;
  shadowAreaM2: number;    // 地表影面積 (m²)
  fieldAreaM2: number;     // 設置エリア地表面積 (m²)
  shadingRatioPct: number; // 遮光率 (%, 0-100)
  panelAreaM2: number;     // パネル総面積 (m²)
  coverageRatioPct: number;// パネル面積率 (%)
}

// ===== 保存案 =====
export interface DesignCase {
  id: string;
  name: string;
  installations: FieldInstallation[];
  createdAt: string;
}

// ===== 計測 =====
export interface MeasurementState {
  active: boolean;
  points: [number, number][];
}
