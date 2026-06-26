import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  FieldInstallation, PanelConfig, SlopeConfig, SingleAxisConfig, AnyConfig, PanelPolygon, PanelSpec,
  PergolaRackSpec, SlopeRackSpec, SingleAxisRackSpec, PANEL_PRESETS, CustomDrawLine,
} from '../types';
import { generatePanels } from '../lib/panelGeometry';
import { generateSlopePanels } from '../lib/slopePanelGeometry';
import { generateSingleAxisPanels } from '../lib/singleAxisGeometry';
import './DrawingView.css';

type DrawingTab = '3d' | 'plan' | 'elevation' | 'section';

interface Props {
  installations: FieldInstallation[];
  activeId: string;
  onInstallationChange: (id: string, patch: Partial<FieldInstallation>) => void;
  onClose: () => void;
}

// ===== Default rack specs =====

const DEF_PERGOLA_RACK: PergolaRackSpec = {
  postDiameterMm: 114.3, postThicknessMm: 4.5, postMaterial: 'STK400 亜鉛メッキ',
  yokosanH: 100, yokosanW: 50, yokosanT: 2.3,
  tatesanH: 60, tatesanW: 30, tatesanT: 2.3, tatesanPerSpan: 2,
  hasBrace: true, braceDiameterMm: 42.7, braceThicknessMm: 2.3,
  braceAttachY: 0.65, braceReachX: 1.0,
  basePlateWidthMm: 250, basePlateThicknessMm: 12,
  foundationDepthM: 1.5, foundationType: 'baseplate',
};

const DEF_SINGLE_AXIS_RACK: SingleAxisRackSpec = {
  postDiameterMm: 114.3, postThicknessMm: 4.5, postMaterial: 'STK400 亜鉛メッキ',
  crossarmH: 100, crossarmW: 50, crossarmT: 3.2,
  purlinH: 60, purlinW: 30, purlinT: 2.3, purlinPerBay: 4,
  braceH: 0.6, braceDiameterMm: 48.6, braceThicknessMm: 2.3,
  basePlateWidthMm: 250, basePlateThicknessMm: 12,
  foundationDepthM: 1.5, foundationType: 'baseplate',
};

const DEF_SLOPE_RACK: SlopeRackSpec = {
  postDiameterMm: 89.1, postThicknessMm: 3.5, postMaterial: 'STK400 亜鉛メッキ',
  postHeightMm: 400,
  chordH: 80, chordW: 60, chordT: 2.3,
  vertRailH: 60, vertRailW: 30, vertRailT: 2.3, vertRailPerPanel: 2,
  horizRailH: 60, horizRailW: 30, horizRailT: 2.3,
  hasBrace: true,
  foundationType: 'pile', foundationDepthM: 1.5, pileDiameterMm: 114.3,
};

const DRAW_COLORS = ['#8a6a20', '#e53e3e', '#2b7dc7', '#1a1a1a', '#22aa33', '#e07010'] as const;
const VIEW_LABELS: Record<string, string> = {
  front: '正面', back: '背面', right: '右側面', left: '左側面', section: '断面',
};

// ===== Coordinate helpers =====

function rotatePlan(x: number, y: number, azDeg: number): [number, number] {
  const θ = (azDeg - 180) * Math.PI / 180;
  const c = Math.cos(θ), s = Math.sin(θ);
  return [x * c - y * s, x * s + y * c];
}

function enuToThree(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y);
}

function computeBBox(corners: { x: number; y: number; z: number }[]) {
  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;
  let zMin = Infinity, zMax = -Infinity;
  for (const c of corners) {
    xMin = Math.min(xMin, c.x); xMax = Math.max(xMax, c.x);
    yMin = Math.min(yMin, c.y); yMax = Math.max(yMax, c.y);
    zMin = Math.min(zMin, c.z); zMax = Math.max(zMax, c.z);
  }
  return { xMin, xMax, yMin, yMax, zMin, zMax };
}

function getAzimuth(inst: FieldInstallation): number {
  if (inst.config.type === 'pergola') return (inst.config as PanelConfig).facingAzimuth;
  if (inst.config.type === 'single_axis') return (inst.config as SingleAxisConfig).facingAzimuth;
  return (inst.config as SlopeConfig).facingAzimuth;
}

function getEffectiveRack(inst: FieldInstallation): PergolaRackSpec | SlopeRackSpec | SingleAxisRackSpec {
  if (inst.rackSpec) return inst.rackSpec;
  if (inst.installationType === 'pergola') return DEF_PERGOLA_RACK;
  if (inst.installationType === 'single_axis') return DEF_SINGLE_AXIS_RACK;
  return DEF_SLOPE_RACK;
}

function getEffectivePanelSpec(inst: FieldInstallation): PanelSpec {
  return inst.panelSpec ?? PANEL_PRESETS[0];
}

// EW方向グリッド: postColsEW 本を架台幅に等間隔配置
function computeXGrid(cfg: PanelConfig, rack: PergolaRackSpec): number[] {
  const ewTotal = cfg.colsEW * cfg.ewSpacing;
  const n = Math.max(2, rack.postColsEW ?? (cfg.colsEW + 1));
  return Array.from({ length: n }, (_, i) => -ewTotal / 2 + i * ewTotal / (n - 1));
}

// NS方向グリッド: パネルNS中心に1本ずつ配置（1本軸）
// yokosanRowsNS が指定されていれば等間隔で任意本数に分割
function computeYGrid(cfg: PanelConfig, rack: PergolaRackSpec): number[] {
  const nsTotal = cfg.rowsNS * cfg.nsSpacing;
  if (rack.yokosanRowsNS !== undefined) {
    const n = Math.max(2, rack.yokosanRowsNS);
    return Array.from({ length: n }, (_, j) => -nsTotal / 2 + j * nsTotal / (n - 1));
  }
  // 自動: パネルNS中心に1本配置（1パネル = 1本軸）
  return Array.from({ length: cfg.rowsNS }, (_, row) =>
    (row - (cfg.rowsNS - 1) / 2) * cfg.nsSpacing
  );
}

// ===== Custom line repeat helpers =====

function getRepeatDir(toSVG: (x: number, y: number, z: number) => [number, number]): 'EW' | 'NS' {
  return Math.abs(toSVG(1, 0, 0)[0]) >= Math.abs(toSVG(0, 1, 0)[0]) ? 'EW' : 'NS';
}

function getRepeatGridSVG(
  dir: 'EW' | 'NS', xGrid: number[], yGrid: number[],
  toSVG: (x: number, y: number, z: number) => [number, number]
): number[] {
  return dir === 'EW'
    ? xGrid.map(gx => toSVG(gx, 0, 0)[0])
    : yGrid.map(gy => toSVG(0, gy, 0)[0]);
}

function findNearestSpanIdx(midX: number, gridSVG: number[]): number {
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < gridSVG.length - 1; i++) {
    const dist = Math.abs(midX - (gridSVG[i] + gridSVG[i + 1]) / 2);
    if (dist < bestDist) { bestDist = dist; best = i; }
  }
  return best;
}

// ===== Three.js helpers =====

function addCylinder(
  scene: THREE.Scene, p1: THREE.Vector3, p2: THREE.Vector3, radius: number, mat: THREE.Material
) {
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const len = dir.length();
  if (len < 0.001) return;
  const geo = new THREE.CylinderGeometry(radius, radius, len, 10, 1);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(p1).add(p2).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  scene.add(mesh);
}

// ===== 3D Scene =====

function buildThreeScene(installation: FieldInstallation) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd0e6f5);
  scene.fog = new THREE.FogExp2(0xd0e6f5, 0.01);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const sun = new THREE.DirectionalLight(0xfff4d6, 1.1);
  sun.position.set(-8, 18, 6);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xc8dcff, 0.3);
  fill.position.set(10, 5, -8);
  scene.add(fill);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshLambertMaterial({ color: 0x68946a })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const grid = new THREE.GridHelper(40, 40, 0x607060, 0x8aaa88);
  grid.position.y = 0.01;
  scene.add(grid);

  const isP = installation.installationType === 'pergola';
  const panelMat = new THREE.MeshPhongMaterial({
    color: isP ? 0x1d4ed8 : 0xd45e0a,
    specular: 0x223366, shininess: 55,
    transparent: true, opacity: 0.88, side: THREE.DoubleSide,
  });
  const edgeMat = new THREE.LineBasicMaterial({ color: isP ? 0x1e3a8a : 0x9a3412 });

  const isSA = installation.installationType === 'single_axis';
  const panels: PanelPolygon[] = isP
    ? generatePanels(installation.config as PanelConfig)
    : isSA
    ? generateSingleAxisPanels(installation.config as SingleAxisConfig)
    : generateSlopePanels(installation.config as SlopeConfig);

  for (const panel of panels) {
    const pts = panel.corners.map(c => enuToThree(c.x, c.y, c.z));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      pts[0].x, pts[0].y, pts[0].z,
      pts[1].x, pts[1].y, pts[1].z,
      pts[2].x, pts[2].y, pts[2].z,
      pts[0].x, pts[0].y, pts[0].z,
      pts[2].x, pts[2].y, pts[2].z,
      pts[3].x, pts[3].y, pts[3].z,
    ]), 3));
    geo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo, panelMat));
    const eg = new THREE.BufferGeometry().setFromPoints([...pts, pts[0]]);
    scene.add(new THREE.Line(eg, edgeMat));
  }

  const rack = getEffectiveRack(installation);
  if (isP) {
    addPergolaStructure(scene, installation.config as PanelConfig, rack as PergolaRackSpec, panels);
  } else if (isSA) {
    addSingleAxisStructure(scene, installation.config as SingleAxisConfig, rack as SingleAxisRackSpec, panels);
  } else {
    addSlopeStructure(scene, installation.config as SlopeConfig, rack as SlopeRackSpec, panels);
  }

  // North arrow
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.8, 8), arrowMat);
  body.position.set(-14, 0.45, 13.6);
  scene.add(body);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.45, 8), arrowMat);
  head.position.set(-14, 0.9, 13.0);
  scene.add(head);

  const bb = computeBBox(panels.flatMap(p => p.corners));
  const cx = (bb.xMin + bb.xMax) / 2;
  const cy = (bb.yMin + bb.yMax) / 2;
  const cz = (bb.zMin + bb.zMax) / 2;
  const span = Math.max(bb.xMax - bb.xMin, bb.yMax - bb.yMin, bb.zMax - bb.zMin, 4);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
  const threeCy = cz + 1;
  camera.position.set(cx + span * 1.2, threeCy + span * 0.9, -cy + span * 1.4);
  camera.lookAt(cx, threeCy, -cy);

  const buildControls = (el: HTMLElement): OrbitControls => {
    const ctrl = new OrbitControls(camera, el);
    ctrl.enableDamping = true;
    ctrl.dampingFactor = 0.08;
    ctrl.target.set(cx, threeCy, -cy);
    ctrl.update();
    return ctrl;
  };
  return { scene, camera, buildControls };
}

function addPergolaStructure(
  scene: THREE.Scene, cfg: PanelConfig, rack: PergolaRackSpec, _panels: PanelPolygon[]
) {
  const { colsEW, rowsNS, ewSpacing, nsSpacing, mountHeight, rackRotation } = cfg;

  // Apply same rackRotation as generatePanels (clockwise in ENU horizontal plane)
  const rotRad = rackRotation * Math.PI / 180;
  const cosr = Math.cos(rotRad), sinr = Math.sin(rotRad);
  const rotENU = (ex: number, en: number): [number, number] => [
    ex * cosr + en * sinr,
    -ex * sinr + en * cosr,
  ];
  const pt = (ex: number, en: number, ez: number) => {
    const [rx, ry] = rotENU(ex, en);
    return enuToThree(rx, ry, ez);
  };

  // Materials — colors matching さざ波式 image
  const postMat  = new THREE.MeshLambertMaterial({ color: 0x2b7dc7 }); // 柱: blue
  const ykMat    = new THREE.MeshLambertMaterial({ color: 0xcc44aa }); // ヨコサン: pink
  const tsMat    = new THREE.MeshLambertMaterial({ color: 0x22aa33 }); // タテサン: green
  const plateMat = new THREE.MeshLambertMaterial({ color: 0xee6622 }); // ベースプレート: orange

  const postR = rack.postDiameterMm / 1000 / 2;
  const bp    = rack.basePlateWidthMm / 1000;
  const bpt   = rack.basePlateThicknessMm / 1000;
  const ysH   = rack.yokosanH / 1000;
  const tsW   = rack.tatesanW / 1000;

  // 架台グリッド
  const ewTotal  = colsEW * ewSpacing;
  const xGrid    = computeXGrid(cfg, rack);
  const yGrid    = computeYGrid(cfg, rack);  // パネルNS端部に自動配置
  const yRowsNS  = yGrid.length;

  // パネルはヨコサンの上に直接設置
  const postTopZ   = mountHeight - ysH;                               // 支柱頂部 = ヨコサン底面
  const yokosanZ   = mountHeight - ysH / 2;                           // ヨコサン中心（上面 = mountHeight）
  const tatesanZ   = postTopZ * (rack.tatesanZRatio ?? 0.5);          // タテサン（NS横補強材）
  const brMat      = new THREE.MeshLambertMaterial({ color: 0x8a6a20 });
  const attachY    = rack.braceAttachY ?? 0.65;
  const reachX     = rack.braceReachX  ?? 1.0;

  // ===== 支柱 + 斜材 =====
  const plateGeo = new THREE.BoxGeometry(bp, bpt, bp);
  for (const gx of xGrid) {
    for (let j = 0; j < yRowsNS; j++) {
      const gy         = yGrid[j];
      const base       = pt(gx, gy, 0);
      const postTop    = pt(gx, gy, postTopZ);
      const braceStart = pt(gx, gy, postTopZ * attachY);

      addCylinder(scene, base, postTop, postR, postMat);

      if (j > 0) {
        const nsReach = (yGrid[j] - yGrid[j - 1]) * reachX;
        addCylinder(scene, braceStart, pt(gx, gy - nsReach, yokosanZ), postR * 0.75, brMat);
      }
      if (j < yRowsNS - 1) {
        const nsReach = (yGrid[j + 1] - yGrid[j]) * reachX;
        addCylinder(scene, braceStart, pt(gx, gy + nsReach, yokosanZ), postR * 0.75, brMat);
      }

      const plate = new THREE.Mesh(plateGeo, plateMat);
      plate.position.set(base.x, bpt / 2, base.z);
      plate.rotation.y = -rotRad;
      scene.add(plate);
    }
  }

  // ===== ヨコサン（支柱頂部に直乗り、EW方向、パネル直下）=====
  for (const gy of yGrid) {
    const p1 = pt(xGrid[0], gy, yokosanZ);
    const p2 = pt(xGrid[xGrid.length - 1], gy, yokosanZ);
    addCylinder(scene, p1, p2, ysH / 2, ykMat);
  }

  // ===== タテサン（支柱中間部、NS方向補強材）=====
  const tCount  = Math.max(1, colsEW * rack.tatesanPerSpan);
  for (let i = 0; i < tCount; i++) {
    const gx = xGrid[0] + (i + 0.5) / tCount * ewTotal;
    const p1 = pt(gx, yGrid[0], tatesanZ);
    const p2 = pt(gx, yGrid[yGrid.length - 1], tatesanZ);
    addCylinder(scene, p1, p2, tsW / 2, tsMat);
  }

  // ===== カスタム繰り返し線（3D同期）=====
  if (rack.customLines) {
    for (const lines of Object.values(rack.customLines)) {
      for (const line of lines) {
        if (!line.repeat || line.n1 === undefined || line.n2 === undefined) continue;
        const mat = new THREE.MeshLambertMaterial({ color: line.color });
        const r = Math.max(0.015, line.width / 2);
        const { n1, n2, z1m = 0, z2m = 0 } = line;
        if (line.repeatDir === 'EW') {
          for (let xi = 0; xi < xGrid.length - 1; xi++) {
            const sw = xGrid[xi + 1] - xGrid[xi];
            const ex1 = xGrid[xi] + n1 * sw, ex2 = xGrid[xi] + n2 * sw;
            for (const gy of yGrid) {
              addCylinder(scene, pt(ex1, gy, z1m), pt(ex2, gy, z2m), r, mat);
            }
          }
        } else if (line.repeatDir === 'NS') {
          for (let yi = 0; yi < yGrid.length - 1; yi++) {
            const sw = yGrid[yi + 1] - yGrid[yi];
            const ey1 = yGrid[yi] + n1 * sw, ey2 = yGrid[yi] + n2 * sw;
            for (const gx of xGrid) {
              addCylinder(scene, pt(gx, ey1, z1m), pt(gx, ey2, z2m), r, mat);
            }
          }
        }
      }
    }
  }

}

