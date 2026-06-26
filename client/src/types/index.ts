// ===== 座標 =====
export interface GeoPoint { lat: number; lng: number; }
export interface LocalPoint3D { x: number; y: number; z: number; }
export interface SunPosition { azimuth: number; altitude: number; }

// ===== 設置タイプ =====
export type InstallationType = 'pergola' | 'slope' | 'single_axis';
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

// ===== 1軸型（中央1本柱・クロスアーム式） =====
export interface SingleAxisConfig {
  type: 'single_axis';
  mountHeight: number;   // 柱高さ (m)
  tiltAngle: number;     // 傾斜角 (°)
  panelWidth: number;    // パネル幅 (m, EW方向)
  panelDepth: number;    // パネル奥行き (m, NS方向)
  colsEW: number;        // EW方向総列数（中央柱を挟んで両側合計）
  rowsNS: number;        // NS方向行数
  ewSpacing: number;     // EW C-C間隔 (m)
  nsSpacing: number;     // NS C-C間隔 = 柱ピッチ (m)
  facingAzimuth: number; // 方位角 (°)
  rackRotation: number;  // 架台回転 (°)
}

export type AnyConfig = PanelConfig | SlopeConfig | SingleAxisConfig;

// ===== 形状データ =====
export interface PanelPolygon { corners: LocalPoint3D[]; panelIndex: number; }
export interface ShadowPolygon { corners: [number, number][]; panelIndex: number; }

// ===== 地盤傾斜 =====
export interface GroundSlope {
  angle: number;          // 地盤傾斜角 (degrees, 0=平地)
  facingAzimuth: number;  // 傾斜方位 (degrees from N, 180=南向き斜面)
}

// ===== パネル仕様 =====
export interface PanelSpec {
  model: string;
  maker: string;
  widthMm: number;        // 短辺 (横設置時=EW方向)
  lengthMm: number;       // 長辺 (傾斜方向)
  thicknessMm: number;
  weightKg: number;
  wattage: number;        // 表面Pmax (W)
  isBifacial: boolean;
  bifacialGainPct: number; // 裏面発電増加率 (%)
  voc: number;
  isc: number;
  vmp: number;
  imp: number;
}

export const PANEL_PRESETS: (PanelSpec & { key: string })[] = [
  {
    key: 'LP510W',
    model: 'LP182*210-M-54-NB-510W',
    maker: 'Leapton Energy',
    widthMm: 1134, lengthMm: 1961, thicknessMm: 30,
    weightKg: 26.6, wattage: 510, isBifacial: true, bifacialGainPct: 10,
    voc: 40.57, isc: 16.01, vmp: 33.73, imp: 15.12,
  },
  {
    key: 'custom',
    model: 'カスタム', maker: '（カスタム入力）',
    widthMm: 1000, lengthMm: 2000, thicknessMm: 35,
    weightKg: 25.0, wattage: 400, isBifacial: false, bifacialGainPct: 0,
    voc: 38.0, isc: 13.0, vmp: 32.0, imp: 12.5,
  },
];

// ===== カスタム描画線 =====
export interface CustomDrawLine {
  id: string;
  color: string;
  width: number;
  label?: string;
  // 絶対座標モード（単一ビューのみ、3D非対応）
  x1?: number; y1?: number;
  x2?: number; y2?: number;
  // スパン繰り返しモード（全スパン + 3D同期）
  repeat?: boolean;
  repeatDir?: 'EW' | 'NS';
  n1?: number;   // スパン内正規化水平位置 0~1（左ポスト=0, 右ポスト=1）
  z1m?: number;  // 高さ（m、地面=0）
  n2?: number;
  z2m?: number;
}

