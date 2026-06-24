import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FieldInstallation, PanelConfig, SlopeConfig, AnyConfig, PanelPolygon } from '../types';
import { generatePanels } from '../lib/panelGeometry';
import { generateSlopePanels } from '../lib/slopePanelGeometry';
import './DrawingView.css';

type DrawingTab = '3d' | 'plan' | 'elevation' | 'section';

interface Props {
  installations: FieldInstallation[];
  activeId: string;
  onInstallationChange: (id: string, patch: Partial<FieldInstallation>) => void;
  onClose: () => void;
}

// ===== Coordinate helpers =====

/**
 * Rotate ENU (x=East, y=North) by (azimuth-180°) CCW so the facing direction
 * maps to SVG "south" (down). This aligns panel rows horizontally in plan view.
 */
function rotatePlan(x: number, y: number, azDeg: number): [number, number] {
  const θ = (azDeg - 180) * Math.PI / 180;
  const c = Math.cos(θ), s = Math.sin(θ);
  return [x * c - y * s, x * s + y * c];
}

/** ENU (East=x, North=y, Up=z) → Three.js (x=East, y=Up, z=-North) */
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
  return inst.config.type === 'pergola'
    ? (inst.config as PanelConfig).facingAzimuth
    : (inst.config as SlopeConfig).facingAzimuth;
}

// ===== 3D Scene =====

function buildThreeScene(installation: FieldInstallation) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd0e6f5);
  scene.fog = new THREE.FogExp2(0xd0e6f5, 0.011);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xfff4d6, 1.0);
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
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x7a7068 });

  const panels: PanelPolygon[] = isP
    ? generatePanels(installation.config as PanelConfig)
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

  isP
    ? addPergolaStructure(scene, installation.config as PanelConfig, frameMat, panels)
    : addSlopeStructure(scene, installation.config as SlopeConfig, frameMat, panels);

  // North arrow
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.8, 8), arrowMat);
  body.position.set(-14, 0.45, 13.6);
  scene.add(body);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.45, 8), arrowMat);
  head.position.set(-14, 0.9, 13.0); // -z = north in Three.js
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
  scene: THREE.Scene, cfg: PanelConfig, mat: THREE.Material, panels: PanelPolygon[]
) {
  const bb = computeBBox(panels.flatMap(p => p.corners));
  const xMin = bb.xMin - 0.05, xMax = bb.xMax + 0.05;
  const yMin = bb.yMin - 0.05, yMax = bb.yMax + 0.05;
  const h = cfg.mountHeight;

  const postGeo = new THREE.CylinderGeometry(0.07, 0.08, h, 8);
  for (const [px, py] of [[xMin, yMin], [xMax, yMin], [xMin, yMax], [xMax, yMax]] as [number, number][]) {
    const m = new THREE.Mesh(postGeo, mat);
    m.position.set(px, h / 2, -py);
    scene.add(m);
  }

  // EW beams
  const ewGeo = new THREE.BoxGeometry(xMax - xMin + 0.12, 0.09, 0.07);
  for (const py of [yMin, yMax]) {
    const b = new THREE.Mesh(ewGeo, mat);
    b.position.set((xMin + xMax) / 2, h + 0.045, -py);
    scene.add(b);
  }
  // NS beams
  const nsGeo = new THREE.BoxGeometry(0.07, 0.09, yMax - yMin + 0.12);
  for (const px of [xMin, xMax]) {
    const b = new THREE.Mesh(nsGeo, mat);
    b.position.set(px, h + 0.045, -(yMin + yMax) / 2);
    scene.add(b);
  }
  // Intermediate NS purlins
  const purlinGeo = new THREE.BoxGeometry(xMax - xMin + 0.04, 0.05, 0.04);
  for (let row = 0; row < cfg.rowsNS; row++) {
    const py = (row - (cfg.rowsNS - 1) / 2) * cfg.nsSpacing;
    const p = new THREE.Mesh(purlinGeo, mat);
    p.position.set((xMin + xMax) / 2, h + 0.02, -py);
    scene.add(p);
  }
}