function addSlopeStructure(
  scene: THREE.Scene, cfg: SlopeConfig, rack: SlopeRackSpec, panels: PanelPolygon[]
) {
  const { slopeAngle, facingAzimuth, rowsDown, downSpacing, colsAcross, acrossSpacing, panelWidth, baseMountHeight } = cfg;
  const slopeRad = slopeAngle * Math.PI / 180;
  const fRad = facingAzimuth * Math.PI / 180;
  const fwdE = Math.sin(fRad), fwdN = Math.cos(fRad);

  // Materials — brown/gray for slope rack
  const postMat   = new THREE.MeshLambertMaterial({ color: 0x5577aa }); // 支柱: steel blue
  const chordMat  = new THREE.MeshLambertMaterial({ color: 0x8888aa }); // 弦材: grey-blue
  const vertMat   = new THREE.MeshLambertMaterial({ color: 0x44aa44 }); // 縦桟: green
  const horizMat  = new THREE.MeshLambertMaterial({ color: 0xaa8833 }); // 横桟: gold
  const braceMat  = new THREE.MeshLambertMaterial({ color: 0x888888 }); // 筋交い

  const postR   = rack.postDiameterMm / 1000 / 2;
  const postH   = rack.postHeightMm / 1000;
  const chordH  = rack.chordH / 1000;
  const chordW  = rack.chordW / 1000;
  const vRailH  = rack.vertRailH / 1000;
  const vRailW  = rack.vertRailW / 1000;
  const hRailH  = rack.horizRailH / 1000;
  const hRailW  = rack.horizRailW / 1000;

  // Slope surface mesh (earth-colored background)
  const slopeW   = (colsAcross - 1) * acrossSpacing + panelWidth + 2;
  const slopeLen = rowsDown * downSpacing + 2;
  const slopeMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(slopeW, slopeLen),
    new THREE.MeshLambertMaterial({ color: 0xb8956a, side: THREE.DoubleSide })
  );
  const midR = (rowsDown - 1) / 2 * downSpacing;
  slopeMesh.position.set(
    midR * Math.cos(slopeRad) * (-fwdE),
    baseMountHeight + midR * Math.sin(slopeRad),
    -(midR * Math.cos(slopeRad) * (-fwdN))
  );
  slopeMesh.rotation.order = 'YXZ';
  slopeMesh.rotation.y = -(facingAzimuth - 180) * Math.PI / 180;
  slopeMesh.rotation.x = -(Math.PI / 2 - slopeRad);
  scene.add(slopeMesh);

  // Helper: ENU position on slope at given col (across) and row (down) indices
  const slopePoint = (col: number, row: number, heightAboveSlope = 0) => {
    const acrossOffset = (col - (colsAcross - 1) / 2) * acrossSpacing;
    // Right direction on slope (perpendicular to facing, horizontal)
    const rightE = Math.cos(fRad), rightN = -Math.sin(fRad);
    // Down direction on slope surface
    const downSlopeFwdE = -fwdE, downSlopeFwdN = -fwdN;
    const downD = row * downSpacing;
    const px = acrossOffset * rightE + downD * Math.cos(slopeRad) * downSlopeFwdE;
    const py = acrossOffset * rightN + downD * Math.cos(slopeRad) * downSlopeFwdN;
    const pz = baseMountHeight + heightAboveSlope + downD * Math.sin(slopeRad);
    return enuToThree(px, py, pz);
  };

  // Normal direction to slope surface (pointing away from slope)
  const slopeNormalE = fwdE * Math.sin(slopeRad);
  const slopeNormalN = fwdN * Math.sin(slopeRad);
  const slopeNormalZ = Math.cos(slopeRad);

  // ===== 支柱 (Posts perpendicular to slope, at each grid point) =====
  for (let col = 0; col < colsAcross; col++) {
    for (let row = 0; row <= rowsDown; row++) {
      const base = slopePoint(col, row * (downSpacing / rowsDown) * rowsDown / (rowsDown + 1), 0);
      // Simplified: post at each column, every row
      if (row % 1 !== 0) continue;
      const rowR = row * downSpacing / Math.max(rowsDown, 1);
      const base2 = slopePoint(col, rowR < downSpacing * rowsDown ? rowR : downSpacing * (rowsDown - 1), 0);
      const top = new THREE.Vector3(
        base2.x + slopeNormalE * postH,
        base2.y + slopeNormalZ * postH,
        base2.z - slopeNormalN * postH
      );
      addCylinder(scene, base2, top, postR, postMat);
    }
  }

  // ===== 縦桟 (Vertical rails running down slope, panels mount on these) =====
  const vCount = colsAcross * rack.vertRailPerPanel;
  for (let i = 0; i < vCount; i++) {
    const colFrac = (i + 0.5) / vCount * colsAcross;
    const topPt   = slopePoint(colFrac - (colsAcross) / 2, 0, postH + vRailH / 2);
    const botPt   = slopePoint(colFrac - (colsAcross) / 2, (rowsDown - 1) * downSpacing, postH + vRailH / 2);
    // Draw as box (simplified, using cylinder for now)
    addCylinder(scene, topPt, botPt, vRailW / 2, vertMat);
  }

  // ===== 横桟 (Horizontal rails across slope, every few rows) =====
  for (let row = 0; row <= rowsDown; row++) {
    const y = row === rowsDown ? (rowsDown - 1) * downSpacing : row * downSpacing;
    const left  = slopePoint(0, y, postH + hRailH / 2);
    const right = slopePoint(colsAcross - 1, y, postH + hRailH / 2);
    addCylinder(scene, left, right, hRailW / 2, horizMat);
  }

  // ===== 弦材 (Top and bottom chord beams) =====
  for (let col = 0; col <= colsAcross; col++) {
    const acx = (col - (colsAcross) / 2) * acrossSpacing;
    const topPt = slopePoint(acx / acrossSpacing + (colsAcross - 1) / 2, 0, postH + chordH / 2);
    const botPt = slopePoint(acx / acrossSpacing + (colsAcross - 1) / 2, (rowsDown - 1) * downSpacing, postH + chordH / 2);
    addCylinder(scene, topPt, botPt, chordW / 2, chordMat);
  }

  // ===== 筋交い (X-brace on one side of each column bay) =====
  if (rack.hasBrace) {
    for (let col = 0; col < colsAcross - 1; col++) {
      const tl = slopePoint(col, 0, postH * 0.9);
      const br = slopePoint(col + 1, (rowsDown - 1) * downSpacing, 0.05);
      const bl = slopePoint(col, (rowsDown - 1) * downSpacing, 0.05);
      const tr = slopePoint(col + 1, 0, postH * 0.9);
      addCylinder(scene, tl, br, 0.015, braceMat);
      addCylinder(scene, bl, tr, 0.015, braceMat);
    }
  }
}

function addSingleAxisStructure(
  scene: THREE.Scene, cfg: SingleAxisConfig, rack: SingleAxisRackSpec, _panels: PanelPolygon[]
) {
  const { colsEW, rowsNS, ewSpacing, nsSpacing, mountHeight, rackRotation } = cfg;

  const rotRad = rackRotation * Math.PI / 180;
  const cosr = Math.cos(rotRad), sinr = Math.sin(rotRad);
  const rotENU = (ex: number, en: number): [number, number] => [
    ex * cosr + en * sinr, -ex * sinr + en * cosr,
  ];
  const pt = (ex: number, en: number, ez: number) => {
    const [rx, ry] = rotENU(ex, en);
    return enuToThree(rx, ry, ez);
  };

  const postMat   = new THREE.MeshLambertMaterial({ color: 0x2b7dc7 });
  const armMat    = new THREE.MeshLambertMaterial({ color: 0xcc44aa });
  const purlinMat = new THREE.MeshLambertMaterial({ color: 0x22aa33 });
  const braceMat  = new THREE.MeshLambertMaterial({ color: 0x8a6a20 });
  const plateMat  = new THREE.MeshLambertMaterial({ color: 0xee6622 });

  const postR    = rack.postDiameterMm / 1000 / 2;
  const armH     = rack.crossarmH / 1000;
  const purlinR  = rack.purlinW / 1000 / 2;
  const braceR   = rack.braceDiameterMm / 1000 / 2;
  const bp       = rack.basePlateWidthMm / 1000;
  const bpt      = rack.basePlateThicknessMm / 1000;

  const ewTotal = (colsEW - 1) * ewSpacing;
  const halfEW  = ewTotal / 2;
  const yGrid   = Array.from({ length: rowsNS }, (_, j) => (j - (rowsNS - 1) / 2) * nsSpacing);
  const purlinCount = Math.max(2, rack.purlinPerBay);
  const purlinXs    = Array.from({ length: purlinCount }, (_, i) =>
    -halfEW + i * ewTotal / (purlinCount - 1)
  );

  const plateGeo = new THREE.BoxGeometry(bp, bpt, bp);

  for (const gy of yGrid) {
    const base = pt(0, gy, 0);
    const top  = pt(0, gy, mountHeight - armH);
    addCylinder(scene, base, top, postR, postMat);

    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.position.set(base.x, bpt / 2, base.z);
    plate.rotation.y = -rotRad;
    scene.add(plate);

    // Crossarm
    addCylinder(scene, pt(-halfEW, gy, mountHeight - armH / 2), pt(+halfEW, gy, mountHeight - armH / 2), armH / 2, armMat);

    // Braces (X-shape)
    const braceZ = mountHeight * rack.braceH;
    const bs = pt(0, gy, braceZ);
    addCylinder(scene, bs, pt(-halfEW, gy, mountHeight - armH / 2), braceR, braceMat);
    addCylinder(scene, bs, pt(+halfEW, gy, mountHeight - armH / 2), braceR, braceMat);
  }

  // NS purlins at each EW position
  const yMin = yGrid[0], yMax = yGrid[yGrid.length - 1];
  for (const px of purlinXs) {
    addCylinder(scene, pt(px, yMin, mountHeight), pt(px, yMax, mountHeight), purlinR, purlinMat);
  }
}

// ===== 3D Viewer =====

function ThreeViewer({ installation }: { installation: FieldInstallation }) {
  const mountRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const w = el.clientWidth || 600, h = el.clientHeight || 400;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    el.appendChild(renderer.domElement);

    const { scene, camera, buildControls } = buildThreeScene(installation);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const controls = buildControls(renderer.domElement);

    let animId = 0;
    const animate = () => { animId = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); };
    animate();

    const ro = new ResizeObserver(() => {
      const nw = el.clientWidth, nh = el.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [installation]);

  return (
    <div className="three-mount" ref={mountRef}>
      <div className="three-hint">ドラッグ: 回転 ／ ホイール: ズーム ／ 右ドラッグ: 移動</div>
    </div>
  );
}

// ===== Custom lines SVG renderer =====

function CustomLinesRenderer({ lines, xGrid, yGrid, toSVG }: {
  lines: CustomDrawLine[];
  xGrid: number[]; yGrid: number[];
  toSVG: (x: number, y: number, z: number) => [number, number];
}) {
  const elements: React.ReactElement[] = [];
  for (const line of lines) {
    if (line.repeat && line.n1 !== undefined && line.n2 !== undefined) {
      const rDir = line.repeatDir ?? 'EW';
      const gridSVG = getRepeatGridSVG(rDir, xGrid, yGrid, toSVG);
      for (let i = 0; i < gridSVG.length - 1; i++) {
        const spanW = gridSVG[i + 1] - gridSVG[i];
        elements.push(
          <line key={`${line.id}-${i}`}
            x1={gridSVG[i] + line.n1 * spanW} y1={-(line.z1m ?? 0)}
            x2={gridSVG[i] + line.n2 * spanW} y2={-(line.z2m ?? 0)}
            stroke={line.color} strokeWidth={line.width} strokeLinecap="round" />
        );
      }
    } else if (line.x1 !== undefined) {
      elements.push(
        <line key={line.id}
          x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
          stroke={line.color} strokeWidth={line.width} strokeLinecap="round" />
      );
    }
  }
  return <>{elements}</>;
}

// ===== SVG Helpers =====

function SvgDefs() {
  return (
    <defs>
      <marker id="da" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto-start-reverse">
        <path d="M 0 0.5 L 3.5 2 L 0 3.5 Z" fill="#555" />
      </marker>
      <marker id="da-red" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto-start-reverse">
        <path d="M 0 0.5 L 3.5 2 L 0 3.5 Z" fill="#c53030" />
      </marker>
    </defs>
  );
}

function DimLine({
  x1, y1, x2, y2, offset, label, fs = 0.36, color = '#555',
}: {
  x1: number; y1: number; x2: number; y2: number;
  offset: number; label: string; fs?: number; color?: string;
}) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.01) return null;
  const nx = (-dy / len) * offset, ny = (dx / len) * offset;
  const p1x = x1 + nx, p1y = y1 + ny;
  const p2x = x2 + nx, p2y = y2 + ny;
  const mx = (p1x + p2x) / 2, my = (p1y + p2y) / 2;
  const ang = Math.atan2(p2y - p1y, p2x - p1x) * 180 / Math.PI;
  const la = ang > 90 || ang < -90 ? ang + 180 : ang;
  const mid = color === '#c53030' ? 'url(#da-red)' : 'url(#da)';
  return (
    <g stroke={color} fill="none" strokeWidth="0.035">
      <line x1={x1} y1={y1} x2={p1x} y2={p1y} strokeDasharray="0.1,0.1" />
      <line x1={x2} y1={y2} x2={p2x} y2={p2y} strokeDasharray="0.1,0.1" />
      <line x1={p1x} y1={p1y} x2={p2x} y2={p2y} strokeWidth="0.045"
        markerStart={mid} markerEnd={mid} />
      <text x={mx} y={my - 0.18} textAnchor="middle" fontSize={fs}
        fill={color} stroke="none"
        transform={`rotate(${la},${mx},${my - 0.18})`}>{label}</text>
    </g>
  );
}

function InnerDim({ x1, y1, x2, y2, label, offset = 0.25, fs = 0.3 }: {
  x1: number; y1: number; x2: number; y2: number;
  label: string; offset?: number; fs?: number;
}) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  const la = ang > 90 || ang < -90 ? ang + 180 : ang;
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#1e40af" strokeWidth="0.03"
        markerStart="url(#da)" markerEnd="url(#da)" />
      <rect x={mx - label.length * fs * 0.3} y={my - offset - fs * 0.7}
        width={label.length * fs * 0.6} height={fs * 1.1} fill="rgba(255,255,255,0.85)" rx="0.06" />
      <text x={mx} y={my - offset} textAnchor="middle" fontSize={fs} fill="#1d4ed8"
        fontWeight="600" stroke="none"
        transform={`rotate(${la},${mx},${my - offset})`}>{label}</text>
    </g>
  );
}

function NorthArrow({ cx, cy, r = 0.82, rotateDeg = 0 }: {
  cx: number; cy: number; r?: number; rotateDeg?: number;
}) {
  return (
    <g transform={`rotate(${rotateDeg},${cx},${cy})`}>
      <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.88)" stroke="#666" strokeWidth="0.04" />
      <path d={`M ${cx} ${cy - r * 0.75} L ${cx + r * 0.22} ${cy + r * 0.12} L ${cx} ${cy} Z`} fill="#c00" />
      <path d={`M ${cx} ${cy + r * 0.75} L ${cx - r * 0.22} ${cy - r * 0.12} L ${cx} ${cy} Z`}
        fill="#fff" stroke="#888" strokeWidth="0.03" />
      <text x={cx} y={cy - r * 0.82} textAnchor="middle" fontSize={r * 0.38}
        fill="#c00" fontWeight="bold">N</text>
    </g>
  );
}

function ScaleBar({ x, y, length = 5 }: { x: number; y: number; length?: number }) {
  return (
    <g stroke="#555" strokeWidth="0.06" fill="none">
      <rect x={x} y={y - 0.12} width={length} height={0.24} fill="#555" />
      <rect x={x + length / 2} y={y - 0.12} width={length / 2} height={0.24} fill="#fff" />
      <text x={x} y={y + 0.48} textAnchor="start" fontSize="0.32" fill="#555" stroke="none">0</text>
      <text x={x + length} y={y + 0.48} textAnchor="end" fontSize="0.32" fill="#555" stroke="none">{`${length}m`}</text>
    </g>
  );
}

// ===== Plan View =====

