// ===== 地点・座標 =====

export interface GeoPoint {
  lat: number;  // 緯度
  lng: number;  // 経度
}

// ローカル ENU (East-North-Up) 座標系（メートル）
// 原点 = 設置地点の中心
export interface LocalPoint3D {
  x: number;  // East（東）
  y: number;  // North（北）
  z: number;  // Up（高さ）
}

// ===== 太陽位置 =====

export interface SunPosition {
  azimuth: number;   // 方位角: 度、北から時計回り (0=北, 90=東, 180=南, 270=西)
  altitude: number;  // 高度角: 度、水平線から上 (負値=地平線以下)
}

// ===== パネル設定 =====

export type InstallationType = 'pergola';  // MVP: 藤棚型のみ

export interface PanelConfig {
  type: InstallationType;
  mountHeight: number;    // 設置高さ (m) — パネル中心の地面からの高さ
  tiltAngle: number;      // 傾斜角 (度) — 水平面からの角度
  panelWidth: number;     // パネル幅 (m) — 東西方向
  panelDepth: number;     // パネル奥行き (m) — 設置面に沿った南北寸法
  colsEW: number;         // 東西方向の列数
  rowsNS: number;         // 南北方向の行数
  ewSpacing: number;      // 東西中心間隔 (m)
  nsSpacing: number;      // 南北中心間隔 (m)
  facingAzimuth: number;  // 傾斜が下がる方向 (度、180=南面)
  rackRotation: number;   // 架台全体の回転角 (度、時計回り)
}

// ===== パネル形状 =====

export interface PanelPolygon {
  corners: LocalPoint3D[];  // 4頂点 (3D、ローカル座標)
  panelIndex: number;
}

// ===== 影形状 =====

export interface ShadowPolygon {
  corners: [number, number][];  // 地表面の頂点 (ローカルXY座標)
  panelIndex: number;
}

// ===== 設計案 =====

export interface DesignCase {
  id: string;
  name: string;
  location: GeoPoint;
  panelConfig: PanelConfig;
  createdAt: string;
}

// ===== アプリ全体の状態 =====

export interface AppState {
  location: GeoPoint;
  panelConfig: PanelConfig;
  dateStr: string;    // YYYY-MM-DD
  timeMinutes: number;  // 0–1439（0:00〜23:59）
  isPlaying: boolean;
  mapZoom: number;
  savedCases: DesignCase[];
}