function addSlopeStructure(
  scene: THREE.Scene, cfg: SlopeConfig, frameMat: THREE.Material, panels: PanelPolygon[]
) {
  const { slopeAngle, facingAzimuth, rowsDown, downSpacing, colsAcross, acrossSpacing, panelWidth, baseMountHeight } = cfg;
  const slopeRad = slopeAngle * Math.PI / 180;
  const fRad = facingAzimuth * Math.PI / 180;
  const fwdE = Math.sin(fRad), fwdN = Math.cos(fRad);

  const slopeW = (colsAcross - 1) * acrossSpacing + panelWidth + 2;
  const slopeLen = rowsDown * downSpacing + 2;
  const slopeMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(slopeW, slopeLen),
    new THREE.MeshLambertMaterial({ color: 0xb8956a, side: THREE.DoubleSide })
  );
  const midR = (rowsDown - 1) / 2 * downSpacing;
  const scx = midR * Math.cos(slopeRad) * (-fwdE);
  const scy = midR * Math.cos(slopeRad) * (-fwdN);
  const scz = baseMountHeight + midR * Math.sin(slopeRad);
  slopeMesh.position.set(scx, scz, -scy);
  slopeMesh.rotation.order = 'YXZ';
  slopeMesh.rotation.y = -(facingAzimuth - 180) * Math.PI / 180;
  slopeMesh.rotation.x = -(Math.PI / 2 - slopeRad);
  scene.add(slopeMesh);

  const postGeo = new THREE.CylinderGeometry(0.03, 0.035, baseMountHeight + 0.18, 6);
  for (const panel of panels) {
    const cs = panel.corners;
    const px = cs.reduce((s, c) => s + c.x, 0) / 4;
    const py = cs.reduce((s, c) => s + c.y, 0) / 4;
    const pz = cs.reduce((s, c) => s + c.z, 0) / 4;
    const pm = new THREE.Mesh(postGeo, frameMat);
    pm.position.set(px, pz - (baseMountHeight + 0.18) / 2, -py);
    scene.add(pm);
  }
}

// ===== 3D Viewer =====

function ThreeViewer({ installation }: { installation: FieldInstallation }) {
  const mountRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const w = el.clientWidth || 600, h = el.clientHeight || 400;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
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

/**
 * Engineering dimension line between two SVG points.
 * offset: perpendicular distance for the dimension line.
 */
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

/** Small inner dimension annotation (placed inside a panel or between panels). */
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
      <text x={x} y={y + 0.48} textAnchor="start" fontSize="0.32" fill="#555" stroke="none">{`0`}</text>
      <text x={x + length} y={y + 0.48} textAnchor="end" fontSize="0.32" fill="#555" stroke="none">{`${length}m`}</text>
    </g>
  );
}

// ===== Plan View (平面図) =====