function PlanView({ installation }: { installation: FieldInstallation }) {
  const { config, installationType } = installation;
  const az = getAzimuth(installation);
  const panels = installationType === 'pergola'
    ? generatePanels(config as PanelConfig)
    : installationType === 'single_axis'
    ? generateSingleAxisPanels(config as SingleAxisConfig)
    : generateSlopePanels(config as SlopeConfig);

  const rot = (x: number, y: number) => rotatePlan(x, y, az);

  let rxMin = Infinity, rxMax = -Infinity, ryMin = Infinity, ryMax = -Infinity;
  for (const p of panels) {
    for (const c of p.corners) {
      const [rx, ry] = rot(c.x, c.y);
      rxMin = Math.min(rxMin, rx); rxMax = Math.max(rxMax, rx);
      ryMin = Math.min(ryMin, ry); ryMax = Math.max(ryMax, ry);
    }
  }

  const mg = 3.2;
  const vbX = rxMin - mg, vbY = -(ryMax + mg);
  const vbW = rxMax - rxMin + 2 * mg, vbH = ryMax - ryMin + 2 * mg;

  const sv = (rx: number, ry: number): [number, number] => [rx, -ry];
  const isSA2 = installationType === 'single_axis';
  const pFill = isSA2 ? 'rgba(22,163,74,0.62)' : installationType === 'pergola' ? 'rgba(29,78,216,0.62)' : 'rgba(213,94,10,0.62)';
  const pStroke = isSA2 ? '#15803d' : installationType === 'pergola' ? '#1e40af' : '#b45309';

  const center = (p: PanelPolygon) => {
    const [rx, ry] = rot(
      p.corners.reduce((s, c) => s + c.x, 0) / 4,
      p.corners.reduce((s, c) => s + c.y, 0) / 4,
    );
    return sv(rx, ry);
  };

  const colsCount = (installationType === 'pergola' || isSA2)
    ? (config as PanelConfig | SingleAxisConfig).colsEW
    : (config as SlopeConfig).colsAcross;
  const rowsCount = (installationType === 'pergola' || isSA2)
    ? (config as PanelConfig | SingleAxisConfig).rowsNS
    : (config as SlopeConfig).rowsDown;
  const totalPanels = colsCount * rowsCount;
  const area = totalPanels * config.panelWidth * config.panelDepth;

  const ewSpacing = (installationType === 'pergola' || isSA2)
    ? (config as PanelConfig | SingleAxisConfig).ewSpacing
    : (config as SlopeConfig).acrossSpacing;
  const nsSpacing = (installationType === 'pergola' || isSA2)
    ? (config as PanelConfig | SingleAxisConfig).nsSpacing
    : (config as SlopeConfig).downSpacing;

  const c0 = colsCount > 1 ? center(panels[0]) : null;
  const c1 = colsCount > 1 ? center(panels[1]) : null;
  const r0 = rowsCount > 1 ? center(panels[0]) : null;
  const r1 = rowsCount > 1 ? center(panels[colsCount]) : null;

  const fc = panels[0].corners.map(c => { const [rx, ry] = rot(c.x, c.y); return sv(rx, ry); });
  const panelWidthLabel = `W=${config.panelWidth.toFixed(2)}m`;
  const depthLabel = `D=${config.panelDepth.toFixed(2)}m`;
  const northArrowRot = 180 - az;

  return (
    <div className="svg-drawing-wrap">
      <div className="drawing-info-bar">
        <span className="dv-label">平面図</span>
        <span>方位: {az}° ({azLabel(az)}) ／ {totalPanels}枚 ／ {area.toFixed(1)} m²
          {isSA2 ? ' ／ 1軸型' : ''}</span>
        <span className="dv-note">※ パネル向き({azLabel(az)})を下方向に表示</span>
      </div>
      <svg viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`} className="drawing-svg" preserveAspectRatio="xMidYMid meet">
        <SvgDefs />
        {Array.from({ length: Math.ceil(vbW) + 2 }, (_, i) => Math.floor(vbX) + i).map(gx => (
          <line key={`gx${gx}`} x1={gx} y1={vbY} x2={gx} y2={vbY + vbH} stroke="#e8e8e8" strokeWidth="0.02" />
        ))}
        {Array.from({ length: Math.ceil(vbH) + 2 }, (_, i) => Math.floor(vbY) + i).map(gy => (
          <line key={`gy${gy}`} x1={vbX} y1={gy} x2={vbX + vbW} y2={gy} stroke="#e8e8e8" strokeWidth="0.02" />
        ))}
        {installationType === 'pergola' && (
          <rect x={rxMin} y={-ryMax} width={rxMax - rxMin} height={ryMax - ryMin}
            fill="none" stroke="#c4a882" strokeWidth="0.06" strokeDasharray="0.2,0.15" />
        )}
        {panels.map(panel => {
          const pts = panel.corners.map(c => {
            const [rx, ry] = rot(c.x, c.y);
            return `${rx},${-ry}`;
          }).join(' ');
          return (
            <polygon key={panel.panelIndex} points={pts}
              fill={pFill} stroke={pStroke} strokeWidth="0.04" />
          );
        })}
        <InnerDim x1={fc[0][0]} y1={fc[0][1]} x2={fc[1][0]} y2={fc[1][1]}
          label={panelWidthLabel} offset={0.2} fs={0.3} />
        <InnerDim x1={fc[1][0]} y1={fc[1][1]} x2={fc[2][0]} y2={fc[2][1]}
          label={depthLabel} offset={0.2} fs={0.3} />
        {c0 && c1 && (
          <DimLine x1={c0[0]} y1={c0[1]} x2={c1[0]} y2={c1[1]}
            offset={-(ryMax - ryMin) / 2 - 1.6}
            label={`@${ewSpacing}m`} color="#2563eb" />
        )}
        {r0 && r1 && (
          <DimLine x1={rxMax + mg * 0.55} y1={r0[1]} x2={rxMax + mg * 0.55} y2={r1[1]}
            offset={(rxMax - rxMin) / 2 + 1.6}
            label={installationType === 'pergola' ? `@${nsSpacing}m` : `@${nsSpacing}m(斜)`}
            color="#2563eb" />
        )}
        <DimLine x1={rxMin} y1={-(ryMin)} x2={rxMax} y2={-(ryMin)}
          offset={-1.8} label={`${(rxMax - rxMin).toFixed(2)} m`} />
        <DimLine x1={rxMax} y1={-(ryMin)} x2={rxMax} y2={-(ryMax)}
          offset={1.8} label={`${(ryMax - ryMin).toFixed(2)} m`} />
        <g opacity="0.6">
          <line x1={0} y1={-(ryMax) + 0.4} x2={0} y2={-(ryMax) + 1.6}
            stroke="#d97706" strokeWidth="0.12" markerEnd="url(#da)" />
          <text x={0} y={-(ryMax) + 2.2} textAnchor="middle" fontSize="0.32" fill="#d97706">↓ {azLabel(az)}</text>
        </g>
        <NorthArrow cx={vbX + vbW - 1.2} cy={vbY + 1.2} r={0.88} rotateDeg={northArrowRot} />
        <ScaleBar x={vbX + 0.5} y={vbY + vbH - 0.8} length={5} />
      </svg>
    </div>
  );
}

// ===== Pergola Rack SVG (shared between elevation and section) =====

function PergolaRackSVG({ cfg, rack, toSVG }: {
  cfg: PanelConfig;
  rack: PergolaRackSpec;
  toSVG: (x: number, y: number, z: number) => [number, number];
}) {
  const { colsEW, rowsNS, ewSpacing, nsSpacing, mountHeight, rackRotation } = cfg;
  const rotRad = rackRotation * Math.PI / 180;
  const cosr = Math.cos(rotRad), sinr = Math.sin(rotRad);
  const sv = (ex: number, en: number, ez: number): [number, number] => {
    return toSVG(ex * cosr + en * sinr, -ex * sinr + en * cosr, ez);
  };

  const ysH = rack.yokosanH / 1000;

  // 架台グリッド
  const ewTotal  = colsEW * ewSpacing;
  const xGrid    = computeXGrid(cfg, rack);
  const yGrid    = computeYGrid(cfg, rack);  // パネルNS端部に自動配置
  const yRowsNS  = yGrid.length;

  const tCount = Math.max(1, colsEW * rack.tatesanPerSpan);

  const els: React.ReactElement[] = [];
  let k = 0;

  // パネルはヨコサンの上に直接設置
  const postTopZ_s = mountHeight - ysH;                               // 支柱頂部 = ヨコサン底面
  const yokosanZ_s = mountHeight - ysH / 2;                           // ヨコサン中心（上面 = mountHeight）
  const tatesanZ_s = postTopZ_s * (rack.tatesanZRatio ?? 0.5);        // タテサン（NS補強材）
  const attachY    = rack.braceAttachY ?? 0.65;
  const reachX     = rack.braceReachX  ?? 1.0;
  for (const gx of xGrid) {
    for (let j = 0; j < yRowsNS; j++) {
      const gy = yGrid[j];
      const [x0, y0]   = sv(gx, gy, 0);
      const [ptx, pty] = sv(gx, gy, postTopZ_s);
      els.push(<line key={k++} x1={x0} y1={y0} x2={ptx} y2={pty} stroke="#2b7dc7" strokeWidth="0.10" />);
      const [bsx, bsy] = sv(gx, gy, postTopZ_s * attachY);
      if (j > 0) {
        const nsReach = (yGrid[j] - yGrid[j - 1]) * reachX;
        const [fx, fy] = sv(gx, gy - nsReach, yokosanZ_s);
        els.push(<line key={k++} x1={bsx} y1={bsy} x2={fx} y2={fy} stroke="#8a6a20" strokeWidth="0.08" />);
      }
      if (j < yRowsNS - 1) {
        const nsReach = (yGrid[j + 1] - yGrid[j]) * reachX;
        const [bx, by] = sv(gx, gy + nsReach, yokosanZ_s);
        els.push(<line key={k++} x1={bsx} y1={bsy} x2={bx} y2={by} stroke="#8a6a20" strokeWidth="0.08" />);
      }
    }
  }
  // ヨコサン（支柱頂部・パネル直下、EW方向）
  for (const gy of yGrid) {
    const [x0, y0] = sv(xGrid[0], gy, yokosanZ_s);
    const [x1, y1] = sv(xGrid[xGrid.length - 1], gy, yokosanZ_s);
    els.push(<line key={k++} x1={x0} y1={y0} x2={x1} y2={y1} stroke="#cc44aa" strokeWidth="0.10" />);
  }
  // タテサン（支柱中間部・NS方向補強材）
  for (let i = 0; i < tCount; i++) {
    const gx = xGrid[0] + (i + 0.5) / tCount * ewTotal;
    const [x0, y0] = sv(gx, yGrid[0], tatesanZ_s);
    const [x1, y1] = sv(gx, yGrid[yGrid.length - 1], tatesanZ_s);
    els.push(<line key={k++} x1={x0} y1={y0} x2={x1} y2={y1} stroke="#22aa33" strokeWidth="0.07" />);
  }
  return <>{els}</>;
}

// Rack bbox helper (for expanding viewbox to include structural members)
function pergolaRackBBox(
  cfg: PanelConfig, rack: PergolaRackSpec,
  toSVG: (x: number, y: number, z: number) => [number, number]
): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const { mountHeight, rackRotation } = cfg;
  const rotRad = rackRotation * Math.PI / 180;
  const cosr = Math.cos(rotRad), sinr = Math.sin(rotRad);
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  const ysH  = rack.yokosanH / 1000;
  const xGrid = computeXGrid(cfg, rack);
  const yGrid = computeYGrid(cfg, rack);
  for (const ex of xGrid) {
    for (const en of yGrid) {
      const rx = ex * cosr + en * sinr, ry = -ex * sinr + en * cosr;
      for (const ez of [0, mountHeight, mountHeight - ysH]) {
        const [sx, sy] = toSVG(rx, ry, ez);
        xMin = Math.min(xMin, sx); xMax = Math.max(xMax, sx);
        yMin = Math.min(yMin, sy); yMax = Math.max(yMax, sy);
      }
    }
  }
  return { xMin, xMax, yMin, yMax };
}

// ===== Single Axis Rack SVG =====

function SingleAxisRackSVG({ cfg, rack, toSVG }: {
  cfg: SingleAxisConfig;
  rack: SingleAxisRackSpec;
  toSVG: (x: number, y: number, z: number) => [number, number];
}) {
  const { colsEW, rowsNS, ewSpacing, nsSpacing, mountHeight, rackRotation } = cfg;
  const rotRad = rackRotation * Math.PI / 180;
  const cosr = Math.cos(rotRad), sinr = Math.sin(rotRad);
  const sv = (ex: number, en: number, ez: number): [number, number] =>
    toSVG(ex * cosr + en * sinr, -ex * sinr + en * cosr, ez);

  const armH     = rack.crossarmH / 1000;
  const ewTotal  = (colsEW - 1) * ewSpacing;
  const halfEW   = ewTotal / 2;
  const braceZ   = mountHeight * rack.braceH;
  const yGrid    = Array.from({ length: rowsNS }, (_, j) => (j - (rowsNS - 1) / 2) * nsSpacing);
  const purlinCount = Math.max(2, rack.purlinPerBay);
  const purlinXs = Array.from({ length: purlinCount }, (_, i) =>
    -halfEW + i * ewTotal / (purlinCount - 1)
  );

  const els: React.ReactElement[] = [];
  let k = 0;

  for (const gy of yGrid) {
    const [cx0, cy0] = sv(0, gy, 0);
    const [ctx, cty] = sv(0, gy, mountHeight - armH);
    els.push(<line key={k++} x1={cx0} y1={cy0} x2={ctx} y2={cty} stroke="#2b7dc7" strokeWidth="0.10" />);

    const [ax0, ay0] = sv(-halfEW, gy, mountHeight - armH / 2);
    const [ax1, ay1] = sv(+halfEW, gy, mountHeight - armH / 2);
    els.push(<line key={k++} x1={ax0} y1={ay0} x2={ax1} y2={ay1} stroke="#cc44aa" strokeWidth="0.10" />);

    const [bsx, bsy] = sv(0, gy, braceZ);
    els.push(<line key={k++} x1={bsx} y1={bsy} x2={ax0} y2={ay0} stroke="#8a6a20" strokeWidth="0.08" />);
    els.push(<line key={k++} x1={bsx} y1={bsy} x2={ax1} y2={ay1} stroke="#8a6a20" strokeWidth="0.08" />);
  }

  const yMin = yGrid[0], yMax = yGrid[yGrid.length - 1];
  for (const px of purlinXs) {
    const [p1x, p1y] = sv(px, yMin, mountHeight);
    const [p2x, p2y] = sv(px, yMax, mountHeight);
    els.push(<line key={k++} x1={p1x} y1={p1y} x2={p2x} y2={p2y} stroke="#22aa33" strokeWidth="0.07" />);
  }

  return <>{els}</>;
}

function singleAxisRackBBox(
  cfg: SingleAxisConfig, rack: SingleAxisRackSpec,
  toSVG: (x: number, y: number, z: number) => [number, number]
): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const { colsEW, rowsNS, ewSpacing, nsSpacing, mountHeight, rackRotation } = cfg;
  const rotRad = rackRotation * Math.PI / 180;
  const cosr = Math.cos(rotRad), sinr = Math.sin(rotRad);
  const ewTotal = (colsEW - 1) * ewSpacing;
  const halfEW  = ewTotal / 2;
  const yGrid   = Array.from({ length: rowsNS }, (_, j) => (j - (rowsNS - 1) / 2) * nsSpacing);

  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const en of yGrid) {
    for (const ex of [-halfEW, 0, +halfEW]) {
      const rx = ex * cosr + en * sinr, ry = -ex * sinr + en * cosr;
      for (const ez of [0, mountHeight * rack.braceH, mountHeight]) {
        const [sx, sy] = toSVG(rx, ry, ez);
        xMin = Math.min(xMin, sx); xMax = Math.max(xMax, sx);
        yMin = Math.min(yMin, sy); yMax = Math.max(yMax, sy);
      }
    }
  }
  return { xMin, xMax, yMin, yMax };
}

// ===== Elevation View =====

type ElevDir = 'front' | 'back' | 'right' | 'left';
const ELEV_DIRS: { key: ElevDir; label: string }[] = [
  { key: 'front', label: '正面' },
  { key: 'back',  label: '背面' },
  { key: 'right', label: '右側面' },
  { key: 'left',  label: '左側面' },
];

// ===== Quick Settings Popup (立面図クリック時) =====

function QuickSettings({
  installation, x, y, onClose, onChange,
}: {
  installation: FieldInstallation;
  x: number; y: number;
  onClose: () => void;
  onChange: (patch: Partial<FieldInstallation>) => void;
}) {
  const cfg = installation.config as PanelConfig;
  const rack = getEffectiveRack(installation) as PergolaRackSpec;
  const upd = (patch: Partial<PanelConfig>) =>
    onChange({ config: { ...cfg, ...patch } as AnyConfig });
  const updR = (patch: Partial<PergolaRackSpec>) =>
    onChange({ rackSpec: { ...rack, ...patch } });

  const left = Math.min(x + 12, window.innerWidth - 260);
  const top  = Math.min(y - 10, window.innerHeight - 400);

  return (
    <div className="qs-panel" style={{ left, top }} onMouseDown={e => e.stopPropagation()}>
      <div className="qs-header">
        <span>⚡ クイック設定</span>
        <button className="qs-close" onClick={onClose}>✕</button>
      </div>
      <div className="qs-body">
        <div className="qs-section">パネル高さ・角度</div>
        <DVNumInput label="設置高さ Z" value={cfg.mountHeight} onChange={v => upd({ mountHeight: v })} unit="m" min={0.5} max={15} step={0.1} />
        <DVNumInput label="傾斜角" value={cfg.tiltAngle} onChange={v => upd({ tiltAngle: v })} unit="°" min={0} max={60} step={1} />
        <DVNumInput label="方位角" value={cfg.facingAzimuth} onChange={v => upd({ facingAzimuth: v })} unit="°" min={0} max={360} step={1} />
        <div className="qs-section">パネル配置 XY</div>
        <DVNumInput label="EW間隔 X" value={cfg.ewSpacing} onChange={v => upd({ ewSpacing: v })} unit="m" min={0.5} max={10} step={0.05} />
        <DVNumInput label="NS間隔 Y" value={cfg.nsSpacing} onChange={v => upd({ nsSpacing: v })} unit="m" min={0.5} max={15} step={0.05} />
        <DVNumInput label="EW列数" value={cfg.colsEW} onChange={v => upd({ colsEW: Math.max(1, Math.round(v)) })} unit="列" min={1} max={30} step={1} />
        <DVNumInput label="NS行数" value={cfg.rowsNS} onChange={v => upd({ rowsNS: Math.max(1, Math.round(v)) })} unit="行" min={1} max={30} step={1} />
        <div className="qs-section">架台レイアウト</div>
        <DVNumInput label="EW支柱列数" value={rack.postColsEW ?? (cfg.colsEW + 1)} onChange={v => updR({ postColsEW: Math.max(2, Math.round(v)) })} unit="列" min={2} max={20} step={1} />
        <DVNumInput label="NS梁本数" value={rack.yokosanRowsNS ?? (cfg.rowsNS + 1)} onChange={v => updR({ yokosanRowsNS: Math.max(2, Math.round(v)) })} unit="本" min={2} max={30} step={1} />
        <div className="qs-section">架台（斜材）</div>
        <DVNumInput label="斜材Y（高さ）" value={rack.braceAttachY ?? 0.65} onChange={v => updR({ braceAttachY: Math.min(1, Math.max(0, v)) })} unit="" min={0} max={1} step={0.05} />
        <DVNumInput label="斜材X（NS比）" value={rack.braceReachX ?? 1.0} onChange={v => updR({ braceReachX: Math.min(1, Math.max(0, v)) })} unit="" min={0} max={1} step={0.05} />
        <div className="qs-calc">
          高さ <strong>{cfg.mountHeight.toFixed(2)} m</strong>
          傾斜 <strong>{cfg.tiltAngle}°</strong>
          {cfg.colsEW}×{cfg.rowsNS}枚 ／ 梁{rack.yokosanRowsNS ?? (cfg.rowsNS + 1)}本
        </div>
      </div>
    </div>
  );
}

// ===== Elevation View =====

function ElevationView({
  installation, onChange,
}: {
  installation: FieldInstallation;
  onChange?: (patch: Partial<FieldInstallation>) => void;
}) {
  const [dir, setDir] = useState<ElevDir>('front');
  const [qsPos, setQsPos] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ startY: number; startMH: number } | null>(null);

  // Draw mode state
  const [drawMode, setDrawMode] = useState(false);
  const [drawStart, setDrawStart] = useState<[number, number] | null>(null);
  const [drawPreview, setDrawPreview] = useState<[number, number] | null>(null);
  const [drawColor, setDrawColor] = useState<string>(DRAW_COLORS[0]);
  const [drawWidth, setDrawWidth] = useState(0.10);
  const [repeatAll, setRepeatAll] = useState(false);

  const { config, installationType } = installation;
  const az = getAzimuth(installation);
  const fwdE = Math.sin(az * Math.PI / 180);
  const fwdN = Math.cos(az * Math.PI / 180);

  const toSVG = (x: number, y: number, z: number): [number, number] => {
    switch (dir) {
      case 'front': return [-fwdN * x + fwdE * y, -z];
      case 'back':  return [ fwdN * x - fwdE * y, -z];
      case 'right': return [-fwdE * x - fwdN * y, -z];
      case 'left':  return [ fwdE * x + fwdN * y, -z];
    }
  };

  const isSAElev = installationType === 'single_axis';
  const panels = installationType === 'pergola'
    ? generatePanels(config as PanelConfig)
    : isSAElev
    ? generateSingleAxisPanels(config as SingleAxisConfig)
    : generateSlopePanels(config as SlopeConfig);

  let svgXMin = Infinity, svgXMax = -Infinity, svgYMin = Infinity, svgYMax = -Infinity;
  for (const p of panels) {
    for (const c of p.corners) {
      const [sx, sy] = toSVG(c.x, c.y, c.z);
      svgXMin = Math.min(svgXMin, sx); svgXMax = Math.max(svgXMax, sx);
      svgYMin = Math.min(svgYMin, sy); svgYMax = Math.max(svgYMax, sy);
    }
  }
  if (installationType === 'pergola') {
    const rb = pergolaRackBBox(config as PanelConfig, getEffectiveRack(installation) as PergolaRackSpec, toSVG);
    svgXMin = Math.min(svgXMin, rb.xMin); svgXMax = Math.max(svgXMax, rb.xMax);
    svgYMin = Math.min(svgYMin, rb.yMin); svgYMax = Math.max(svgYMax, rb.yMax);
  }
  if (isSAElev) {
    const rb = singleAxisRackBBox(config as SingleAxisConfig, getEffectiveRack(installation) as SingleAxisRackSpec, toSVG);
    svgXMin = Math.min(svgXMin, rb.xMin); svgXMax = Math.max(svgXMax, rb.xMax);
    svgYMin = Math.min(svgYMin, rb.yMin); svgYMax = Math.max(svgYMax, rb.yMax);
  }
  svgYMax = Math.max(svgYMax, 0);

  const mg = 2.5;
  const vbX = svgXMin - mg, vbY = svgYMin - mg;
  const vbW = svgXMax - svgXMin + 2 * mg, vbH = svgYMax - svgYMin + 2 * mg;
  const mountH = (installationType === 'pergola' || isSAElev)
    ? (config as PanelConfig | SingleAxisConfig).mountHeight
    : (config as SlopeConfig).baseMountHeight;
  const pFill    = isSAElev ? 'rgba(22,163,74,0.55)' : installationType === 'pergola' ? 'rgba(29,78,216,0.55)' : 'rgba(213,94,10,0.55)';
  const pStroke  = isSAElev ? '#15803d' : installationType === 'pergola' ? '#1e40af' : '#b45309';
  const canDrag  = installationType === 'pergola' && !!onChange;
  const canDraw  = installationType === 'pergola' && !!onChange;

  // カスタム描画線（現在ビュー分）
  const rackForDraw = installationType === 'pergola'
    ? (getEffectiveRack(installation) as PergolaRackSpec) : null;
  const currentViewLines: CustomDrawLine[] = rackForDraw?.customLines?.[dir] ?? [];

  // dir または installation が変わったら描画状態リセット
  useEffect(() => {
    setDrawStart(null);
    setDrawPreview(null);
  }, [dir, installation.id]);

  // SVG座標変換（getScreenCTM使用）
  const getSVGPos = (e: React.MouseEvent): [number, number] | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const sp = pt.matrixTransform(ctm.inverse());
    return [sp.x, sp.y];
  };

  // SVG pixel → SVG unit 変換スケール（ドラッグ用）
  const getSVGScaleY = (): number => {
    const el = svgRef.current;
    if (!el) return 1;
    const rect = el.getBoundingClientRect();
    return rect.height > 0 ? vbH / rect.height : 1;
  };

  const handlePanelMouseDown = (e: React.MouseEvent) => {
    if (!canDrag || drawMode) return;
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startMH: (config as PanelConfig).mountHeight };
    setQsPos({ x: e.clientX, y: e.clientY });
  };

  const handleSVGMouseMove = (e: React.MouseEvent) => {
    if (drawMode && drawStart) {
      setDrawPreview(getSVGPos(e));
      return;
    }
    if (!dragRef.current || !onChange) return;
    const dy    = e.clientY - dragRef.current.startY;
    const scale = getSVGScaleY();
    const dMH   = -dy * scale;  // SVG Y は -z なので符号反転
    const newMH = Math.max(0.5, Math.min(15, dragRef.current.startMH + dMH));
    onChange({ config: { ...(config as PanelConfig), mountHeight: Math.round(newMH * 100) / 100 } as AnyConfig });
  };

  const handleSVGMouseUp = () => {
    dragRef.current = null;
  };

  // ---- 描画ハンドラー ----
  const handleSVGClick = (e: React.MouseEvent) => {
    if (!drawMode || !onChange || dragRef.current) return;
    const pos = getSVGPos(e);
    if (!pos) return;
    if (!drawStart) {
      setDrawStart(pos);
    } else {
      const rack = getEffectiveRack(installation) as PergolaRackSpec;
      const existing = rack.customLines?.[dir] ?? [];
      let newLine: CustomDrawLine;

      if (repeatAll && installationType === 'pergola') {
        const cfg = config as PanelConfig;
        const xGrid = computeXGrid(cfg, rack);
        const yGrid = computeYGrid(cfg, rack);
        const rDir = getRepeatDir(toSVG);
        const gridSVG = getRepeatGridSVG(rDir, xGrid, yGrid, toSVG);
        const midX = (drawStart[0] + pos[0]) / 2;
        const si = findNearestSpanIdx(midX, gridSVG);
        const spanW = (gridSVG[si + 1] ?? gridSVG[si]) - gridSVG[si];
        if (Math.abs(spanW) > 0.001) {
          newLine = {
            id: Date.now().toString(), color: drawColor, width: drawWidth,
            repeat: true, repeatDir: rDir,
            n1: (drawStart[0] - gridSVG[si]) / spanW,
            z1m: -drawStart[1],
            n2: (pos[0] - gridSVG[si]) / spanW,
            z2m: -pos[1],
          };
        } else {
          newLine = { id: Date.now().toString(), color: drawColor, width: drawWidth, x1: drawStart[0], y1: drawStart[1], x2: pos[0], y2: pos[1] };
        }
      } else {
        newLine = { id: Date.now().toString(), color: drawColor, width: drawWidth, x1: drawStart[0], y1: drawStart[1], x2: pos[0], y2: pos[1] };
      }

      onChange({ rackSpec: { ...rack, customLines: { ...(rack.customLines ?? {}), [dir]: [...existing, newLine] } } });
      setDrawStart(null);
      setDrawPreview(null);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (drawMode && drawStart) {
      e.preventDefault();
      setDrawStart(null);
      setDrawPreview(null);
    }
  };

  const handleUndoLast = () => {
    if (!onChange || !rackForDraw) return;
    const lines = rackForDraw.customLines?.[dir] ?? [];
    if (lines.length === 0) return;
    onChange({ rackSpec: { ...rackForDraw, customLines: { ...(rackForDraw.customLines ?? {}), [dir]: lines.slice(0, -1) } } });
  };

  const handleClearLines = () => {
    if (!onChange || !rackForDraw) return;
    onChange({ rackSpec: { ...rackForDraw, customLines: { ...(rackForDraw.customLines ?? {}), [dir]: [] } } });
  };

  const dirTitles: Record<ElevDir, string> = {
    front: `正面図（${azLabel(az)}向き）`,
    back:  `背面図`,
    right: `右側面図`,
    left:  `左側面図`,
  };

  return (
    <div className="svg-drawing-wrap" style={{ position: 'relative' }}>
      <div className="drawing-info-bar">
        <span className="dv-label">{dirTitles[dir]}</span>
        <span>設置高さ <strong>{mountH.toFixed(2)} m</strong></span>
        {canDrag && !drawMode && <span className="dv-note">パネルをドラッグ→高さ変更　クリック→設定パネル</span>}
        {drawMode && (
          <span className="dv-note" style={{ color: '#e07010' }}>
            {drawStart ? 'クリックで終点を指定（右クリック:キャンセル）' : 'クリックで始点を指定'}
          </span>
        )}
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', alignItems: 'center' }}>
          {ELEV_DIRS.map(d => (
            <button key={d.key} className={`dv-dir-btn${dir === d.key ? ' active' : ''}`}
              onClick={() => setDir(d.key)}>{d.label}</button>
          ))}
          {canDraw && (
            <button
              className={`dv-dir-btn${drawMode ? ' active' : ''}`}
              style={{ marginLeft: 6 }}
              onClick={() => { setDrawMode(m => !m); setDrawStart(null); setDrawPreview(null); }}
            >{drawMode ? '✓ 描画終了' : '✏ 線を描く'}</button>
          )}
          {drawMode && (
            <>
              <label style={{ fontSize: 10.5, display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={repeatAll} onChange={e => setRepeatAll(e.target.checked)} style={{ cursor: 'pointer' }} />
                全スパン
              </label>
              {DRAW_COLORS.map(c => (
                <div key={c} onClick={() => setDrawColor(c)}
                  style={{ width: 17, height: 17, background: c, border: drawColor === c ? '2.5px solid #fff' : '1px solid #aaa', borderRadius: 3, cursor: 'pointer', flexShrink: 0, outline: drawColor === c ? '1.5px solid #555' : 'none' }} />
              ))}
              <select style={{ fontSize: 10.5, padding: '2px 3px', border: '1px solid #ccc', borderRadius: 3 }}
                value={drawWidth} onChange={e => setDrawWidth(+e.target.value)}>
                <option value={0.05}>細</option>
                <option value={0.10}>中</option>
                <option value={0.16}>太</option>
              </select>
              {currentViewLines.length > 0 && <>
                <button className="dv-dir-btn" title="最後の線を取消" onClick={handleUndoLast}>↩</button>
                <button className="dv-dir-btn" title="このビューの線を全削除" onClick={handleClearLines}>🗑</button>
              </>}
            </>
          )}
        </div>
      </div>
      <svg ref={svgRef}
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        className="drawing-svg"
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={handleSVGMouseMove}
        onMouseUp={handleSVGMouseUp}
        onMouseLeave={() => { handleSVGMouseUp(); setDrawPreview(null); }}
        onClick={drawMode ? handleSVGClick : undefined}
        onContextMenu={handleContextMenu}
        style={{ cursor: drawMode ? 'crosshair' : (dragRef.current ? 'ns-resize' : 'default') }}
      >
        <SvgDefs />
        <rect x={vbX} y={0} width={vbW} height={mg} fill="rgba(104,148,106,0.2)" />
        <line x1={vbX} y1={0} x2={vbX + vbW} y2={0} stroke="#68946a" strokeWidth="0.08" />
        {installationType === 'pergola' && (
          <PergolaRackSVG
            cfg={config as PanelConfig}
            rack={getEffectiveRack(installation) as PergolaRackSpec}
            toSVG={toSVG}
          />
        )}
        {isSAElev && (
          <SingleAxisRackSVG
            cfg={config as SingleAxisConfig}
            rack={getEffectiveRack(installation) as SingleAxisRackSpec}
            toSVG={toSVG}
          />
        )}
        {(installationType === 'pergola' || isSAElev) && (
          <DimLine x1={svgXMin} y1={0} x2={svgXMin} y2={-mountH} offset={-1.4}
            label={`${mountH.toFixed(2)} m`} color="#c53030" />
        )}
        {installationType === 'slope' && mountH > 0 && (
          <DimLine x1={svgXMin} y1={0} x2={svgXMin} y2={-mountH} offset={-1.4}
            label={`基礎 ${mountH.toFixed(2)} m`} color="#c53030" />
        )}
        {panels.map(panel => (
          <polygon
            key={panel.panelIndex}
            points={panel.corners.map(c => { const [sx, sy] = toSVG(c.x, c.y, c.z); return `${sx},${sy}`; }).join(' ')}
            fill={pFill} stroke={pStroke} strokeWidth="0.045"
            style={{ cursor: canDrag && !drawMode ? 'ns-resize' : 'default' }}
            onMouseDown={handlePanelMouseDown}
          />
        ))}
        <DimLine x1={svgXMin} y1={svgYMin - 0.3} x2={svgXMax} y2={svgYMin - 0.3}
          offset={-1.3} label={`${(svgXMax - svgXMin).toFixed(2)} m`} />
        <DimLine x1={svgXMax} y1={0} x2={svgXMax} y2={svgYMin}
          offset={1.3} label={`${(-svgYMin).toFixed(2)} m`} />
        {(installationType === 'pergola' || isSAElev) && (
          <text x={svgXMin + 0.2} y={svgYMin + 0.6} fontSize="0.38" fill="#e07010">
            {(config as PanelConfig | SingleAxisConfig).tiltAngle}° 傾斜
          </text>
        )}
        {/* カスタム描画線 */}
        {rackForDraw && (
          <CustomLinesRenderer
            lines={currentViewLines}
            xGrid={computeXGrid(config as PanelConfig, rackForDraw)}
            yGrid={computeYGrid(config as PanelConfig, rackForDraw)}
            toSVG={toSVG}
          />
        )}
        {/* 描画プレビュー */}
        {drawMode && drawStart && drawPreview && (
          <line x1={drawStart[0]} y1={drawStart[1]} x2={drawPreview[0]} y2={drawPreview[1]}
            stroke={drawColor} strokeWidth={drawWidth} strokeLinecap="round"
            strokeDasharray="0.18,0.09" opacity={0.75} />
        )}
        {drawMode && drawStart && (
          <circle cx={drawStart[0]} cy={drawStart[1]} r={0.14} fill={drawColor} opacity={0.85} />
        )}
      </svg>
      {qsPos && onChange && installationType === 'pergola' && !drawMode && (
        <QuickSettings
          installation={installation}
          x={qsPos.x} y={qsPos.y}
          onClose={() => setQsPos(null)}
          onChange={onChange}
        />
      )}
    </div>
  );
}

// ===== Section View =====

function SectionView({ installation, onChange }: {
  installation: FieldInstallation;
  onChange?: (patch: Partial<FieldInstallation>) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [drawStart, setDrawStart] = useState<[number, number] | null>(null);
  const [drawPreview, setDrawPreview] = useState<[number, number] | null>(null);
  const [drawColor, setDrawColor] = useState<string>(DRAW_COLORS[0]);
  const [drawWidth, setDrawWidth] = useState(0.10);
  const [repeatAll, setRepeatAll] = useState(false);

  const { config, installationType } = installation;
  const az = getAzimuth(installation);
  const fwdE = Math.sin(az * Math.PI / 180);
  const fwdN = Math.cos(az * Math.PI / 180);
  const isSASec = installationType === 'single_axis';

  const panels = installationType === 'pergola'
    ? generatePanels(config as PanelConfig)
    : isSASec
    ? generateSingleAxisPanels(config as SingleAxisConfig)
    : generateSlopePanels(config as SlopeConfig);

  const colsCount = (installationType === 'pergola' || isSASec)
    ? (config as PanelConfig | SingleAxisConfig).colsEW
    : (config as SlopeConfig).colsAcross;
  const centerColIdx = Math.floor(colsCount / 2);
  const sectionPanels = panels.filter((_, i) => i % colsCount === centerColIdx);

  const mountH = (installationType === 'pergola' || isSASec)
    ? (config as PanelConfig | SingleAxisConfig).mountHeight
    : (config as SlopeConfig).baseMountHeight;
  const slopeAngle = installationType === 'slope' ? (config as SlopeConfig).slopeAngle : 0;
  const effTilt = (installationType === 'pergola' || isSASec)
    ? (config as PanelConfig | SingleAxisConfig).tiltAngle
    : slopeAngle + (config as SlopeConfig).additionalTilt;
  const nsSpacing = (installationType === 'pergola' || isSASec)
    ? (config as PanelConfig | SingleAxisConfig).nsSpacing
    : (config as SlopeConfig).downSpacing;
  const downSpacing = installationType === 'slope' ? (config as SlopeConfig).downSpacing : 0;

  const toSVG = (x: number, y: number, z: number): [number, number] => [
    fwdE * x + fwdN * y, -z,
  ];

  const canDraw = installationType === 'pergola' && !!onChange;
  const rackForDraw = installationType === 'pergola'
    ? (getEffectiveRack(installation) as PergolaRackSpec) : null;
  const sectionLines: CustomDrawLine[] = rackForDraw?.customLines?.['section'] ?? [];
  const saRackSec = isSASec ? (getEffectiveRack(installation) as SingleAxisRackSpec) : null;

  useEffect(() => {
    setDrawStart(null);
    setDrawPreview(null);
  }, [installation.id]);

  const getSVGPos = (e: React.MouseEvent): [number, number] | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const sp = pt.matrixTransform(ctm.inverse());
    return [sp.x, sp.y];
  };

  const handleSVGClick = (e: React.MouseEvent) => {
    if (!drawMode || !onChange) return;
    const pos = getSVGPos(e);
    if (!pos) return;
    if (!drawStart) {
      setDrawStart(pos);
    } else {
      const rack = getEffectiveRack(installation) as PergolaRackSpec;
      const existing = rack.customLines?.['section'] ?? [];
      let newLine: CustomDrawLine;

      if (repeatAll && installationType === 'pergola') {
        const cfg = config as PanelConfig;
        const xGrid = computeXGrid(cfg, rack);
        const yGrid = computeYGrid(cfg, rack);
        const rDir = getRepeatDir(toSVG);
        const gridSVG = getRepeatGridSVG(rDir, xGrid, yGrid, toSVG);
        const midX = (drawStart[0] + pos[0]) / 2;
        const si = findNearestSpanIdx(midX, gridSVG);
        const spanW = (gridSVG[si + 1] ?? gridSVG[si]) - gridSVG[si];
        if (Math.abs(spanW) > 0.001) {
          newLine = {
            id: Date.now().toString(), color: drawColor, width: drawWidth,
            repeat: true, repeatDir: rDir,
            n1: (drawStart[0] - gridSVG[si]) / spanW,
            z1m: -drawStart[1],
            n2: (pos[0] - gridSVG[si]) / spanW,
            z2m: -pos[1],
          };
        } else {
          newLine = { id: Date.now().toString(), color: drawColor, width: drawWidth, x1: drawStart[0], y1: drawStart[1], x2: pos[0], y2: pos[1] };
        }
      } else {
        newLine = { id: Date.now().toString(), color: drawColor, width: drawWidth, x1: drawStart[0], y1: drawStart[1], x2: pos[0], y2: pos[1] };
      }

      onChange({ rackSpec: { ...rack, customLines: { ...(rack.customLines ?? {}), section: [...existing, newLine] } } });
      setDrawStart(null);
      setDrawPreview(null);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (drawMode && drawStart) {
      e.preventDefault();
      setDrawStart(null);
      setDrawPreview(null);
    }
  };

  const handleUndoLast = () => {
    if (!onChange || !rackForDraw) return;
    const lines = rackForDraw.customLines?.['section'] ?? [];
    if (lines.length === 0) return;
    onChange({ rackSpec: { ...rackForDraw, customLines: { ...(rackForDraw.customLines ?? {}), section: lines.slice(0, -1) } } });
  };

  const handleClearLines = () => {
    if (!onChange || !rackForDraw) return;
    onChange({ rackSpec: { ...rackForDraw, customLines: { ...(rackForDraw.customLines ?? {}), section: [] } } });
  };

  let svgXMin = Infinity, svgXMax = -Infinity, svgYMin = Infinity, svgYMax = 0;
  // Use all panels for bbox (rack spans full width)
  for (const p of panels) {
    for (const c of p.corners) {
      const [sx, sy] = toSVG(c.x, c.y, c.z);
      svgXMin = Math.min(svgXMin, sx); svgXMax = Math.max(svgXMax, sx);
      svgYMin = Math.min(svgYMin, sy);
    }
  }
  // Expand bbox to include rack structure
  if (installationType === 'pergola') {
    const rb = pergolaRackBBox(config as PanelConfig, getEffectiveRack(installation) as PergolaRackSpec, toSVG);
    svgXMin = Math.min(svgXMin, rb.xMin); svgXMax = Math.max(svgXMax, rb.xMax);
    svgYMin = Math.min(svgYMin, rb.yMin);
  }
  if (isSASec && saRackSec) {
    const rb = singleAxisRackBBox(config as SingleAxisConfig, saRackSec, toSVG);
    svgXMin = Math.min(svgXMin, rb.xMin); svgXMax = Math.max(svgXMax, rb.xMax);
    svgYMin = Math.min(svgYMin, rb.yMin);
  }

  const mg = 3;
  const vbX = svgXMin - mg, vbY = svgYMin - mg;
  const vbW = svgXMax - svgXMin + 2 * mg, vbH = svgYMax - svgYMin + 2 * mg;
  const pFill = isSASec ? 'rgba(22,163,74,0.72)' : installationType === 'pergola' ? 'rgba(29,78,216,0.72)' : 'rgba(213,94,10,0.72)';
  const pStroke = isSASec ? '#15803d' : installationType === 'pergola' ? '#1e40af' : '#b45309';

  let arcEl: React.ReactElement | null = null;
  if (sectionPanels.length > 0) {
    const lc = sectionPanels[0].corners.reduce((a, b) => (a.z < b.z ? a : b));
    const hc = sectionPanels[0].corners.reduce((a, b) => (a.z > b.z ? a : b));
    const [lcx, lcy] = toSVG(lc.x, lc.y, lc.z);
    const [hcx] = toSVG(hc.x, hc.y, hc.z);
    const arcR = Math.min(1.2, Math.abs(hcx - lcx) * 0.5);
    if (arcR > 0.1) {
      const angRad = effTilt * Math.PI / 180;
      arcEl = (
        <g>
          <line x1={lcx} y1={lcy} x2={lcx + arcR * 1.6} y2={lcy}
            stroke="#e07010" strokeWidth="0.05" strokeDasharray="0.15,0.1" />
          <path d={`M ${lcx + arcR} ${lcy} A ${arcR} ${arcR} 0 0 0 ${lcx + arcR * Math.cos(angRad)} ${lcy - arcR * Math.sin(angRad)}`}
            stroke="#e07010" strokeWidth="0.07" fill="none" />
          <text x={lcx + arcR + 0.15} y={lcy - arcR * 0.45} fontSize="0.4" fill="#e07010" fontWeight="700">{effTilt}°</text>
        </g>
      );
    }
  }

  return (
    <div className="svg-drawing-wrap">
      <div className="drawing-info-bar">
        <span className="dv-label">断面図（側面）</span>
        <span>{installation.name}</span>
        <span>有効傾斜 {effTilt}° ／ 設置高さ {mountH.toFixed(1)} m</span>
        {drawMode && (
          <span className="dv-note" style={{ color: '#e07010' }}>
            {drawStart ? 'クリックで終点を指定（右クリック:キャンセル）' : 'クリックで始点を指定'}
          </span>
        )}
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', alignItems: 'center' }}>
          {canDraw && (
            <button
              className={`dv-dir-btn${drawMode ? ' active' : ''}`}
              onClick={() => { setDrawMode(m => !m); setDrawStart(null); setDrawPreview(null); }}
            >{drawMode ? '✓ 描画終了' : '✏ 線を描く'}</button>
          )}
          {drawMode && (
            <>
              <label style={{ fontSize: 10.5, display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={repeatAll} onChange={e => setRepeatAll(e.target.checked)} style={{ cursor: 'pointer' }} />
                全スパン
              </label>
              {DRAW_COLORS.map(c => (
                <div key={c} onClick={() => setDrawColor(c)}
                  style={{ width: 17, height: 17, background: c, border: drawColor === c ? '2.5px solid #fff' : '1px solid #aaa', borderRadius: 3, cursor: 'pointer', flexShrink: 0, outline: drawColor === c ? '1.5px solid #555' : 'none' }} />
              ))}
              <select style={{ fontSize: 10.5, padding: '2px 3px', border: '1px solid #ccc', borderRadius: 3 }}
                value={drawWidth} onChange={e => setDrawWidth(+e.target.value)}>
                <option value={0.05}>細</option>
                <option value={0.10}>中</option>
                <option value={0.16}>太</option>
              </select>
              {sectionLines.length > 0 && <>
                <button className="dv-dir-btn" title="最後の線を取消" onClick={handleUndoLast}>↩</button>
                <button className="dv-dir-btn" title="断面図の線を全削除" onClick={handleClearLines}>🗑</button>
              </>}
            </>
          )}
        </div>
      </div>
      <svg ref={svgRef} viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`} className="drawing-svg" preserveAspectRatio="xMidYMid meet"
        onMouseMove={drawMode && drawStart ? e => setDrawPreview(getSVGPos(e)) : undefined}
        onMouseLeave={() => setDrawPreview(null)}
        onClick={drawMode ? handleSVGClick : undefined}
        onContextMenu={handleContextMenu}
        style={{ cursor: drawMode ? 'crosshair' : 'default' }}
      >
        <SvgDefs />
        {installationType === 'slope' ? (() => {
          const slopeRad = slopeAngle * Math.PI / 180;
          const xRange = svgXMax - svgXMin;
          return (
            <>
              <path d={`M ${svgXMin - 0.5} 0 L ${svgXMax + 0.5} ${-(xRange + 1) * Math.tan(slopeRad)} L ${svgXMax + 0.5} ${mg * 0.7} L ${svgXMin - 0.5} ${mg * 0.7} Z`}
                fill="rgba(184,149,106,0.25)" />
              <line x1={svgXMin - 0.5} y1={0} x2={svgXMax + 0.5} y2={-(xRange + 1) * Math.tan(slopeRad)}
                stroke="#b8956a" strokeWidth="0.12" />
            </>
          );
        })() : (
          <>
            <rect x={vbX} y={0} width={vbW} height={mg} fill="rgba(104,148,106,0.2)" />
            <line x1={vbX} y1={0} x2={vbX + vbW} y2={0} stroke="#68946a" strokeWidth="0.08" />
          </>
        )}
        {installationType === 'pergola' && (
          <>
            <PergolaRackSVG
              cfg={config as PanelConfig}
              rack={getEffectiveRack(installation) as PergolaRackSpec}
              toSVG={toSVG}
            />
            <DimLine x1={svgXMin} y1={0} x2={svgXMin} y2={-mountH} offset={-1.4}
              label={`${mountH.toFixed(2)} m`} color="#c53030" />
          </>
        )}
        {isSASec && saRackSec && (
          <>
            <SingleAxisRackSVG
              cfg={config as SingleAxisConfig}
              rack={saRackSec}
              toSVG={toSVG}
            />
            <DimLine x1={svgXMin} y1={0} x2={svgXMin} y2={-mountH} offset={-1.4}
              label={`${mountH.toFixed(2)} m`} color="#c53030" />
          </>
        )}
        {installationType === 'slope' && mountH > 0 && (
          <DimLine x1={svgXMin} y1={0} x2={svgXMin} y2={-mountH} offset={-1.4}
            label={`基礎 ${mountH.toFixed(2)} m`} color="#c53030" />
        )}
        {sectionPanels.map(panel => (
          <polygon key={panel.panelIndex}
            points={panel.corners.map(c => { const [sx, sy] = toSVG(c.x, c.y, c.z); return `${sx},${sy}`; }).join(' ')}
            fill={pFill} stroke={pStroke} strokeWidth="0.055" />
        ))}
        {sectionPanels.length > 1 && (() => {
          const [c0x, c0y] = toSVG(
            sectionPanels[0].corners.reduce((s, c) => s + c.x, 0) / 4,
            sectionPanels[0].corners.reduce((s, c) => s + c.y, 0) / 4,
            sectionPanels[0].corners.reduce((s, c) => s + c.z, 0) / 4,
          );
          const [c1x, c1y] = toSVG(
            sectionPanels[1].corners.reduce((s, c) => s + c.x, 0) / 4,
            sectionPanels[1].corners.reduce((s, c) => s + c.y, 0) / 4,
            sectionPanels[1].corners.reduce((s, c) => s + c.z, 0) / 4,
          );
          const spacingLabel = (installationType === 'pergola' || isSASec)
            ? `@${nsSpacing}m` : `@${downSpacing}m(斜)`;
          return (
            <DimLine x1={c0x} y1={c0y} x2={c1x} y2={c1y}
              offset={-1.2} label={spacingLabel} color="#2563eb" />
          );
        })()}
        {arcEl}
        <DimLine x1={svgXMin} y1={svgYMin - 0.3} x2={svgXMax} y2={svgYMin - 0.3}
          offset={-1.3} label={`${(svgXMax - svgXMin).toFixed(2)} m`} />
        <DimLine x1={svgXMax} y1={0} x2={svgXMax} y2={svgYMin}
          offset={1.3} label={`${(-svgYMin).toFixed(2)} m`} />
        {/* カスタム描画線（断面図） */}
        {rackForDraw && (
          <CustomLinesRenderer
            lines={sectionLines}
            xGrid={computeXGrid(config as PanelConfig, rackForDraw)}
            yGrid={computeYGrid(config as PanelConfig, rackForDraw)}
            toSVG={toSVG}
          />
        )}
        {drawMode && drawStart && drawPreview && (
          <line x1={drawStart[0]} y1={drawStart[1]} x2={drawPreview[0]} y2={drawPreview[1]}
            stroke={drawColor} strokeWidth={drawWidth} strokeLinecap="round"
            strokeDasharray="0.18,0.09" opacity={0.75} />
        )}
        {drawMode && drawStart && (
          <circle cx={drawStart[0]} cy={drawStart[1]} r={0.14} fill={drawColor} opacity={0.85} />
        )}
      </svg>
    </div>
  );
}