// ===== 架台仕様 - 藤棚型（さざ波式ソーラーシェアリング架台） =====
export interface PergolaRackSpec {
  // 柱 (Posts)
  postDiameterMm: number;      // 外径 (e.g., 114.3)
  postThicknessMm: number;     // 肉厚 (e.g., 4.5)
  postMaterial: string;        // 材質 (e.g., 'STK400 亜鉛メッキ')
  // ヨコサン (Cross beams, spanning EW between posts)
  yokosanH: number;            // 断面高さ mm (e.g., 100)
  yokosanW: number;            // 断面幅 mm (e.g., 50)
  yokosanT: number;            // 肉厚 mm (e.g., 2.3)
  // タテサン (Longitudinal purlins, spanning NS, panels mount on these)
  tatesanH: number;            // 断面高さ mm (e.g., 60)
  tatesanW: number;            // 断面幅 mm (e.g., 30)
  tatesanT: number;            // 肉厚 mm (e.g., 2.3)
  tatesanPerSpan: number;      // 1スパン(パネル1枚幅)あたりのタテサン本数 (e.g., 2)
  // 架台レイアウト (パネル配置と独立して設定可能)
  postColsEW?: number;         // EW方向支柱列数 (省略時=colsEW+1、パネル境界位置に配置)
  yokosanRowsNS?: number;      // NS方向ヨコサン本数 (省略時=rowsNS+1、パネル境界位置に配置)
  // 筋交い (Diagonal bracing)
  hasBrace: boolean;
  braceDiameterMm: number;     // 径 mm (e.g., 42.7)
  braceThicknessMm: number;    // 肉厚 mm (e.g., 2.3)
  braceAttachY: number;        // 支柱取付高さ比率 0~1 (Y軸: 0=根元, 1=支柱頂部)
  braceReachX: number;         // NS方向伸び比率 0~1 (X軸: 0=支柱直上, 1=隣ヨコサン位置まで)
  // タテサン位置
  tatesanZRatio?: number;      // タテサン高さ比率 0~1 (省略時=0.5, 支柱中間)
  // カスタム描画線 (立面図・断面図に重ね描き)
  customLines?: Record<string, CustomDrawLine[]>; // キー='front'/'back'/'left'/'right'/'section'
  // ベースプレート (Base plates)
  basePlateWidthMm: number;    // (e.g., 250)
  basePlateThicknessMm: number;// (e.g., 12)
  // 基礎
  foundationDepthM: number;    // 根入れ深さ m (e.g., 1.5)
  foundationType: 'direct' | 'baseplate' | 'anchor';
}

// ===== 架台仕様 - 1軸型 =====
export interface SingleAxisRackSpec {
  postDiameterMm: number;
  postThicknessMm: number;
  postMaterial: string;
  crossarmH: number;          // クロスアーム断面高さ mm
  crossarmW: number;          // 断面幅 mm
  crossarmT: number;          // 肉厚 mm
  purlinH: number;            // パーリン(NS方向)断面高さ mm
  purlinW: number;
  purlinT: number;
  purlinPerBay: number;       // EW方向パーリン本数(総数)
  braceH: number;             // 斜材取付高さ比率 0~1
  braceDiameterMm: number;
  braceThicknessMm: number;
  basePlateWidthMm: number;
  basePlateThicknessMm: number;
  foundationDepthM: number;
  foundationType: 'direct' | 'baseplate' | 'anchor';
}

// ===== 架台仕様 - 法面型 =====
export interface SlopeRackSpec {
  // 支柱 (Posts perpendicular to slope)
  postDiameterMm: number;
  postThicknessMm: number;
  postMaterial: string;
  postHeightMm: number;        // 法面面からの突出高さ mm (e.g., 400)
  // 上弦材 / 下弦材 (Top and bottom horizontal rails, running across slope = EW)
  chordH: number;              // 断面高さ mm
  chordW: number;              // 断面幅 mm
  chordT: number;              // 肉厚 mm
  // 縦桟 (Vertical rails along slope direction, panels mount on these)
  vertRailH: number;
  vertRailW: number;
  vertRailT: number;
  vertRailPerPanel: number;    // パネル1枚あたりの縦桟本数 (e.g., 2)
  // 横桟 (Horizontal rails across slope, intermediate)
  horizRailH: number;
  horizRailW: number;
  horizRailT: number;
  // 筋交い
  hasBrace: boolean;
  // 基礎
  foundationType: 'pile' | 'mass' | 'block';
  foundationDepthM: number;
  pileDiameterMm: number;      // 鋼管杭径 mm
}

// ===== 複数設置管理 =====
export interface FieldInstallation {
  id: string;
  name: string;
  installationType: InstallationType;
  location: GeoPoint;
  config: AnyConfig;
  groundSlope?: GroundSlope; // 省略時は平地 (angle=0)
  panelSpec?: PanelSpec;     // パネル仕様（省略時はデフォルト）
  rackSpec?: PergolaRackSpec | SlopeRackSpec | SingleAxisRackSpec; // 架台仕様
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

// ===== 地形段差ブロック =====
export interface TerrainElevation {
  id: string;
  label: string;
  heightM: number;                  // 基準面からの高さ (m)
  polygon: [number, number][];      // [lng, lat] 頂点配列（未閉合でよい）
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