function PlanView({ installation }: { installation: FieldInstallation }) {
  const { config, installationType } = installation;
  const az = getAzimuth(installation);
  const panels = installationType === 'pergola'
    ? generatePanels(config as PanelConfig)
    : generateSlopePanels(config as SlopeConfig);

  // Rotate all panel corner XY coordinates by (az-180°) so facing dir = "south" (down)
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

  // SVG coordinate conversion: flip Y so rotated-north is up
  const sv = (rx: number, ry: number): [number, number] => [rx, -ry];

  // Panel colors
  const pFill = installationType === 'pergola' ? 'rgba(29,78,216,0.62)' : 'rgba(213,94,10,0.62)';
  const pStroke = installationType === 'pergola' ? '#1e40af' : '#b45309';

  // Panel center helper
  const center = (p: PanelPolygon) => {
    const [rx, ry] = rot(
      p.corners.reduce((s, c) => s + c.x, 0) / 4,
      p.corners.reduce((s, c) => s + c.y, 0) / 4,
    );
    return sv(rx, ry);
  };

  const colsCount = installationType === 'pergola'
    ? (config as PanelConfig).colsEW
    : (config as SlopeConfig).colsAcross;
  const rowsCount = installationType === 'pergola'
    ? (config as PanelConfig).rowsNS
    : (config as SlopeConfig).rowsDown;

  const totalPanels = colsCount * rowsCount;
  const area = totalPanels * config.panelWidth * config.panelDepth;

  // Compute spacing dimension points (between adjacent panel centers)
  const ewSpacing = installationType === 'pergola'
    ? (config as PanelConfig).ewSpacing
    : (config as SlopeConfig).acrossSpacing;
  const nsSpacing = installationType === 'pergola'
    ? (config as PanelConfig).nsSpacing
    : (config as SlopeConfig).downSpacing;

  // Panel 0 (col=0, row=0) and panel 1 (col=1, row=0) for EW spacing
  const c0 = colsCount > 1 ? center(panels[0]) : null;
  const c1 = colsCount > 1 ? center(panels[1]) : null;
  // Panel 0 (col=0, row=0) and panel at (col=0, row=1) for NS spacing
  const r0 = rowsCount > 1 ? center(panels[0]) : null;
  const r1 = rowsCount > 1 ? center(panels[colsCount]) : null;

  // First panel corners for panel-size dimension
  const fc = panels[0].corners.map(c => { const [rx, ry] = rot(c.x, c.y); return sv(rx, ry); });
  // Width edge: fc[3] → fc[2] (or fc[0] → fc[1] depending on orientation)
  // After rotation, corners are:
  //   fc[0]: upper end, rgt side (will be to the right in plan for az=180°)
  //   fc[1]: upper end, opposite rgt (left)
  //   fc[2]: lower end, left
  //   fc[3]: lower end, right
  // For az=180°: upper = north (top of SVG), lower = south (bottom)
  //   rgt = west (left in SVG), opposite rgt = east (right)
  // After rotation: panel's "rgt" direction aligns with -X in SVG (left)

  // The four sides of the first panel in the rotated plan:
  // Top edge: fc[0]–fc[1] (if fc[0] and fc[1] share the same y ≈ -ryMax)
  // Bottom edge: fc[3]–fc[2]
  // Right edge: fc[1]–fc[2]
  // Left edge: fc[0]–fc[3]

  // Width of panel = horizontal distance between fc[0] and fc[1] (top edge)
  const panelWidthLabel = `W=${config.panelWidth.toFixed(2)}m`;
  const depthLabel = `D=${config.panelDepth.toFixed(2)}m`;

  // The North arrow rotation: after plan rotation by (az-180°), north is at (180-az)° in SVG
  const northArrowRot = 180 - az;

  return (
    <div className="svg-drawing-wrap">
      <div className="drawing-info-bar">
        <span className="dv-label">平面図</span>
        <span>方位: {az}° ({azLabel(az)}) ／ {totalPanels}枚 ／ {area.toFixed(1)} m²</span>
        <span className="dv-note">※ 図面はパネル向き({azLabel(az)})を下方向に揃えて表示</span>
      </div>
      <svg viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`} className="drawing-svg" preserveAspectRatio="xMidYMid meet">
        <SvgDefs />

        {/* 1m grid */}
        {Array.from({ length: Math.ceil(vbW) + 2 }, (_, i) => Math.floor(vbX) + i).map(gx => (
          <line key={`gx${gx}`} x1={gx} y1={vbY} x2={gx} y2={vbY + vbH} stroke="#e8e8e8" strokeWidth="0.02" />
        ))}
        {Array.from({ length: Math.ceil(vbH) + 2 }, (_, i) => Math.floor(vbY) + i).map(gy => (
          <line key={`gy${gy}`} x1={vbX} y1={gy} x2={vbX + vbW} y2={gy} stroke="#e8e8e8" strokeWidth="0.02" />
        ))}

        {/* Support structure footprint (pergola posts) */}
        {installationType === 'pergola' && (() => {
          const pw = config.panelWidth * 0.1;
          return (
            <rect x={rxMin} y={-ryMax} width={rxMax - rxMin} height={ryMax - ryMin}
              fill="none" stroke="#c4a882" strokeWidth="0.06" strokeDasharray="0.2,0.15" />
          );
        })()}

        {/* Panels */}
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

        {/* Panel row/col index labels */}
        {installationType === 'pergola' && colsCount > 1 && rowsCount > 1 && (
          <>
            {Array.from({ length: colsCount }, (_, col) => {
              const [cx, cy] = center(panels[col]);
              return <text key={`col${col}`} x={cx} y={cy} textAnchor="middle" fontSize="0.28" fill="rgba(255,255,255,0.85)">{`C${col + 1}`}</text>;
            })}
          </>
        )}

        {/* Panel size dimensions (on first panel) */}
        <InnerDim
          x1={fc[0][0]} y1={fc[0][1]}
          x2={fc[1][0]} y2={fc[1][1]}
          label={panelWidthLabel} offset={0.2} fs={0.3}
        />
        <InnerDim
          x1={fc[1][0]} y1={fc[1][1]}
          x2={fc[2][0]} y2={fc[2][1]}
          label={depthLabel} offset={0.2} fs={0.3}
        />

        {/* EW spacing (between col 0 and col 1 centers) */}
        {c0 && c1 && (
          <DimLine
            x1={c0[0]} y1={ryMax + mg * 0.6 < 0 ? -(ryMax + mg * 0.6) : c0[1]}
            x2={c1[0]} y2={ryMax + mg * 0.6 < 0 ? -(ryMax + mg * 0.6) : c1[1]}
            offset={-(ryMax - ryMin) / 2 - 1.6}
            label={`@${ewSpacing}m`} color="#2563eb"
          />
        )}

        {/* NS spacing (between row 0 and row 1 centers) */}
        {r0 && r1 && (
          <DimLine
            x1={rxMax + mg * 0.55} y1={r0[1]}
            x2={rxMax + mg * 0.55} y2={r1[1]}
            offset={(rxMax - rxMin) / 2 + 1.6}
            label={installationType === 'pergola' ? `@${nsSpacing}m` : `@${nsSpacing}m(斜)` }
            color="#2563eb"
          />
        )}

        {/* Total width */}
        <DimLine
          x1={rxMin} y1={-(ryMin)} x2={rxMax} y2={-(ryMin)}
          offset={-1.8} label={`${(rxMax - rxMin).toFixed(2)} m`}
        />
        {/* Total depth */}
        <DimLine
          x1={rxMax} y1={-(ryMin)} x2={rxMax} y2={-(ryMax)}
          offset={1.8} label={`${(ryMax - ryMin).toFixed(2)} m`}
        />

        {/* Facing direction arrow */}
        <g opacity="0.6">
          <line x1={0} y1={-(ryMax) + 0.4} x2={0} y2={-(ryMax) + 1.6}
            stroke="#d97706" strokeWidth="0.12" markerEnd="url(#da)" />
          <text x={0} y={-(ryMax) + 2.2} textAnchor="middle" fontSize="0.32" fill="#d97706">↓ {azLabel(az)}</text>
        </g>

        {/* North arrow */}
        <NorthArrow cx={vbX + vbW - 1.2} cy={vbY + 1.2} r={0.88} rotateDeg={northArrowRot} />

        {/* Scale bar */}
        <ScaleBar x={vbX + 0.5} y={vbY + vbH - 0.8} length={5} />
      </svg>
    </div>
  );
}

// ===== Elevation View (正面図) — projection onto plane ⊥ to facing direction =====

function ElevationView({ installation }: { installation: FieldInstallation }) {
  const { config, installationType } = installation;
  const az = getAzimuth(installation);
  const fwdE = Math.sin(az * Math.PI / 180);
  const fwdN = Math.cos(az * Math.PI / 180);

  const panels = installationType === 'pergola'
    ? generatePanels(config as PanelConfig)
    : generateSlopePanels(config as SlopeConfig);

  // Project onto plane ⊥ to fwd:
  // svgX = viewer's right = (-fwdN, fwdE) dotted with (localX, localY)
  //      = -fwdN * x + fwdE * y
  // svgY = -localZ (up = top of SVG)
  const toSVG = (x: number, y: number, z: number): [number, number] => [
    -fwdN * x + fwdE * y,
    -z,
  ];

  let svgXMin = Infinity, svgXMax = -Infinity, svgYMin = Infinity, svgYMax = -Infinity;
  for (const p of panels) {
    for (const c of p.corners) {
      const [sx, sy] = toSVG(c.x, c.y, c.z);
      svgXMin = Math.min(svgXMin, sx); svgXMax = Math.max(svgXMax, sx);
      svgYMin = Math.min(svgYMin, sy); svgYMax = Math.max(svgYMax, sy);
    }
  }
  // Include ground (z=0)
  svgYMax = Math.max(svgYMax, 0);

  const mg = 2.5;
  const vbX = svgXMin - mg, vbY = svgYMin - mg;
  const vbW = svgXMax - svgXMin + 2 * mg, vbH = svgYMax - svgYMin + 2 * mg;

  const mountH = installationType === 'pergola'
    ? (config as PanelConfig).mountHeight
    : (config as SlopeConfig).baseMountHeight;

  const pFill = installationType === 'pergola' ? 'rgba(29,78,216,0.65)' : 'rgba(213,94,10,0.65)';
  const pStroke = installationType === 'pergola' ? '#1e40af' : '#b45309';

  return (
    <div className="svg-drawing-wrap">
      <div className="drawing-info-bar">
        <span className="dv-label">正面図（{azLabel(az)}面から）</span>
        <span>{installation.name}</span>
        <span>設置高さ {mountH.toFixed(1)} m ／ 方位 {az}°</span>
      </div>
      <svg viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`} className="drawing-svg" preserveAspectRatio="xMidYMid meet">
        <SvgDefs />

        {/* Ground */}
        <rect x={vbX} y={0} width={vbW} height={mg} fill="rgba(104,148,106,0.2)" />
        <line x1={vbX} y1={0} x2={vbX + vbW} y2={0} stroke="#68946a" strokeWidth="0.08" />

        {/* Pergola support: posts + beams in elevation */}
        {installationType === 'pergola' && (() => {
          const h = (config as PanelConfig).mountHeight;
          return (
            <>
              <line x1={svgXMin} y1={0} x2={svgXMin} y2={-h} stroke="#7a7068" strokeWidth="0.1" />
              <line x1={svgXMax} y1={0} x2={svgXMax} y2={-h} stroke="#7a7068" strokeWidth="0.1" />
              <line x1={svgXMin} y1={-h} x2={svgXMax} y2={-h} stroke="#7a7068" strokeWidth="0.07" />
              {/* Intermediate purlins */}
              {Array.from({ length: (config as PanelConfig).rowsNS }, (_, row) => {
                const py = (row - ((config as PanelConfig).rowsNS - 1) / 2) * (config as PanelConfig).nsSpacing;
                const [sx] = toSVG(0, py, 0);
                return <line key={row} x1={svgXMin} y1={-h} x2={svgXMax} y2={-h} stroke="#9a9080" strokeWidth="0.04" />;
              })}
              <DimLine x1={svgXMin} y1={0} x2={svgXMin} y2={-h} offset={-1.4}
                label={`${h.toFixed(2)} m`} color="#c53030" />
            </>
          );
        })()}

        {/* Slope support: base height dimension */}
        {installationType === 'slope' && mountH > 0 && (
          <DimLine x1={svgXMin} y1={0} x2={svgXMin} y2={-mountH} offset={-1.4}
            label={`基礎 ${mountH.toFixed(2)} m`} color="#c53030" />
        )}

        {/* Panels */}
        {panels.map(panel => (
          <polygon key={panel.panelIndex}
            points={panel.corners.map(c => { const [sx, sy] = toSVG(c.x, c.y, c.z); return `${sx},${sy}`; }).join(' ')}
            fill={pFill} stroke={pStroke} strokeWidth="0.045" />
        ))}

        {/* Width dimension */}
        <DimLine
          x1={svgXMin} y1={svgYMin - 0.3} x2={svgXMax} y2={svgYMin - 0.3}
          offset={-1.3} label={`${(svgXMax - svgXMin).toFixed(2)} m`}
        />
        {/* Height dimension */}
        <DimLine
          x1={svgXMax} y1={0} x2={svgXMax} y2={svgYMin}
          offset={1.3} label={`${(-svgYMin).toFixed(2)} m`}
        />
        {/* Tilt angle annotation for elevation */}
        {installationType === 'pergola' && (() => {
          const tilt = (config as PanelConfig).tiltAngle;
          return <text x={svgXMin + 0.2} y={svgYMin + 0.6} fontSize="0.38" fill="#e07010">{tilt}° 傾斜</text>;
        })()}
      </svg>
    </div>
  );
}