// ===== Edit Panel components =====

function DVNumInput({
  label, value, onChange, unit, min, max, step = 0.1,
}: {
  label: string; value: number; onChange: (v: number) => void;
  unit?: string; min?: number; max?: number; step?: number;
}) {
  return (
    <div className="dv-field">
      <label className="dv-field-label">{label}</label>
      <div className="dv-field-input">
        <input
          type="number" value={value} min={min} max={max} step={step}
          onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); }}
        />
        {unit && <span className="dv-field-unit">{unit}</span>}
      </div>
    </div>
  );
}

function DVSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="dv-field">
      <label className="dv-field-label">{label}</label>
      <div className="dv-field-input">
        <select value={value} onChange={e => onChange(e.target.value)} className="dv-select">
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    </div>
  );
}

function DVToggle({ label, value, onChange }: {
  label: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="dv-field">
      <label className="dv-field-label">{label}</label>
      <div className="dv-field-input">
        <button
          className={`dv-toggle${value ? ' on' : ''}`}
          onClick={() => onChange(!value)}
        >{value ? 'あり' : 'なし'}</button>
      </div>
    </div>
  );
}

// ===== Panel Section =====

function PanelSection({
  installation, onChange,
}: {
  installation: FieldInstallation;
  onChange: (patch: Partial<FieldInstallation>) => void;
}) {
  const spec = getEffectivePanelSpec(installation);
  const config = installation.config;

  const selectedKey = installation.panelSpec
    ? (PANEL_PRESETS.find(p => p.model === installation.panelSpec?.model)?.key ?? 'custom')
    : 'LP510W';

  const handlePresetChange = (key: string) => {
    const preset = PANEL_PRESETS.find(p => p.key === key) ?? PANEL_PRESETS[1];
    const { key: _k, ...spec } = preset;
    const wM = spec.widthMm / 1000;
    const dM = spec.lengthMm / 1000;
    onChange({
      panelSpec: spec,
      config: { ...config, panelWidth: wM, panelDepth: dM } as AnyConfig,
    });
  };

  const updSpec = (patch: Partial<PanelSpec>) => {
    const newSpec = { ...spec, ...patch };
    const patch2: Partial<FieldInstallation> = { panelSpec: newSpec };
    if ('widthMm' in patch) patch2.config = { ...config, panelWidth: newSpec.widthMm / 1000 } as AnyConfig;
    if ('lengthMm' in patch) patch2.config = { ...config, panelDepth: newSpec.lengthMm / 1000 } as AnyConfig;
    onChange(patch2);
  };

  const totalPanels = (installation.installationType === 'pergola' || installation.installationType === 'single_axis')
    ? (config as PanelConfig | SingleAxisConfig).colsEW * (config as PanelConfig | SingleAxisConfig).rowsNS
    : (config as SlopeConfig).colsAcross * (config as SlopeConfig).rowsDown;
  const totalW = totalPanels * spec.wattage;
  const totalWBi = spec.isBifacial ? totalW * (1 + spec.bifacialGainPct / 100) : totalW;
  const totalKg = totalPanels * spec.weightKg;

  return (
    <>
      <div className="dv-section-title">📋 パネル仕様</div>
      <DVSelect
        label="パネル選択"
        value={selectedKey}
        onChange={handlePresetChange}
        options={PANEL_PRESETS.map(p => ({ value: p.key, label: p.key === 'custom' ? 'カスタム' : `${p.maker} ${p.model}` }))}
      />
      <div className="dv-panel-spec-box">
        <div className="dv-spec-row"><span className="dv-spec-key">メーカー</span><span>{spec.maker || '—'}</span></div>
        <div className="dv-spec-row"><span className="dv-spec-key">型番</span><span style={{fontSize:10}}>{spec.model}</span></div>
      </div>
      {selectedKey === 'custom' ? (
        <>
          <DVNumInput label="幅 W" value={spec.widthMm} onChange={v => updSpec({ widthMm: v })} unit="mm" min={500} max={2500} step={1} />
          <DVNumInput label="長辺 L" value={spec.lengthMm} onChange={v => updSpec({ lengthMm: v })} unit="mm" min={500} max={3000} step={1} />
          <DVNumInput label="厚さ" value={spec.thicknessMm} onChange={v => updSpec({ thicknessMm: v })} unit="mm" min={20} max={50} step={1} />
          <DVNumInput label="重量" value={spec.weightKg} onChange={v => updSpec({ weightKg: v })} unit="kg" min={5} max={60} step={0.1} />
          <DVNumInput label="出力" value={spec.wattage} onChange={v => updSpec({ wattage: v })} unit="W" min={100} max={800} step={5} />
          <DVNumInput label="Voc" value={spec.voc} onChange={v => updSpec({ voc: v })} unit="V" min={20} max={80} step={0.1} />
          <DVNumInput label="Isc" value={spec.isc} onChange={v => updSpec({ isc: v })} unit="A" min={5} max={25} step={0.1} />
        </>
      ) : (
        <>
          <div className="dv-field">
            <label className="dv-field-label">サイズ</label>
            <div className="dv-field-input" style={{fontSize:11}}>{spec.widthMm} × {spec.lengthMm} × {spec.thicknessMm} mm</div>
          </div>
          <div className="dv-field">
            <label className="dv-field-label">重量 / 出力</label>
            <div className="dv-field-input" style={{fontSize:11}}>{spec.weightKg} kg ／ {spec.wattage} W</div>
          </div>
          <div className="dv-field">
            <label className="dv-field-label">両面発電</label>
            <div className="dv-field-input" style={{fontSize:11}}>
              {spec.isBifacial ? `両面 +${spec.bifacialGainPct}%` : '片面'}
            </div>
          </div>
          <div className="dv-field">
            <label className="dv-field-label">Voc / Isc</label>
            <div className="dv-field-input" style={{fontSize:11}}>{spec.voc} V ／ {spec.isc} A</div>
          </div>
        </>
      )}
      <div className="dv-calc-box">
        <div>枚数: <strong>{totalPanels}枚</strong> ／ 総重量: <strong>{totalKg.toFixed(0)} kg</strong></div>
        <div>表面出力: <strong>{(totalW / 1000).toFixed(2)} kW</strong>
          {spec.isBifacial && <> ／ 両面込: <strong>{(totalWBi / 1000).toFixed(2)} kW</strong></>}
        </div>
        <div>パネル面積: <strong>{(totalPanels * spec.widthMm / 1000 * spec.lengthMm / 1000).toFixed(1)} m²</strong></div>
      </div>
    </>
  );
}

// ===== Pergola Rack Section =====

function PergolaRackSection({
  rackSpec, onChange, defaultColsEW, defaultRowsNS,
}: {
  rackSpec: PergolaRackSpec;
  onChange: (r: PergolaRackSpec) => void;
  defaultColsEW: number;
  defaultRowsNS: number;
}) {
  const upd = (patch: Partial<PergolaRackSpec>) => onChange({ ...rackSpec, ...patch });
  return (
    <>
      <div className="dv-section-title">📐 架台レイアウト</div>
      <DVNumInput label="EW支柱列数" value={rackSpec.postColsEW ?? defaultColsEW} onChange={v => upd({ postColsEW: Math.max(2, Math.round(v)) })} unit="列" min={2} max={30} step={1} />
      <DVNumInput label="NS梁本数" value={rackSpec.yokosanRowsNS ?? defaultRowsNS} onChange={v => upd({ yokosanRowsNS: Math.max(2, Math.round(v)) })} unit="本" min={2} max={40} step={1} />
      <div className="dv-calc-box">
        <div>支柱: <strong>{rackSpec.postColsEW ?? defaultColsEW}列 × {rackSpec.yokosanRowsNS ?? defaultRowsNS}本</strong></div>
      </div>
      <div className="dv-section-title">🔵 柱 (Posts)</div>
      <DVNumInput label="外径" value={rackSpec.postDiameterMm} onChange={v => upd({ postDiameterMm: v })} unit="mm" min={48} max={216} step={0.1} />
      <DVNumInput label="肉厚" value={rackSpec.postThicknessMm} onChange={v => upd({ postThicknessMm: v })} unit="mm" min={2} max={12} step={0.1} />
      <DVSelect label="材質" value={rackSpec.postMaterial}
        options={[
          { value: 'STK400 亜鉛メッキ', label: 'STK400 亜鉛メッキ' },
          { value: 'STK490 亜鉛メッキ', label: 'STK490 亜鉛メッキ' },
          { value: 'SUS304', label: 'SUS304 ステンレス' },
          { value: 'アルミ', label: 'アルミ合金' },
        ]}
        onChange={v => upd({ postMaterial: v })}
      />
      <DVNumInput label="ベースPL幅" value={rackSpec.basePlateWidthMm} onChange={v => upd({ basePlateWidthMm: v })} unit="mm" min={100} max={600} step={10} />
      <DVNumInput label="ベースPL厚" value={rackSpec.basePlateThicknessMm} onChange={v => upd({ basePlateThicknessMm: v })} unit="mm" min={6} max={32} step={1} />

      <div className="dv-section-title">🟣 ヨコサン (Cross Beams)</div>
      <DVNumInput label="断面高さ H" value={rackSpec.yokosanH} onChange={v => upd({ yokosanH: v })} unit="mm" min={40} max={300} step={5} />
      <DVNumInput label="断面幅 W" value={rackSpec.yokosanW} onChange={v => upd({ yokosanW: v })} unit="mm" min={30} max={200} step={5} />
      <DVNumInput label="肉厚" value={rackSpec.yokosanT} onChange={v => upd({ yokosanT: v })} unit="mm" min={1.5} max={12} step={0.1} />

      <div className="dv-section-title">🟢 タテサン (Purlins)</div>
      <DVNumInput label="断面高さ H" value={rackSpec.tatesanH} onChange={v => upd({ tatesanH: v })} unit="mm" min={30} max={200} step={5} />
      <DVNumInput label="断面幅 W" value={rackSpec.tatesanW} onChange={v => upd({ tatesanW: v })} unit="mm" min={20} max={150} step={5} />
      <DVNumInput label="肉厚" value={rackSpec.tatesanT} onChange={v => upd({ tatesanT: v })} unit="mm" min={1.5} max={6} step={0.1} />
      <DVNumInput label="1スパン本数" value={rackSpec.tatesanPerSpan} onChange={v => upd({ tatesanPerSpan: Math.max(1, Math.round(v)) })} unit="本" min={1} max={6} step={1} />
      <DVNumInput label="高さ位置" value={rackSpec.tatesanZRatio ?? 0.5}
        onChange={v => upd({ tatesanZRatio: Math.min(1, Math.max(0, Math.round(v * 100) / 100)) })}
        unit="(0=根元 1=頂部)" min={0} max={1} step={0.05} />

      <div className="dv-section-title">🟤 斜材 (Bracing)</div>
      <DVToggle label="斜材" value={rackSpec.hasBrace} onChange={v => upd({ hasBrace: v })} />
      {rackSpec.hasBrace && (
        <>
          <DVNumInput label="径" value={rackSpec.braceDiameterMm} onChange={v => upd({ braceDiameterMm: v })} unit="mm" min={20} max={114} step={0.1} />
          <DVNumInput label="肉厚" value={rackSpec.braceThicknessMm} onChange={v => upd({ braceThicknessMm: v })} unit="mm" min={1.5} max={6} step={0.1} />
          <DVNumInput
            label="接続X（NS比率）"
            value={rackSpec.braceReachX ?? 1.0}
            onChange={v => upd({ braceReachX: Math.min(1, Math.max(0, v)) })}
            unit="" min={0} max={1} step={0.05}
          />
          <DVNumInput
            label="接続Y（高さ比率）"
            value={rackSpec.braceAttachY ?? 0.65}
            onChange={v => upd({ braceAttachY: Math.min(1, Math.max(0, v)) })}
            unit="" min={0} max={1} step={0.05}
          />
        </>
      )}

      <div className="dv-section-title">⛏ 基礎 (Foundation)</div>
      <DVSelect label="基礎タイプ" value={rackSpec.foundationType}
        options={[
          { value: 'baseplate', label: 'ベースプレート' },
          { value: 'direct', label: '直接基礎（根入れ）' },
          { value: 'anchor', label: 'アンカーボルト' },
        ]}
        onChange={v => upd({ foundationType: v as PergolaRackSpec['foundationType'] })}
      />
      <DVNumInput label="基礎深さ" value={rackSpec.foundationDepthM} onChange={v => upd({ foundationDepthM: v })} unit="m" min={0.5} max={5} step={0.1} />

      <div className="dv-section-title">✏ カスタム描画</div>
      <div className="dv-calc-box" style={{ gap: 4 }}>
        {Object.entries(rackSpec.customLines ?? {}).some(([, lines]) => lines.length > 0) ? (
          Object.entries(rackSpec.customLines ?? {}).map(([view, lines]) =>
            lines.length > 0 ? (
              <div key={view} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{VIEW_LABELS[view] ?? view}: <strong>{lines.length}本</strong></span>
                <button
                  onClick={() => upd({ customLines: { ...(rackSpec.customLines ?? {}), [view]: [] } })}
                  style={{ fontSize: 10, padding: '1px 7px', border: '1px solid #ccc', borderRadius: 3, cursor: 'pointer', background: '#fff' }}
                >削除</button>
              </div>
            ) : null
          )
        ) : (
          <span style={{ color: '#9ca3af', fontSize: 10.5 }}>描画なし（立面図・断面図で「✏ 線を描く」）</span>
        )}
      </div>
    </>
  );
}