// ===== Section View (断面図) =====

function SectionView({ installation }: { installation: FieldInstallation }) {
  const { config, installationType } = installation;
  const az = getAzimuth(installation);
  const fwdE = Math.sin(az * Math.PI / 180);
  const fwdN = Math.cos(az * Math.PI / 180);

  const panels = installationType === 'pergola'
    ? generatePanels(config as PanelConfig)
    : generateSlopePanels(config as SlopeConfig);

  const colsCount = installationType === 'pergola'
    ? (config as PanelConfig).colsEW
    : (config as SlopeConfig).colsAcross;
  const centerColIdx = Math.floor(colsCount / 2);
  const sectionPanels = panels.filter((_, i) => i % colsCount === centerColIdx);

  const mountH = installationType === 'pergola'
    ? (config as PanelConfig).mountHeight
    : (config as SlopeConfig).baseMountHeight;
  const slopeAngle = installationType === 'slope' ? (config as SlopeConfig).slopeAngle : 0;
  const effTilt = installationType === 'pergola'
    ? (config as PanelConfig).tiltAngle
    : slopeAngle + (config as SlopeConfig).additionalTilt;
  const nsSpacing = installationType === 'pergola'
    ? (config as PanelConfig).nsSpacing
    : (config as SlopeConfig).downSpacing;
  const downSpacing = installationType === 'slope' ? (config as SlopeConfig).downSpacing : 0;

  // Section projection: along facing direction (fwd) and up
  // svgX = fwdE * x + fwdN * y (depth along facing direction, positive = "south")
  // svgY = -z (up)
  const toSVG = (x: number, y: number, z: number): [number, number] => [
    fwdE * x + fwdN * y,
    -z,
  ];

  let svgXMin = Infinity, svgXMax = -Infinity, svgYMin = Infinity, svgYMax = 0;
  for (const p of sectionPanels) {
    for (const c of p.corners) {
      const [sx, sy] = toSVG(c.x, c.y, c.z);
      svgXMin = Math.min(svgXMin, sx); svgXMax = Math.max(svgXMax, sx);
      svgYMin = Math.min(svgYMin, sy);
    }
  }

  const mg = 3;
  const vbX = svgXMin - mg, vbY = svgYMin - mg;
  const vbW = svgXMax - svgXMin + 2 * mg, vbH = svgYMax - svgYMin + 2 * mg;

  const pFill = installationType === 'pergola' ? 'rgba(29,78,216,0.72)' : 'rgba(213,94,10,0.72)';
  const pStroke = installationType === 'pergola' ? '#1e40af' : '#b45309';

  // Tilt angle arc at lowest corner of first section panel
  let arcEl: React.ReactElement | null = null;
  if (sectionPanels.length > 0) {
    const lc = sectionPanels[0].corners.reduce((a, b) => (a.z < b.z ? a : b));
    const hc = sectionPanels[0].corners.reduce((a, b) => (a.z > b.z ? a : b));
    const [lcx, lcy] = toSVG(lc.x, lc.y, lc.z);
    const [hcx, hcy] = toSVG(hc.x, hc.y, hc.z);
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
      </div>
      <svg viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`} className="drawing-svg" preserveAspectRatio="xMidYMid meet">
        <SvgDefs />

        {/* Ground / Slope surface */}
        {installationType === 'slope' ? (() => {
          const slopeRad = slopeAngle * Math.PI / 180;
          const xRange = svgXMax - svgXMin;
          return (
            <>
              <path
                d={`M ${svgXMin - 0.5} 0 L ${svgXMax + 0.5} ${-(xRange + 1) * Math.tan(slopeRad)} L ${svgXMax + 0.5} ${mg * 0.7} L ${svgXMin - 0.5} ${mg * 0.7} Z`}
                fill="rgba(184,149,106,0.25)" />
              <line x1={svgXMin - 0.5} y1={0}
                x2={svgXMax + 0.5} y2={-(xRange + 1) * Math.tan(slopeRad)}
                stroke="#b8956a" strokeWidth="0.12" />
              {/* Slope angle arc */}
              {(() => {
                const ar = 1.8;
                return (
                  <g>
                    <line x1={svgXMin - 0.3} y1={0} x2={svgXMin - 0.3 + ar * 1.5} y2={0}
                      stroke="#888" strokeWidth="0.05" strokeDasharray="0.15,0.1" />
                    <path d={`M ${svgXMin - 0.3 + ar} 0 A ${ar} ${ar} 0 0 0 ${svgXMin - 0.3 + ar * Math.cos(slopeRad)} ${-ar * Math.sin(slopeRad)}`}
                      stroke="#888" strokeWidth="0.07" fill="none" />
                    <text x={svgXMin - 0.3 + ar + 0.1} y={-ar * 0.38} fontSize="0.38" fill="#666">{slopeAngle}°</text>
                  </g>
                );
              })()}
            </>
          );
        })() : (
          <>
            <rect x={vbX} y={0} width={vbW} height={mg} fill="rgba(104,148,106,0.2)" />
            <line x1={vbX} y1={0} x2={vbX + vbW} y2={0} stroke="#68946a" strokeWidth="0.08" />
          </>
        )}

        {/* Pergola posts in section */}
        {installationType === 'pergola' && (() => {
          const h = (config as PanelConfig).mountHeight;
          const [x0] = toSVG(0, (panels[0].corners[3].y + panels[0].corners[2].y) / 2, 0);
          const [x1] = toSVG(0, (panels[0].corners[0].y + panels[0].corners[1].y) / 2, 0);
          return (
            <>
              <line x1={x0} y1={0} x2={x0} y2={-h} stroke="#7a7068" strokeWidth="0.09" />
              <line x1={x1} y1={0} x2={x1} y2={-h} stroke="#7a7068" strokeWidth="0.09" />
              <line x1={svgXMin} y1={-h} x2={svgXMax} y2={-h} stroke="#7a7068" strokeWidth="0.07" />
              <DimLine x1={svgXMin} y1={0} x2={svgXMin} y2={-h} offset={-1.4}
                label={`${h.toFixed(2)} m`} color="#c53030" />
            </>
          );
        })()}

        {/* Slope base mount dimension */}
        {installationType === 'slope' && mountH > 0 && (
          <DimLine x1={svgXMin} y1={0} x2={svgXMin} y2={-mountH} offset={-1.4}
            label={`基礎 ${mountH.toFixed(2)} m`} color="#c53030" />
        )}

        {/* Section panels */}
        {sectionPanels.map(panel => (
          <polygon key={panel.panelIndex}
            points={panel.corners.map(c => { const [sx, sy] = toSVG(c.x, c.y, c.z); return `${sx},${sy}`; }).join(' ')}
            fill={pFill} stroke={pStroke} strokeWidth="0.055" />
        ))}

        {/* Panel spacing dimension (NS/down direction) */}
        {sectionPanels.length > 1 && (() => {
          const [c0x, c0y] = toSVG(
            sectionPanels[0].corners.reduce((s,c) => s+c.x,0)/4,
            sectionPanels[0].corners.reduce((s,c) => s+c.y,0)/4,
            sectionPanels[0].corners.reduce((s,c) => s+c.z,0)/4,
          );
          const [c1x, c1y] = toSVG(
            sectionPanels[1].corners.reduce((s,c) => s+c.x,0)/4,
            sectionPanels[1].corners.reduce((s,c) => s+c.y,0)/4,
            sectionPanels[1].corners.reduce((s,c) => s+c.z,0)/4,
          );
          const spacingLabel = installationType === 'pergola'
            ? `@${nsSpacing}m`
            : `@${downSpacing}m(斜)`;
          return (
            <DimLine x1={c0x} y1={c0y} x2={c1x} y2={c1y}
              offset={-1.2} label={spacingLabel} color="#2563eb" />
          );
        })()}

        {/* Tilt arc */}
        {arcEl}

        {/* Depth and height dimensions */}
        <DimLine
          x1={svgXMin} y1={svgYMin - 0.3} x2={svgXMax} y2={svgYMin - 0.3}
          offset={-1.3} label={`${(svgXMax - svgXMin).toFixed(2)} m`}
        />
        <DimLine
          x1={svgXMax} y1={0} x2={svgXMax} y2={svgYMin}
          offset={1.3} label={`${(-svgYMin).toFixed(2)} m`}
        />
      </svg>
    </div>
  );
}

// ===== Edit Panel =====

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

  return (
    <div className="dv-edit-panel">
      <div className="dv-edit-header">
        <span className={`dv-type-chip ${installationType}`}>
          {installationType === 'pergola' ? '藤棚型' : '法面型'}
        </span>
        <span className="dv-edit-inst-name">{installation.name}</span>
      </div>

      {installationType === 'pergola' && (
        <>
          <div className="dv-section-title">📐 架台設計</div>
          <DVNumInput label="架台高さ" value={(config as PanelConfig).mountHeight} onChange={v => upd({ mountHeight: v })} unit="m" min={0.3} max={15} step={0.1} />
          <DVNumInput label="傾斜角" value={(config as PanelConfig).tiltAngle} onChange={v => upd({ tiltAngle: v })} unit="°" min={0} max={60} step={1} />
          <DVNumInput label="方位角" value={(config as PanelConfig).facingAzimuth} onChange={v => upd({ facingAzimuth: v })} unit="°" min={0} max={360} step={1} />
          <DVNumInput label="架台回転" value={(config as PanelConfig).rackRotation} onChange={v => upd({ rackRotation: v })} unit="°" min={-90} max={90} step={1} />

          <div className="dv-section-title">☀️ パネル配置</div>
          <DVNumInput label="EW列数" value={(config as PanelConfig).colsEW} onChange={v => upd({ colsEW: Math.max(1, Math.round(v)) })} unit="列" min={1} max={30} step={1} />
          <DVNumInput label="NS行数" value={(config as PanelConfig).rowsNS} onChange={v => upd({ rowsNS: Math.max(1, Math.round(v)) })} unit="行" min={1} max={30} step={1} />
          <DVNumInput label="EW間隔(C-C)" value={(config as PanelConfig).ewSpacing} onChange={v => upd({ ewSpacing: v })} unit="m" min={0.5} max={10} step={0.05} />
          <DVNumInput label="NS間隔(C-C)" value={(config as PanelConfig).nsSpacing} onChange={v => upd({ nsSpacing: v })} unit="m" min={0.5} max={15} step={0.05} />

          <div className="dv-section-title">🔲 パネル寸法</div>
          <DVNumInput label="幅 W" value={config.panelWidth} onChange={v => upd({ panelWidth: v })} unit="m" min={0.1} max={4} step={0.05} />
          <DVNumInput label="奥行 D" value={config.panelDepth} onChange={v => upd({ panelDepth: v })} unit="m" min={0.1} max={6} step={0.05} />

          <div className="dv-calc-box">
            <div>EW架台幅: <strong>{((config as PanelConfig).colsEW * (config as PanelConfig).ewSpacing).toFixed(2)} m</strong></div>
            <div>NS架台奥: <strong>{((config as PanelConfig).rowsNS * (config as PanelConfig).nsSpacing).toFixed(2)} m</strong></div>
            <div>最高点: <strong>{((config as PanelConfig).mountHeight + config.panelDepth / 2 * Math.sin((config as PanelConfig).tiltAngle * Math.PI / 180)).toFixed(2)} m</strong></div>
            <div>パネル間隔: <strong>{((config as PanelConfig).ewSpacing - config.panelWidth).toFixed(2)} m</strong></div>
          </div>
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

          <div className="dv-section-title">🔲 パネル寸法</div>
          <DVNumInput label="幅 W" value={config.panelWidth} onChange={v => upd({ panelWidth: v })} unit="m" min={0.1} max={4} step={0.05} />
          <DVNumInput label="奥行 D" value={config.panelDepth} onChange={v => upd({ panelDepth: v })} unit="m" min={0.1} max={6} step={0.05} />

          <div className="dv-calc-box">
            <div>有効傾斜: <strong>{(config as SlopeConfig).slopeAngle + (config as SlopeConfig).additionalTilt}°</strong></div>
            <div>横幅: <strong>{((config as SlopeConfig).colsAcross * (config as SlopeConfig).acrossSpacing).toFixed(2)} m</strong></div>
            <div>法面高さ: <strong>{((config as SlopeConfig).rowsDown * (config as SlopeConfig).downSpacing * Math.sin((config as SlopeConfig).slopeAngle * Math.PI / 180)).toFixed(2)} m</strong></div>
            <div>水平投影: <strong>{((config as SlopeConfig).rowsDown * (config as SlopeConfig).downSpacing * Math.cos((config as SlopeConfig).slopeAngle * Math.PI / 180)).toFixed(2)} m</strong></div>
          </div>
        </>
      )}
    </div>
  );
}

// ===== Spec Table =====

function SpecTable({ installation }: { installation: FieldInstallation }) {
  const { config, installationType } = installation;
  const panels = installationType === 'pergola'
    ? generatePanels(config as PanelConfig)
    : generateSlopePanels(config as SlopeConfig);
  const totalPanels = installationType === 'pergola'
    ? (config as PanelConfig).colsEW * (config as PanelConfig).rowsNS
    : (config as SlopeConfig).colsAcross * (config as SlopeConfig).rowsDown;
  const area = totalPanels * config.panelWidth * config.panelDepth;
  const estKw = area * 220 / 1000;
  const bb = computeBBox(panels.flatMap(p => p.corners));

  const rows: [string, string][] = installationType === 'pergola' ? [
    ['設置タイプ', '藤棚型（パーゴラ）'],
    ['パネル配置', `${(config as PanelConfig).colsEW}列 × ${(config as PanelConfig).rowsNS}行`],
    ['パネル枚数', `${totalPanels} 枚`],
    ['パネル寸法', `${config.panelWidth} × ${config.panelDepth} m`],
    ['総パネル面積', `${area.toFixed(1)} m²`],
    ['推定発電量', `${estKw.toFixed(1)} kW`],
    ['架台高さ', `${(config as PanelConfig).mountHeight} m`],
    ['傾斜角', `${(config as PanelConfig).tiltAngle}°`],
    ['方位角', `${(config as PanelConfig).facingAzimuth}°（${azLabel((config as PanelConfig).facingAzimuth)}）`],
    ['EW間隔(C-C)', `${(config as PanelConfig).ewSpacing} m`],
    ['NS間隔(C-C)', `${(config as PanelConfig).nsSpacing} m`],
    ['パネル間隔(EW)', `${((config as PanelConfig).ewSpacing - config.panelWidth).toFixed(2)} m`],
    ['外形 幅×奥行', `${(bb.xMax - bb.xMin).toFixed(2)} × ${(bb.yMax - bb.yMin).toFixed(2)} m`],
    ['最高点', `${bb.zMax.toFixed(2)} m`],
  ] : [
    ['設置タイプ', '法面型（野立て）'],
    ['パネル配置', `${(config as SlopeConfig).colsAcross}列 × ${(config as SlopeConfig).rowsDown}段`],
    ['パネル枚数', `${totalPanels} 枚`],
    ['パネル寸法', `${config.panelWidth} × ${config.panelDepth} m`],
    ['総パネル面積', `${area.toFixed(1)} m²`],
    ['推定発電量', `${estKw.toFixed(1)} kW`],
    ['法面傾斜角', `${(config as SlopeConfig).slopeAngle}°`],
    ['追加傾斜', `${(config as SlopeConfig).additionalTilt}°`],
    ['有効傾斜角', `${(config as SlopeConfig).slopeAngle + (config as SlopeConfig).additionalTilt}°`],
    ['方位角', `${(config as SlopeConfig).facingAzimuth}°（${azLabel((config as SlopeConfig).facingAzimuth)}）`],
    ['横間隔(C-C)', `${(config as SlopeConfig).acrossSpacing} m`],
    ['縦間隔(斜面)', `${(config as SlopeConfig).downSpacing} m`],
    ['基礎高さ', `${(config as SlopeConfig).baseMountHeight} m`],
    ['外形 幅×法長', `${(bb.xMax - bb.xMin).toFixed(2)} × ${(bb.yMax - bb.yMin).toFixed(2)} m`],
    ['最高点', `${bb.zMax.toFixed(2)} m`],
  ];

  return (
    <div className="spec-table-wrap">
      <table className="spec-table">
        <tbody>
          {rows.map(([k, v]) => (
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

// ===== Main DrawingView =====

export default function DrawingView({ installations, activeId, onInstallationChange, onClose }: Props) {
  const [viewId, setViewId] = useState(activeId);
  const [tab, setTab] = useState<DrawingTab>('3d');

  const installation = installations.find(i => i.id === viewId) ?? installations[0];

  const handleChange = useCallback(
    (patch: Partial<FieldInstallation>) => onInstallationChange(installation.id, patch),
    [installation.id, onInstallationChange]
  );

  const tabs: [DrawingTab, string][] = [
    ['3d', '🏗 3Dビュー'],
    ['plan', '🗺 平面図'],
    ['elevation', '🏢 正面図'],
    ['section', '✂ 断面図'],
  ];

  return (
    <div className="drawing-modal">
      <div className="drawing-modal-inner">
        {/* Header */}
        <div className="drawing-modal-header">
          <div className="drawing-header-left">
            <span className="drawing-header-icon">📐</span>
            <span className="drawing-header-title">図面・3Dビュー</span>
            {/* Installation switcher */}
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
            <button className="btn-draw-action" onClick={() => window.print()}>🖨 印刷</button>
            <button className="btn-draw-close" onClick={onClose}>✕ 閉じる</button>
          </div>
        </div>

        {/* Main layout: drawing area (left/center) + edit panel (right) */}
        <div className="drawing-main">
          {/* Drawing area */}
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
              {tab === 'elevation' && <ElevationView installation={installation} />}
              {tab === 'section' && <SectionView installation={installation} />}
            </div>
          </div>

          {/* Right: parameter edit panel */}
          <EditPanel installation={installation} onChange={handleChange} />
        </div>
      </div>
    </div>
  );
}