// ===== Slope Rack Section =====

function SlopeRackSection({
  rackSpec, onChange,
}: {
  rackSpec: SlopeRackSpec;
  onChange: (r: SlopeRackSpec) => void;
}) {
  const upd = (patch: Partial<SlopeRackSpec>) => onChange({ ...rackSpec, ...patch });
  return (
    <>
      <div className="dv-section-title">🔵 支柱 (Posts)</div>
      <DVNumInput label="外径" value={rackSpec.postDiameterMm} onChange={v => upd({ postDiameterMm: v })} unit="mm" min={42} max={165} step={0.1} />
      <DVNumInput label="肉厚" value={rackSpec.postThicknessMm} onChange={v => upd({ postThicknessMm: v })} unit="mm" min={2} max={10} step={0.1} />
      <DVNumInput label="法面突出高" value={rackSpec.postHeightMm} onChange={v => upd({ postHeightMm: v })} unit="mm" min={100} max={2000} step={50} />
      <DVSelect label="材質" value={rackSpec.postMaterial}
        options={[
          { value: 'STK400 亜鉛メッキ', label: 'STK400 亜鉛メッキ' },
          { value: 'STK490 亜鉛メッキ', label: 'STK490 亜鉛メッキ' },
          { value: 'SUS304', label: 'SUS304 ステンレス' },
        ]}
        onChange={v => upd({ postMaterial: v })}
      />

      <div className="dv-section-title">🟣 上下弦材 (Chord)</div>
      <DVNumInput label="断面高さ H" value={rackSpec.chordH} onChange={v => upd({ chordH: v })} unit="mm" min={30} max={200} step={5} />
      <DVNumInput label="断面幅 W" value={rackSpec.chordW} onChange={v => upd({ chordW: v })} unit="mm" min={20} max={150} step={5} />
      <DVNumInput label="肉厚" value={rackSpec.chordT} onChange={v => upd({ chordT: v })} unit="mm" min={1.5} max={8} step={0.1} />

      <div className="dv-section-title">🟢 縦桟 (Vertical Rails)</div>
      <DVNumInput label="断面高さ H" value={rackSpec.vertRailH} onChange={v => upd({ vertRailH: v })} unit="mm" min={30} max={150} step={5} />
      <DVNumInput label="断面幅 W" value={rackSpec.vertRailW} onChange={v => upd({ vertRailW: v })} unit="mm" min={20} max={100} step={5} />
      <DVNumInput label="肉厚" value={rackSpec.vertRailT} onChange={v => upd({ vertRailT: v })} unit="mm" min={1.5} max={6} step={0.1} />
      <DVNumInput label="1枚あたり本数" value={rackSpec.vertRailPerPanel} onChange={v => upd({ vertRailPerPanel: Math.max(1, Math.round(v)) })} unit="本" min={1} max={5} step={1} />

      <div className="dv-section-title">🟡 横桟 (Horizontal Rails)</div>
      <DVNumInput label="断面高さ H" value={rackSpec.horizRailH} onChange={v => upd({ horizRailH: v })} unit="mm" min={30} max={150} step={5} />
      <DVNumInput label="断面幅 W" value={rackSpec.horizRailW} onChange={v => upd({ horizRailW: v })} unit="mm" min={20} max={100} step={5} />
      <DVNumInput label="肉厚" value={rackSpec.horizRailT} onChange={v => upd({ horizRailT: v })} unit="mm" min={1.5} max={6} step={0.1} />

      <div className="dv-section-title">🟤 筋交い / 基礎</div>
      <DVToggle label="筋交い" value={rackSpec.hasBrace} onChange={v => upd({ hasBrace: v })} />
      <DVSelect label="基礎タイプ" value={rackSpec.foundationType}
        options={[
          { value: 'pile', label: '鋼管杭' },
          { value: 'mass', label: '重力式コンクリート' },
          { value: 'block', label: 'ブロック基礎' },
        ]}
        onChange={v => upd({ foundationType: v as SlopeRackSpec['foundationType'] })}
      />
      <DVNumInput label="基礎深さ" value={rackSpec.foundationDepthM} onChange={v => upd({ foundationDepthM: v })} unit="m" min={0.3} max={5} step={0.1} />
      {rackSpec.foundationType === 'pile' && (
        <DVNumInput label="杭径" value={rackSpec.pileDiameterMm} onChange={v => upd({ pileDiameterMm: v })} unit="mm" min={42} max={216} step={0.1} />
      )}
    </>
  );
}

// ===== Single Axis Rack Section =====

function SingleAxisRackSection({
  rackSpec, onChange,
}: {
  rackSpec: SingleAxisRackSpec;
  onChange: (r: SingleAxisRackSpec) => void;
}) {
  const upd = (patch: Partial<SingleAxisRackSpec>) => onChange({ ...rackSpec, ...patch });
  return (
    <>
      <div className="dv-section-title">🔵 柱 (Posts)</div>
      <DVNumInput label="外径" value={rackSpec.postDiameterMm} onChange={v => upd({ postDiameterMm: v })} unit="mm" min={48} max={216} step={0.1} />
      <DVNumInput label="肉厚" value={rackSpec.postThicknessMm} onChange={v => upd({ postThicknessMm: v })} unit="mm" min={2} max={12} step={0.1} />
      <DVSelect label="材質" value={rackSpec.postMaterial}
        options={[
          { value: 'STK400 亜鉛メッキ', label: 'STK400 亜鉛メッキ' },
          { value: 'STK490 亜鉛メッキ', label: 'STK490 亜鉛メッキ' },
          { value: 'SUS304', label: 'SUS304 ステンレス' },
          { value: 'アルミ', label: 'アルミ合金' },
        ]}
        onChange={v => upd({ postMaterial: v })}
      />
      <DVNumInput label="ベースPL幅" value={rackSpec.basePlateWidthMm} onChange={v => upd({ basePlateWidthMm: v })} unit="mm" min={100} max={600} step={10} />
      <DVNumInput label="ベースPL厚" value={rackSpec.basePlateThicknessMm} onChange={v => upd({ basePlateThicknessMm: v })} unit="mm" min={6} max={32} step={1} />

      <div className="dv-section-title">🟣 クロスアーム (Cross Arms)</div>
      <DVNumInput label="断面高さ H" value={rackSpec.crossarmH} onChange={v => upd({ crossarmH: v })} unit="mm" min={50} max={300} step={5} />
      <DVNumInput label="断面幅 W" value={rackSpec.crossarmW} onChange={v => upd({ crossarmW: v })} unit="mm" min={30} max={200} step={5} />
      <DVNumInput label="肉厚" value={rackSpec.crossarmT} onChange={v => upd({ crossarmT: v })} unit="mm" min={1.5} max={12} step={0.1} />

      <div className="dv-section-title">🟢 パーリン/タテサン (NS Purlins)</div>
      <DVNumInput label="断面高さ H" value={rackSpec.purlinH} onChange={v => upd({ purlinH: v })} unit="mm" min={30} max={200} step={5} />
      <DVNumInput label="断面幅 W" value={rackSpec.purlinW} onChange={v => upd({ purlinW: v })} unit="mm" min={20} max={150} step={5} />
      <DVNumInput label="肉厚" value={rackSpec.purlinT} onChange={v => upd({ purlinT: v })} unit="mm" min={1.5} max={8} step={0.1} />
      <DVNumInput label="本数(EW)" value={rackSpec.purlinPerBay} onChange={v => upd({ purlinPerBay: Math.max(2, Math.round(v)) })} unit="本" min={2} max={10} step={1} />

      <div className="dv-section-title">🟤 斜材 (Bracing)</div>
      <DVNumInput label="斜材接続高さ比" value={rackSpec.braceH} onChange={v => upd({ braceH: Math.min(1, Math.max(0, v)) })} unit="(0~1)" min={0} max={1} step={0.05} />
      <DVNumInput label="径" value={rackSpec.braceDiameterMm} onChange={v => upd({ braceDiameterMm: v })} unit="mm" min={20} max={114} step={0.1} />
      <DVNumInput label="肉厚" value={rackSpec.braceThicknessMm} onChange={v => upd({ braceThicknessMm: v })} unit="mm" min={1.5} max={6} step={0.1} />

      <div className="dv-section-title">⛏ 基礎 (Foundation)</div>
      <DVSelect label="基礎タイプ" value={rackSpec.foundationType}
        options={[
          { value: 'baseplate', label: 'ベースプレート' },
          { value: 'direct', label: '直接基礎（根入れ）' },
          { value: 'anchor', label: 'アンカーボルト' },
        ]}
        onChange={v => upd({ foundationType: v as SingleAxisRackSpec['foundationType'] })}
      />
      <DVNumInput label="基礎深さ" value={rackSpec.foundationDepthM} onChange={v => upd({ foundationDepthM: v })} unit="m" min={0.5} max={5} step={0.1} />
    </>
  );
}

// ===== Main Edit Panel =====

function EditPanel({
  installation, onChange,
}: {
  installation: FieldInstallation;
  onChange: (patch: Partial<FieldInstallation>) => void;
}) {
  const { config, installationType } = installation;
  const upd = useCallback(
    (patch: Partial<AnyConfig>) => onChange({ config: { ...config, ...patch } as AnyConfig }),
    [config, onChange]
  );

  const rackSpec = getEffectiveRack(installation);
  const handleRackChange = useCallback(
    (newRack: PergolaRackSpec | SlopeRackSpec | SingleAxisRackSpec) => onChange({ rackSpec: newRack }),
    [onChange]
  );

  return (
    <div className="dv-edit-panel">
      <div className="dv-edit-header">
        <span className={`dv-type-chip ${installationType}`}>
          {installationType === 'pergola' ? '藤棚型' : installationType === 'single_axis' ? '1軸型' : '法面型'}
        </span>
        <span className="dv-edit-inst-name">{installation.name}</span>
      </div>

      {/* Panel spec */}
      <PanelSection installation={installation} onChange={onChange} />

      {/* Basic structural params */}
      {installationType === 'pergola' && (
        <>
          <div className="dv-section-title">🏗 架台基本設計</div>
          <DVNumInput label="架台高さ" value={(config as PanelConfig).mountHeight} onChange={v => upd({ mountHeight: v })} unit="m" min={0.3} max={15} step={0.1} />
          <DVNumInput label="傾斜角" value={(config as PanelConfig).tiltAngle} onChange={v => upd({ tiltAngle: v })} unit="°" min={0} max={60} step={1} />
          <DVNumInput label="方位角" value={(config as PanelConfig).facingAzimuth} onChange={v => upd({ facingAzimuth: v })} unit="°" min={0} max={360} step={1} />
          <DVNumInput label="架台回転" value={(config as PanelConfig).rackRotation} onChange={v => upd({ rackRotation: v })} unit="°" min={-90} max={90} step={1} />

          <div className="dv-section-title">☀️ パネル配置</div>
          <DVNumInput label="EW列数" value={(config as PanelConfig).colsEW} onChange={v => upd({ colsEW: Math.max(1, Math.round(v)) })} unit="列" min={1} max={30} step={1} />
          <DVNumInput label="NS行数" value={(config as PanelConfig).rowsNS} onChange={v => upd({ rowsNS: Math.max(1, Math.round(v)) })} unit="行" min={1} max={30} step={1} />
          <DVNumInput label="EW間隔(C-C)" value={(config as PanelConfig).ewSpacing} onChange={v => upd({ ewSpacing: v })} unit="m" min={0.5} max={10} step={0.05} />
          <DVNumInput label="NS間隔(C-C)" value={(config as PanelConfig).nsSpacing} onChange={v => upd({ nsSpacing: v })} unit="m" min={0.5} max={15} step={0.05} />

          <div className="dv-calc-box">
            <div>EW架台幅: <strong>{((config as PanelConfig).colsEW * (config as PanelConfig).ewSpacing).toFixed(2)} m</strong></div>
            <div>NS架台奥: <strong>{((config as PanelConfig).rowsNS * (config as PanelConfig).nsSpacing).toFixed(2)} m</strong></div>
            <div>最高点: <strong>{((config as PanelConfig).mountHeight + config.panelDepth / 2 * Math.sin((config as PanelConfig).tiltAngle * Math.PI / 180)).toFixed(2)} m</strong></div>
            <div>パネル間隔: <strong>{((config as PanelConfig).ewSpacing - config.panelWidth).toFixed(2)} m</strong></div>
          </div>

          <PergolaRackSection
            rackSpec={rackSpec as PergolaRackSpec}
            onChange={handleRackChange}
            defaultColsEW={(config as PanelConfig).colsEW + 1}
            defaultRowsNS={(config as PanelConfig).rowsNS + 1}
          />
        </>
      )}

      {installationType === 'slope' && (
        <>
          <div className="dv-section-title">⛰️ 法面条件</div>
          <DVNumInput label="法面傾斜" value={(config as SlopeConfig).slopeAngle} onChange={v => upd({ slopeAngle: v })} unit="°" min={0} max={80} step={1} />
          <DVNumInput label="追加傾斜" value={(config as SlopeConfig).additionalTilt} onChange={v => upd({ additionalTilt: v })} unit="°" min={0} max={45} step={1} />
          <DVNumInput label="方位角" value={(config as SlopeConfig).facingAzimuth} onChange={v => upd({ facingAzimuth: v })} unit="°" min={0} max={360} step={1} />
          <DVNumInput label="基礎高さ" value={(config as SlopeConfig).baseMountHeight} onChange={v => upd({ baseMountHeight: v })} unit="m" min={0} max={3} step={0.05} />

          <div className="dv-section-title">☀️ パネル配置</div>
          <DVNumInput label="横列数" value={(config as SlopeConfig).colsAcross} onChange={v => upd({ colsAcross: Math.max(1, Math.round(v)) })} unit="列" min={1} max={30} step={1} />
          <DVNumInput label="縦段数" value={(config as SlopeConfig).rowsDown} onChange={v => upd({ rowsDown: Math.max(1, Math.round(v)) })} unit="段" min={1} max={30} step={1} />
          <DVNumInput label="横間隔(C-C)" value={(config as SlopeConfig).acrossSpacing} onChange={v => upd({ acrossSpacing: v })} unit="m" min={0.5} max={10} step={0.05} />
          <DVNumInput label="縦間隔(斜面)" value={(config as SlopeConfig).downSpacing} onChange={v => upd({ downSpacing: v })} unit="m" min={0.5} max={15} step={0.05} />

          <div className="dv-calc-box">
            <div>有効傾斜: <strong>{(config as SlopeConfig).slopeAngle + (config as SlopeConfig).additionalTilt}°</strong></div>
            <div>横幅: <strong>{((config as SlopeConfig).colsAcross * (config as SlopeConfig).acrossSpacing).toFixed(2)} m</strong></div>
            <div>法面高さ: <strong>{((config as SlopeConfig).rowsDown * (config as SlopeConfig).downSpacing * Math.sin((config as SlopeConfig).slopeAngle * Math.PI / 180)).toFixed(2)} m</strong></div>
            <div>水平投影: <strong>{((config as SlopeConfig).rowsDown * (config as SlopeConfig).downSpacing * Math.cos((config as SlopeConfig).slopeAngle * Math.PI / 180)).toFixed(2)} m</strong></div>
          </div>

          <SlopeRackSection
            rackSpec={rackSpec as SlopeRackSpec}
            onChange={handleRackChange}
          />
        </>
      )}

      {installationType === 'single_axis' && (
        <>
          <div className="dv-section-title">🏗 1軸型架台 基本設計</div>
          <DVNumInput label="柱高さ" value={(config as SingleAxisConfig).mountHeight} onChange={v => upd({ mountHeight: v })} unit="m" min={0.5} max={15} step={0.1} />
          <DVNumInput label="傾斜角" value={(config as SingleAxisConfig).tiltAngle} onChange={v => upd({ tiltAngle: v })} unit="°" min={0} max={30} step={1} />
          <DVNumInput label="方位角" value={(config as SingleAxisConfig).facingAzimuth} onChange={v => upd({ facingAzimuth: v })} unit="°" min={0} max={360} step={1} />
          <DVNumInput label="架台回転" value={(config as SingleAxisConfig).rackRotation} onChange={v => upd({ rackRotation: v })} unit="°" min={-90} max={90} step={1} />

          <div className="dv-section-title">☀️ パネル配置</div>
          <DVNumInput label="EW総列数" value={(config as SingleAxisConfig).colsEW} onChange={v => upd({ colsEW: Math.max(2, Math.round(v)) })} unit="列" min={2} max={30} step={1} />
          <DVNumInput label="NS行数" value={(config as SingleAxisConfig).rowsNS} onChange={v => upd({ rowsNS: Math.max(1, Math.round(v)) })} unit="行" min={1} max={30} step={1} />
          <DVNumInput label="EW間隔(C-C)" value={(config as SingleAxisConfig).ewSpacing} onChange={v => upd({ ewSpacing: v })} unit="m" min={0.5} max={10} step={0.05} />
          <DVNumInput label="NS間隔(柱ピッチ)" value={(config as SingleAxisConfig).nsSpacing} onChange={v => upd({ nsSpacing: v })} unit="m" min={1} max={20} step={0.05} />

          <div className="dv-calc-box">
            <div>クロスアーム長: <strong>{((config as SingleAxisConfig).colsEW - 1) * (config as SingleAxisConfig).ewSpacing}m（両側合計）</strong></div>
            <div>NS総長: <strong>{((config as SingleAxisConfig).rowsNS - 1) * (config as SingleAxisConfig).nsSpacing}m</strong></div>
          </div>

          <SingleAxisRackSection
            rackSpec={rackSpec as SingleAxisRackSpec}
            onChange={handleRackChange}
          />
        </>
      )}
    </div>
  );
}

// ===== Spec Table =====

function SpecTable({ installation }: { installation: FieldInstallation }) {
  const { config, installationType } = installation;
  const spec = getEffectivePanelSpec(installation);
  const rack = getEffectiveRack(installation);
  const isSASpec = installationType === 'single_axis';
  const panels = installationType === 'pergola'
    ? generatePanels(config as PanelConfig)
    : isSASpec
    ? generateSingleAxisPanels(config as SingleAxisConfig)
    : generateSlopePanels(config as SlopeConfig);
  const totalPanels = (installationType === 'pergola' || isSASpec)
    ? (config as PanelConfig | SingleAxisConfig).colsEW * (config as PanelConfig | SingleAxisConfig).rowsNS
    : (config as SlopeConfig).colsAcross * (config as SlopeConfig).rowsDown;
  const area = totalPanels * config.panelWidth * config.panelDepth;
  const estKw = totalPanels * spec.wattage / 1000;
  const bb = computeBBox(panels.flatMap(p => p.corners));

  const rows: [string, string][] = isSASpec ? [
    ['パネル型番', spec.model],
    ['パネルメーカー', spec.maker || '—'],
    ['パネル寸法', `${spec.widthMm}×${spec.lengthMm}×${spec.thicknessMm} mm`],
    ['パネル出力', `${spec.wattage} W${spec.isBifacial ? ` (両面+${spec.bifacialGainPct}%)` : ''}`],
    ['パネル枚数', `${totalPanels} 枚`],
    ['総パネル面積', `${area.toFixed(1)} m²`],
    ['推定出力', `${estKw.toFixed(2)} kW`],
    ['柱高さ', `${(config as SingleAxisConfig).mountHeight} m`],
    ['傾斜角', `${(config as SingleAxisConfig).tiltAngle}°`],
    ['方位角', `${(config as SingleAxisConfig).facingAzimuth}°（${azLabel((config as SingleAxisConfig).facingAzimuth)}）`],
    ['EW間隔(C-C)', `${(config as SingleAxisConfig).ewSpacing} m`],
    ['NS柱ピッチ', `${(config as SingleAxisConfig).nsSpacing} m`],
    ['外形 幅×奥行', `${(bb.xMax - bb.xMin).toFixed(2)} × ${(bb.yMax - bb.yMin).toFixed(2)} m`],
    ['最高点', `${bb.zMax.toFixed(2)} m`],
    ['---架台---', ''],
    ['柱 外径×肉厚', `φ${(rack as SingleAxisRackSpec).postDiameterMm}×${(rack as SingleAxisRackSpec).postThicknessMm} mm`],
    ['柱 材質', (rack as SingleAxisRackSpec).postMaterial],
    ['クロスアーム', `${(rack as SingleAxisRackSpec).crossarmH}×${(rack as SingleAxisRackSpec).crossarmW} mm t=${(rack as SingleAxisRackSpec).crossarmT}`],
    ['パーリン', `${(rack as SingleAxisRackSpec).purlinH}×${(rack as SingleAxisRackSpec).purlinW} mm (${(rack as SingleAxisRackSpec).purlinPerBay}本)`],
    ['斜材', `φ${(rack as SingleAxisRackSpec).braceDiameterMm} (高さ比${(rack as SingleAxisRackSpec).braceH})`],
    ['基礎深さ', `${(rack as SingleAxisRackSpec).foundationDepthM} m`],
  ] : installationType === 'pergola' ? [
    ['パネル型番', spec.model],
    ['パネルメーカー', spec.maker || '—'],
    ['パネル寸法', `${spec.widthMm}×${spec.lengthMm}×${spec.thicknessMm} mm`],
    ['パネル出力', `${spec.wattage} W${spec.isBifacial ? ` (両面+${spec.bifacialGainPct}%)` : ''}`],
    ['パネル枚数', `${totalPanels} 枚`],
    ['総パネル面積', `${area.toFixed(1)} m²`],
    ['推定出力', `${estKw.toFixed(2)} kW`],
    ['架台高さ', `${(config as PanelConfig).mountHeight} m`],
    ['傾斜角', `${(config as PanelConfig).tiltAngle}°`],
    ['方位角', `${(config as PanelConfig).facingAzimuth}°（${azLabel((config as PanelConfig).facingAzimuth)}）`],
    ['EW間隔(C-C)', `${(config as PanelConfig).ewSpacing} m`],
    ['NS間隔(C-C)', `${(config as PanelConfig).nsSpacing} m`],
    ['外形 幅×奥行', `${(bb.xMax - bb.xMin).toFixed(2)} × ${(bb.yMax - bb.yMin).toFixed(2)} m`],
    ['最高点', `${bb.zMax.toFixed(2)} m`],
    ['---柱---', ''],
    ['柱 外径×肉厚', `φ${(rack as PergolaRackSpec).postDiameterMm}×${(rack as PergolaRackSpec).postThicknessMm} mm`],
    ['柱 材質', (rack as PergolaRackSpec).postMaterial],
    ['ヨコサン', `${(rack as PergolaRackSpec).yokosanH}×${(rack as PergolaRackSpec).yokosanW} mm t=${(rack as PergolaRackSpec).yokosanT}`],
    ['タテサン', `${(rack as PergolaRackSpec).tatesanH}×${(rack as PergolaRackSpec).tatesanW} mm (${(rack as PergolaRackSpec).tatesanPerSpan}本/スパン)`],
    ['基礎深さ', `${(rack as PergolaRackSpec).foundationDepthM} m`],
  ] : [
    ['パネル型番', spec.model],
    ['パネルメーカー', spec.maker || '—'],
    ['パネル寸法', `${spec.widthMm}×${spec.lengthMm}×${spec.thicknessMm} mm`],
    ['パネル出力', `${spec.wattage} W${spec.isBifacial ? ` (両面+${spec.bifacialGainPct}%)` : ''}`],
    ['パネル枚数', `${totalPanels} 枚`],
    ['総パネル面積', `${area.toFixed(1)} m²`],
    ['推定出力', `${estKw.toFixed(2)} kW`],
    ['法面傾斜角', `${(config as SlopeConfig).slopeAngle}°`],
    ['有効傾斜角', `${(config as SlopeConfig).slopeAngle + (config as SlopeConfig).additionalTilt}°`],
    ['方位角', `${(config as SlopeConfig).facingAzimuth}°（${azLabel((config as SlopeConfig).facingAzimuth)}）`],
    ['外形 幅×法長', `${(bb.xMax - bb.xMin).toFixed(2)} × ${(bb.yMax - bb.yMin).toFixed(2)} m`],
    ['最高点', `${bb.zMax.toFixed(2)} m`],
    ['---支柱---', ''],
    ['支柱 外径×肉厚', `φ${(rack as SlopeRackSpec).postDiameterMm}×${(rack as SlopeRackSpec).postThicknessMm} mm`],
    ['支柱 材質', (rack as SlopeRackSpec).postMaterial],
    ['縦桟', `${(rack as SlopeRackSpec).vertRailH}×${(rack as SlopeRackSpec).vertRailW} mm (${(rack as SlopeRackSpec).vertRailPerPanel}本/枚)`],
    ['基礎タイプ', (rack as SlopeRackSpec).foundationType === 'pile' ? `鋼管杭 φ${(rack as SlopeRackSpec).pileDiameterMm}` : (rack as SlopeRackSpec).foundationType],
    ['基礎深さ', `${(rack as SlopeRackSpec).foundationDepthM} m`],
  ];

  return (
    <div className="spec-table-wrap">
      <table className="spec-table">
        <tbody>
          {rows.map(([k, v]) => k.startsWith('---') ? (
            <tr key={k}><th colSpan={2} style={{ background: '#e8edf4', fontSize: 10, paddingTop: 6 }}>{k.replace(/---/g, '').trim()}</th></tr>
          ) : (
            <tr key={k}><th>{k}</th><td>{v}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ===== Utilities =====

function azLabel(az: number): string {
  const d = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
  return d[Math.round(az / 22.5) % 16];
}

// ===== Export Utilities =====

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function svgToCanvas(svgEl: SVGSVGElement, scale = 3): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const W = svgEl.clientWidth || 800, H = svgEl.clientHeight || 600;
    const svgStr = new XMLSerializer().serializeToString(svgEl);
    const url = URL.createObjectURL(new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = W * scale; c.height = H * scale;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.scale(scale, scale); ctx.drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(url); resolve(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG render failed')); };
    img.src = url;
  });
}

function buildMinimalPDF(jpegBytes: Uint8Array, imgW: number, imgH: number): Uint8Array {
  const B = (s: string) => new Uint8Array([...s].map(c => c.charCodeAt(0) & 0xFF));
  const chunks: Uint8Array[] = [];
  const off: number[] = [];
  let pos = 0;
  const wb = (b: Uint8Array) => { chunks.push(b); pos += b.length; };
  const t = (s: string) => wb(B(s));
  const pw = 1190.55, ph = 841.89, mg = 28.35; // A3横 pt
  const sc = Math.min((pw - 2 * mg) / imgW, (ph - 2 * mg) / imgH);
  const dw = (imgW * sc).toFixed(2), dh = (imgH * sc).toFixed(2);
  const ox = ((pw - imgW * sc) / 2).toFixed(2), oy = ((ph - imgH * sc) / 2).toFixed(2);
  const cnt = `q\n${dw} 0 0 ${dh} ${ox} ${oy} cm\n/Im0 Do\nQ\n`;
  t('%PDF-1.4\n%\xC2\xC3\xC4\xC5\n');
  off[1] = pos; t('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  off[2] = pos; t('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  off[3] = pos; t(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>\nendobj\n`);
  off[4] = pos; t(`4 0 obj\n<< /Length ${cnt.length} >>\nstream\n${cnt}endstream\nendobj\n`);
  off[5] = pos; t(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);
  wb(jpegBytes); t('\nendstream\nendobj\n');
  const xp = pos;
  t('xref\n0 6\n0000000000 65535 f \n');
  for (let i = 1; i <= 5; i++) t(`${String(off[i]).padStart(10, '0')} 00000 n \n`);
  t(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xp}\n%%EOF\n`);
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total); let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

async function exportAsPNG(svgEl: SVGSVGElement, filename: string) {
  const c = await svgToCanvas(svgEl, 3);
  c.toBlob(b => { if (b) downloadBlob(b, filename); }, 'image/png');
}

async function exportAsPDF(svgEl: SVGSVGElement, filename: string) {
  const c = await svgToCanvas(svgEl, 3);
  c.toBlob(async b => {
    if (!b) return;
    const buf = await b.arrayBuffer();
    const pdf = buildMinimalPDF(new Uint8Array(buf), c.width, c.height);
    downloadBlob(new Blob([pdf.buffer as ArrayBuffer], { type: 'application/pdf' }), filename);
  }, 'image/jpeg', 0.92);
}

function exportAsDXF(svgEl: SVGSVGElement, filename: string) {
  const lyr: Record<string, string> = {
    '#2b7dc7': 'POST', '#cc44aa': 'YOKOSAN', '#22aa33': 'TATESAN', '#8a6a20': 'BRACE',
    '#1e40af': 'PANEL', '#1d4ed8': 'PANEL', '#b45309': 'PANEL',
    '#68946a': 'GROUND', '#c53030': 'DIM', '#2563eb': 'DIM', '#555': 'DIM', '#555555': 'DIM',
    '#e07010': 'CUSTOM', '#e53e3e': 'CUSTOM', '#22aa34': 'CUSTOM',
  };
  const col: Record<string, number> = {
    '#2b7dc7': 5, '#cc44aa': 6, '#22aa33': 3, '#8a6a20': 2,
    '#1e40af': 5, '#1d4ed8': 5, '#b45309': 2, '#c53030': 1, '#2563eb': 5,
    '#e07010': 2, '#e53e3e': 1,
  };
  const lines: string[] = [
    '0\nSECTION', '2\nHEADER',
    '9\n$ACADVER', '1\nAC1009',
    '9\n$INSUNITS', '70\n4',
    '0\nENDSEC', '0\nSECTION', '2\nENTITIES',
  ];
  const addLn = (x1: number, y1: number, x2: number, y2: number, l: string, c: number) => {
    if (Math.hypot(x2 - x1, y2 - y1) < 1e-6) return;
    const s = 1000; // m → mm
    lines.push('0\nLINE', `8\n${l}`, `62\n${c}`,
      `10\n${(x1 * s).toFixed(1)}`, `20\n${(-y1 * s).toFixed(1)}`, '30\n0',
      `11\n${(x2 * s).toFixed(1)}`, `21\n${(-y2 * s).toFixed(1)}`, '31\n0');
  };
  for (const el of svgEl.querySelectorAll('line')) {
    if (el.getAttribute('stroke-dasharray')) continue;
    const g = (a: string) => parseFloat(el.getAttribute(a) ?? '0');
    const st = (el.getAttribute('stroke') ?? '#000').toLowerCase();
    addLn(g('x1'), g('y1'), g('x2'), g('y2'), lyr[st] ?? 'MISC', col[st] ?? 7);
  }
  for (const el of svgEl.querySelectorAll('polygon')) {
    const pts = (el.getAttribute('points') ?? '').trim().split(/\s+/)
      .map(p => p.split(',').map(Number)).filter(p => p.length === 2 && !isNaN(p[0]) && !isNaN(p[1]));
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      addLn(x1, y1, x2, y2, 'PANEL', 5);
    }
  }
  lines.push('0\nENDSEC', '0\nEOF');
  downloadBlob(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), filename);
}

// ===== Main DrawingView =====

export default function DrawingView({ installations, activeId, onInstallationChange, onClose }: Props) {
  const [viewId, setViewId] = useState(activeId);
  const [tab, setTab] = useState<DrawingTab>('3d');

  const installation = installations.find(i => i.id === viewId) ?? installations[0];

  const handleChange = useCallback(
    (patch: Partial<FieldInstallation>) => onInstallationChange(installation.id, patch),
    [installation.id, onInstallationChange]
  );

  const tabLabel = tab === 'plan' ? '平面図' : tab === 'elevation' ? '立面図' : tab === 'section' ? '断面図' : '3D';
  const exportBase = `${installation.name}_${tabLabel}`;

  const handleExportPNG = () => {
    if (tab === '3d') {
      const cv = document.querySelector('.three-mount canvas') as HTMLCanvasElement | null;
      if (cv) cv.toBlob(b => { if (b) downloadBlob(b, `${exportBase}.png`); });
      return;
    }
    const sv = document.querySelector('.drawing-svg') as SVGSVGElement | null;
    if (sv) exportAsPNG(sv, `${exportBase}.png`);
  };
  const handleExportPDF = () => {
    const sv = document.querySelector('.drawing-svg') as SVGSVGElement | null;
    if (sv) exportAsPDF(sv, `${exportBase}.pdf`);
  };
  const handleExportDXF = () => {
    const sv = document.querySelector('.drawing-svg') as SVGSVGElement | null;
    if (sv) exportAsDXF(sv, `${exportBase}.dxf`);
  };

  const tabs: [DrawingTab, string][] = [
    ['3d', '🏗 3Dビュー'],
    ['plan', '🗺 平面図'],
    ['elevation', '🏢 立面図'],
    ['section', '✂ 断面図'],
  ];

  return (
    <div className="drawing-modal">
      <div className="drawing-modal-inner">
        <div className="drawing-modal-header">
          <div className="drawing-header-left">
            <span className="drawing-header-icon">📐</span>
            <span className="drawing-header-title">図面・3Dビュー</span>
            <select
              className="dv-inst-select"
              value={viewId}
              onChange={e => setViewId(e.target.value)}
            >
              {installations.map(i => (
                <option key={i.id} value={i.id}>
                  {i.installationType === 'pergola' ? '🌿' : '⛰'} {i.name}
                </option>
              ))}
            </select>
          </div>
          <div className="drawing-header-right">
            <button className="btn-draw-action" onClick={handleExportPNG}>📷 PNG</button>
            {tab !== '3d' && <>
              <button className="btn-draw-action" onClick={handleExportPDF}>📄 PDF</button>
              <button className="btn-draw-action" title="DXF形式 / JW-CADで開けます" onClick={handleExportDXF}>📐 DXF</button>
            </>}
            <button className="btn-draw-action" onClick={() => window.print()}>🖨 印刷</button>
            <button className="btn-draw-close" onClick={onClose}>✕ 閉じる</button>
          </div>
        </div>

        <div className="drawing-main">
          <div className="drawing-area">
            <div className="drawing-tab-bar">
              {tabs.map(([id, label]) => (
                <button key={id}
                  className={`drawing-tab${tab === id ? ' active' : ''}`}
                  onClick={() => setTab(id)}>{label}</button>
              ))}
            </div>
            <div className="drawing-tab-content">
              {tab === '3d' && (
                <div className="drawing-3d-layout">
                  <ThreeViewer installation={installation} />
                  <div className="drawing-3d-spec"><SpecTable installation={installation} /></div>
                </div>
              )}
              {tab === 'plan' && <PlanView installation={installation} />}
              {tab === 'elevation' && <ElevationView installation={installation} onChange={handleChange} />}
              {tab === 'section' && <SectionView installation={installation} onChange={handleChange} />}
            </div>
          </div>
          <EditPanel installation={installation} onChange={handleChange} />
        </div>
      </div>
    </div>
  );
}
