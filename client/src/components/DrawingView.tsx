import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FieldInstallation, PanelConfig, SlopeConfig, PanelPolygon } from '../types';
import { generatePanels } from '../lib/panelGeometry';
import { generateSlopePanels } from '../lib/slopePanelGeometry';
import './DrawingView.css';

type DrawingTab = '3d' | 'plan' | 'elevation' | 'section';

interface Props {
  installation: FieldInstallation;
  onClose: () => void;
}

// ===== Coordinate helpers =====

// ENU (East=x, North=y, Up=z) → Three.js (x=East, y=Up, z=-North)
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

// ===== 3D Scene =====

function buildThreeScene(installation: FieldInstallation) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd6e8f5);
  scene.fog = new THREE.FogExp2(0xd6e8f5, 0.012);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xfff9e0, 1.0);
  sun.position.set(-8, 18, 6);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xcce4ff, 0.3);
  fill.position.set(10, 5, -8);
  scene.add(fill);

  // Ground
  const groundGeo = new THREE.PlaneGeometry(80, 80);
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ color: 0x6e9e6a }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const grid = new THREE.GridHelper(40, 40, 0x6b8c6b, 0x8faa8c);
  grid.position.y = 0.01;
  scene.add(grid);

  // Panel material
  const panelMat = new THREE.MeshPhongMaterial({
    color: installation.installationType === 'pergola' ? 0x1d4ed8 : 0xd45e0a,
    specular: 0x224499,
    shininess: 50,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
  });
  const edgeMat = new THREE.LineBasicMaterial({ color: installation.installationType === 'pergola' ? 0x1e3a8a : 0x9a3412 });
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x78716c });

  const panels: PanelPolygon[] = installation.installationType === 'pergola'
    ? generatePanels(installation.config as PanelConfig)
    : generateSlopePanels(installation.config as SlopeConfig);

  // Add panel meshes from corner geometry
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

    const edgeGeo = new THREE.BufferGeometry().setFromPoints([...pts, pts[0]]);
    scene.add(new THREE.Line(edgeGeo, edgeMat));
  }

  if (installation.installationType === 'pergola') {
    addPergolaStructure(scene, installation.config as PanelConfig, frameMat, panels);
  } else {
    addSlopeStructure(scene, installation.config as SlopeConfig, frameMat, panels);
  }

  // North compass arrow
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
  const bodyMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.8, 8), arrowMat);
  bodyMesh.position.set(-14, 0.45, 14);
  scene.add(bodyMesh);
  const headMesh = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.45, 8), arrowMat);
  headMesh.position.set(-14, 0.9, 14);
  scene.add(headMesh);
  // N: arrow points toward -z in Three.js = north in ENU
  headMesh.position.set(-14, 0.9, 13); // slightly north

  // Camera
  const allCorners = panels.flatMap(p => p.corners);
  const bb = computeBBox(allCorners);
  const cx = (bb.xMin + bb.xMax) / 2;
  const cy = (bb.yMin + bb.yMax) / 2;
  const cz = (bb.zMin + bb.zMax) / 2;
  const span = Math.max(bb.xMax - bb.xMin, bb.yMax - bb.yMin, bb.zMax - bb.zMin, 4);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
  // Three.js center: (cx, cz, -cy)
  const threeCx = cx, threeCy = cz + 1, threeCz = -cy;
  camera.position.set(threeCx + span * 1.2, threeCy + span * 0.9, threeCz + span * 1.4);
  camera.lookAt(threeCx, threeCy, threeCz);

  const buildControls = (domEl: HTMLElement): OrbitControls => {
    const ctrl = new OrbitControls(camera, domEl);
    ctrl.enableDamping = true;
    ctrl.dampingFactor = 0.08;
    ctrl.target.set(threeCx, threeCy, threeCz);
    ctrl.update();
    return ctrl;
  };

  return { scene, camera, buildControls };
}

function addPergolaStructure(
  scene: THREE.Scene,
  cfg: PanelConfig,
  mat: THREE.Material,
  panels: PanelPolygon[]
) {
  const { mountHeight, tiltAngle, panelWidth, panelDepth } = cfg;
  const depthH = panelDepth * Math.cos(tiltAngle * Math.PI / 180);

  const allCorners = panels.flatMap(p => p.corners);
  const bb = computeBBox(allCorners);
  const xMin = bb.xMin - panelWidth * 0.1;
  const xMax = bb.xMax + panelWidth * 0.1;
  const yMin = bb.yMin - depthH * 0.1;
  const yMax = bb.yMax + depthH * 0.1;

  const postR = 0.07;
  const postGeo = new THREE.CylinderGeometry(postR, postR * 1.1, mountHeight, 8);

  // Four corner posts (ENU → Three.js: (x, y, -localY))
  for (const [px, py] of [[xMin, yMin], [xMax, yMin], [xMin, yMax], [xMax, yMax]] as [number, number][]) {
    const post = new THREE.Mesh(postGeo, mat);
    post.position.set(px, mountHeight / 2, -py);
    scene.add(post);
  }

  // Top perimeter beams
  const ewBeam = new THREE.Mesh(
    new THREE.BoxGeometry(xMax - xMin + 0.1, 0.08, 0.06),
    mat
  );
  for (const py of [yMin, yMax]) {
    const b = ewBeam.clone();
    b.position.set((xMin + xMax) / 2, mountHeight + 0.04, -py);
    scene.add(b);
  }
  const nsBeam = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.08, yMax - yMin + 0.1),
    mat
  );
  for (const px of [xMin, xMax]) {
    const b = nsBeam.clone();
    b.position.set(px, mountHeight + 0.04, -(yMin + yMax) / 2);
    scene.add(b);
  }
}

function addSlopeStructure(
  scene: THREE.Scene,
  cfg: SlopeConfig,
  frameMat: THREE.Material,
  panels: PanelPolygon[]
) {
  const { slopeAngle, facingAzimuth, colsAcross, acrossSpacing, panelWidth, rowsDown, downSpacing, baseMountHeight } = cfg;
  const slopeRad = slopeAngle * Math.PI / 180;

  // Slope surface plane
  const rgtE = Math.cos(facingAzimuth * Math.PI / 180);
  const rgtN = -Math.sin(facingAzimuth * Math.PI / 180);
  const slopeW = (colsAcross - 1) * acrossSpacing + panelWidth + 2;
  const slopeLen = rowsDown * downSpacing + 2;

  const slopeMat = new THREE.MeshLambertMaterial({ color: 0xb8956a, side: THREE.DoubleSide });
  const slopeGeo = new THREE.PlaneGeometry(slopeW, slopeLen);
  const slopeMesh = new THREE.Mesh(slopeGeo, slopeMat);

  // Center of slope in ENU
  const midRowHoriz = (rowsDown - 1) / 2 * downSpacing * Math.cos(slopeRad);
  const midRowHeight = baseMountHeight + (rowsDown - 1) / 2 * downSpacing * Math.sin(slopeRad);
  const fwdE = Math.sin(facingAzimuth * Math.PI / 180);
  const fwdN = Math.cos(facingAzimuth * Math.PI / 180);
  const scx = midRowHoriz * (-fwdE);
  const scy = midRowHoriz * (-fwdN);
  const scz = midRowHeight;

  slopeMesh.position.set(scx, scz, -scy);
  // Rotate: align slope surface
  slopeMesh.rotation.order = 'YXZ';
  slopeMesh.rotation.y = -(facingAzimuth - 180) * Math.PI / 180;
  slopeMesh.rotation.x = -(Math.PI / 2 - slopeRad);
  scene.add(slopeMesh);

  // Short mount posts under each panel
  const postGeo = new THREE.CylinderGeometry(0.028, 0.034, baseMountHeight + 0.15, 6);
  for (const panel of panels) {
    const cs = panel.corners;
    const pcx = cs.reduce((s, c) => s + c.x, 0) / 4;
    const pcy = cs.reduce((s, c) => s + c.y, 0) / 4;
    const pcz = cs.reduce((s, c) => s + c.z, 0) / 4;
    const ph = baseMountHeight + 0.15;
    const post = new THREE.Mesh(postGeo, frameMat);
    post.position.set(pcx, pcz - ph / 2, -pcy);
    scene.add(post);
  }
}

// ===== 3D Viewer Component =====

function ThreeViewer({ installation }: { installation: FieldInstallation }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const w = el.clientWidth || 800;
    const h = el.clientHeight || 500;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    el.appendChild(renderer.domElement);

    const { scene, camera, buildControls } = buildThreeScene(installation);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    const controls = buildControls(renderer.domElement);
    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!mountRef.current) return;
      const nw = mountRef.current.clientWidth;
      const nh = mountRef.current.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    const ro = new ResizeObserver(onResize);
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
      <div className="three-hint">ドラッグ: 回転 ／ スクロール: ズーム ／ 右ドラッグ: 平行移動</div>
    </div>
  );
}

// ===== SVG Drawing Helpers =====

function SvgDefs() {
  return (
    <defs>
      <marker id="da" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto-start-reverse">
        <path d="M 0 0.5 L 3.5 2 L 0 3.5 Z" fill="#555" />
      </marker>
    </defs>
  );
}

function DimLine({
  x1, y1, x2, y2, offset, label, fs = 0.38,
}: {
  x1: number; y1: number; x2: number; y2: number;
  offset: number; label: string; fs?: number;
}) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.01) return null;
  const nx = (-dy / len) * offset;
  const ny = (dx / len) * offset;
  const p1x = x1 + nx, p1y = y1 + ny;
  const p2x = x2 + nx, p2y = y2 + ny;
  const mx = (p1x + p2x) / 2;
  const my = (p1y + p2y) / 2;
  // rotate label so it's along the line
  const ang = Math.atan2(p2y - p1y, p2x - p1x) * 180 / Math.PI;
  const labelAng = ang > 90 || ang < -90 ? ang + 180 : ang;
  return (
    <g stroke="#555" fill="none" strokeWidth="0.035">
      <line x1={x1} y1={y1} x2={p1x} y2={p1y} strokeDasharray="0.12,0.12" />
      <line x1={x2} y1={y2} x2={p2x} y2={p2y} strokeDasharray="0.12,0.12" />
      <line x1={p1x} y1={p1y} x2={p2x} y2={p2y}
        markerStart="url(#da)" markerEnd="url(#da)" strokeWidth="0.045" />
      <text
        x={mx} y={my - 0.2}
        textAnchor="middle"
        fontSize={fs} fill="#444" stroke="none"
        transform={`rotate(${labelAng},${mx},${my - 0.2})`}
      >
        {label}
      </text>
    </g>
  );
}

function NorthArrow({ cx, cy, r = 0.85 }: { cx: number; cy: number; r?: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.88)" stroke="#666" strokeWidth="0.04" />
      {/* North half (red) */}
      <path d={`M ${cx} ${cy - r * 0.75} L ${cx + r * 0.22} ${cy + r * 0.15} L ${cx} ${cy} Z`} fill="#c00" />
      {/* South half (white outline) */}
      <path d={`M ${cx} ${cy + r * 0.75} L ${cx - r * 0.22} ${cy - r * 0.15} L ${cx} ${cy} Z`} fill="#fff" stroke="#888" strokeWidth="0.03" />
      <text x={cx} y={cy - r * 0.82} textAnchor="middle" fontSize={r * 0.38} fill="#c00" fontWeight="bold">N</text>
    </g>
  );
}

function ScaleBar({ x, y, length = 5 }: { x: number; y: number; length?: number }) {
  return (
    <g stroke="#555" strokeWidth="0.06" fill="none">
      <line x1={x} y1={y} x2={x + length} y2={y} />
      <line x1={x} y1={y - 0.18} x2={x} y2={y + 0.18} />
      <line x1={x + length} y1={y - 0.18} x2={x + length} y2={y + 0.18} />
      <text x={x + length / 2} y={y - 0.28} textAnchor="middle" fontSize="0.36" fill="#555" stroke="none">
        {length} m
      </text>
    </g>
  );
}

// ===== Plan View (平面図) =====

function PlanView({ installation }: { installation: FieldInstallation }) {
  const { config, installationType } = installation;
  const panels = installationType === 'pergola'
    ? generatePanels(config as PanelConfig)
    : generateSlopePanels(config as SlopeConfig);

  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const p of panels) {
    for (const c of p.corners) {
      xMin = Math.min(xMin, c.x); xMax = Math.max(xMax, c.x);
      yMin = Math.min(yMin, c.y); yMax = Math.max(yMax, c.y);
    }
  }

  const mg = 2.8;
  // SVG: X = East (localX), Y = -North (-localY) so North points up
  const vbX = xMin - mg;
  const vbY = -(yMax + mg);
  const vbW = xMax - xMin + 2 * mg;
  const vbH = yMax - yMin + 2 * mg;

  const totalW = xMax - xMin;
  const totalD = yMax - yMin;
  const totalPanels = installationType === 'pergola'
    ? (config as PanelConfig).colsEW * (config as PanelConfig).rowsNS
    : (config as SlopeConfig).colsAcross * (config as SlopeConfig).rowsDown;
  const area = totalPanels * config.panelWidth * config.panelDepth;
  const estKw = (area * 220 / 1000).toFixed(1);

  const panelFill = installationType === 'pergola' ? 'rgba(29,78,216,0.65)' : 'rgba(213,94,10,0.65)';
  const panelStroke = installationType === 'pergola' ? '#1e40af' : '#b45309';

  return (
    <div className="svg-drawing-wrap">
      <div className="drawing-info-bar">
        <span className="dv-label">平面図（上面図）</span>
        <span>{installation.name}</span>
        <span>パネル {totalPanels}枚 ／ 面積 {area.toFixed(1)} m² ／ 推定 {estKw} kW</span>
      </div>
      <svg viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`} className="drawing-svg" preserveAspectRatio="xMidYMid meet">
        <SvgDefs />

        {/* 1m grid */}
        {Array.from({ length: Math.ceil(vbW) + 2 }, (_, i) => Math.floor(vbX) + i).map(gx => (
          <line key={`gx${gx}`} x1={gx} y1={vbY} x2={gx} y2={vbY + vbH} stroke="#ddd" strokeWidth="0.02" />
        ))}
        {Array.from({ length: Math.ceil(vbH) + 2 }, (_, i) => Math.floor(vbY) + i).map(gy => (
          <line key={`gy${gy}`} x1={vbX} y1={gy} x2={vbX + vbW} y2={gy} stroke="#ddd" strokeWidth="0.02" />
        ))}

        {/* Panels — project to XY (ignore Z), flip Y */}
        {panels.map(panel => (
          <polygon
            key={panel.panelIndex}
            points={panel.corners.map(c => `${c.x},${-c.y}`).join(' ')}
            fill={panelFill} stroke={panelStroke} strokeWidth="0.05"
          />
        ))}

        {/* Dimensions */}
        <DimLine x1={xMin} y1={-(yMin)} x2={xMax} y2={-(yMin)} offset={-1.6} label={`${totalW.toFixed(2)} m`} />
        <DimLine x1={xMax} y1={-(yMin)} x2={xMax} y2={-(yMax)} offset={1.6} label={`${totalD.toFixed(2)} m`} />

        {/* North arrow */}
        <NorthArrow cx={vbX + vbW - 1.1} cy={vbY + 1.1} r={0.82} />

        {/* Scale bar */}
        <ScaleBar x={vbX + 0.5} y={vbY + vbH - 0.7} length={5} />
      </svg>
    </div>
  );
}

// ===== Elevation View (正面図) =====

function ElevationView({ installation }: { installation: FieldInstallation }) {
  const { config, installationType } = installation;
  const panels = installationType === 'pergola'
    ? generatePanels(config as PanelConfig)
    : generateSlopePanels(config as SlopeConfig);

  // Project to XZ plane (front, looking from south)
  // SVG: X = East (localX), Y = -Up (-localZ)
  let xMin = Infinity, xMax = -Infinity, zMax = 0;
  for (const p of panels) {
    for (const c of p.corners) {
      xMin = Math.min(xMin, c.x); xMax = Math.max(xMax, c.x);
      zMax = Math.max(zMax, c.z);
    }
  }

  const mg = 2.5;
  const vbX = xMin - mg;
  const vbY = -(zMax + mg);
  const vbW = xMax - xMin + 2 * mg;
  const vbH = zMax + 2 * mg;

  const mountH = installationType === 'pergola'
    ? (config as PanelConfig).mountHeight
    : (config as SlopeConfig).baseMountHeight;
  const tiltLabel = installationType === 'pergola'
    ? `${(config as PanelConfig).tiltAngle}°`
    : `法面${(config as SlopeConfig).slopeAngle}° + 追加${(config as SlopeConfig).additionalTilt}°`;

  const panelFill = installationType === 'pergola' ? 'rgba(29,78,216,0.65)' : 'rgba(213,94,10,0.65)';
  const panelStroke = installationType === 'pergola' ? '#1e40af' : '#b45309';

  return (
    <div className="svg-drawing-wrap">
      <div className="drawing-info-bar">
        <span className="dv-label">正面図（南側から）</span>
        <span>{installation.name}</span>
        <span>設置高さ {mountH.toFixed(1)} m ／ 傾斜角 {tiltLabel}</span>
      </div>
      <svg viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`} className="drawing-svg" preserveAspectRatio="xMidYMid meet">
        <SvgDefs />

        {/* Ground */}
        <rect x={vbX} y={0} width={vbW} height={mg} fill="rgba(110,158,106,0.25)" />
        <line x1={vbX} y1={0} x2={vbX + vbW} y2={0} stroke="#6e9e6a" strokeWidth="0.08" />

        {/* Pergola structure */}
        {installationType === 'pergola' && (() => {
          const h = (config as PanelConfig).mountHeight;
          return (
            <>
              <line x1={xMin} y1={0} x2={xMin} y2={-h} stroke="#78716c" strokeWidth="0.09" />
              <line x1={xMax} y1={0} x2={xMax} y2={-h} stroke="#78716c" strokeWidth="0.09" />
              <line x1={xMin} y1={-h} x2={xMax} y2={-h} stroke="#78716c" strokeWidth="0.07" />
              <DimLine x1={xMin} y1={0} x2={xMin} y2={-h} offset={-1.4} label={`${h.toFixed(1)} m`} />
            </>
          );
        })()}

        {/* Panels (XZ projection) */}
        {panels.map(panel => (
          <polygon
            key={panel.panelIndex}
            points={panel.corners.map(c => `${c.x},${-c.z}`).join(' ')}
            fill={panelFill} stroke={panelStroke} strokeWidth="0.045"
          />
        ))}

        {/* Width + height dimensions */}
        <DimLine x1={xMin} y1={-zMax} x2={xMax} y2={-zMax} offset={-1.3} label={`${(xMax - xMin).toFixed(2)} m`} />
        <DimLine x1={xMax} y1={0} x2={xMax} y2={-zMax} offset={1.3} label={`${zMax.toFixed(2)} m`} />
      </svg>
    </div>
  );
}

// ===== Section View (断面図) =====

function SectionView({ installation }: { installation: FieldInstallation }) {
  const { config, installationType } = installation;
  const panels = installationType === 'pergola'
    ? generatePanels(config as PanelConfig)
    : generateSlopePanels(config as SlopeConfig);

  // Project to YZ plane (side section, looking from east)
  // SVG: X = North (localY), Y = -Up (-localZ)
  let yMin = Infinity, yMax = -Infinity, zMax = 0;
  for (const p of panels) {
    for (const c of p.corners) {
      yMin = Math.min(yMin, c.y); yMax = Math.max(yMax, c.y);
      zMax = Math.max(zMax, c.z);
    }
  }

  const mg = 2.5;
  const vbX = yMin - mg;
  const vbY = -(zMax + mg);
  const vbW = yMax - yMin + 2 * mg;
  const vbH = zMax + 2 * mg;

  const mountH = installationType === 'pergola'
    ? (config as PanelConfig).mountHeight
    : (config as SlopeConfig).baseMountHeight;
  const slopeAngle = installationType === 'slope' ? (config as SlopeConfig).slopeAngle : 0;
  const effTilt = installationType === 'pergola'
    ? (config as PanelConfig).tiltAngle
    : slopeAngle + (config as SlopeConfig).additionalTilt;

  // Center column of panels
  const colsCount = installationType === 'pergola'
    ? (config as PanelConfig).colsEW
    : (config as SlopeConfig).colsAcross;
  const centerIdx = Math.floor(colsCount / 2);
  const sectionPanels = panels.filter((_, i) => i % colsCount === centerIdx);

  const panelFill = installationType === 'pergola' ? 'rgba(29,78,216,0.7)' : 'rgba(213,94,10,0.7)';
  const panelStroke = installationType === 'pergola' ? '#1e40af' : '#b45309';

  // Tilt arc at the lowest panel corner
  const arcPanel = sectionPanels[0];
  let arcEl: React.ReactElement | null = null;
  if (arcPanel) {
    // Lowest corner in Z (e.g. corners[2] or [3] = lower-front)
    const lc = arcPanel.corners.reduce((a, b) => (a.z < b.z ? a : b));
    const hc = arcPanel.corners.reduce((a, b) => (a.z > b.z ? a : b));
    const arcR = Math.min(1.0, (yMax - yMin) * 0.2);
    const angRad = effTilt * Math.PI / 180;
    const startX = lc.y + arcR;
    const startY = -lc.z;
    const endX = lc.y + arcR * Math.cos(angRad);
    const endY = -lc.z - arcR * Math.sin(angRad);
    arcEl = (
      <>
        {/* Horizontal reference */}
        <line x1={lc.y} y1={-lc.z} x2={lc.y + arcR * 1.4} y2={-lc.z} stroke="#e07010" strokeWidth="0.05" strokeDasharray="0.15,0.1" />
        {/* Arc */}
        <path
          d={`M ${startX} ${startY} A ${arcR} ${arcR} 0 0 0 ${endX} ${endY}`}
          stroke="#e07010" strokeWidth="0.06" fill="none"
        />
        {/* Label */}
        <text x={lc.y + arcR + 0.15} y={-lc.z - arcR * 0.4} fontSize="0.38" fill="#e07010">{effTilt}°</text>
      </>
    );
  }

  return (
    <div className="svg-drawing-wrap">
      <div className="drawing-info-bar">
        <span className="dv-label">断面図（東側から）</span>
        <span>{installation.name}</span>
        <span>有効傾斜角 {effTilt}° ／ 設置高さ {mountH.toFixed(1)} m</span>
      </div>
      <svg viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`} className="drawing-svg" preserveAspectRatio="xMidYMid meet">
        <SvgDefs />

        {/* Ground */}
        {installationType === 'slope' ? (
          // Slope surface line
          (() => {
            const slopeRad = slopeAngle * Math.PI / 180;
            const yRange = yMax - yMin;
            return (
              <>
                <line
                  x1={yMin - 1} y1={0}
                  x2={yMax + 1} y2={-(yRange + 2) * Math.tan(slopeRad)}
                  stroke="#b8956a" strokeWidth="0.12"
                />
                <path
                  d={`M ${yMin - 1} 0 L ${yMax + 1} ${-(yRange + 2) * Math.tan(slopeRad)} L ${yMax + 1} ${mg * 0.8} L ${yMin - 1} ${mg * 0.8} Z`}
                  fill="rgba(184,149,106,0.2)"
                />
                {/* Slope angle arc */}
                {(() => {
                  const ar = 1.6;
                  return (
                    <g>
                      <line x1={yMin - 0.5} y1={0} x2={yMin - 0.5 + ar * 1.4} y2={0} stroke="#888" strokeWidth="0.05" strokeDasharray="0.15,0.1" />
                      <path
                        d={`M ${yMin - 0.5 + ar} 0 A ${ar} ${ar} 0 0 0 ${yMin - 0.5 + ar * Math.cos(slopeRad)} ${-ar * Math.sin(slopeRad)}`}
                        stroke="#888" strokeWidth="0.06" fill="none"
                      />
                      <text x={yMin - 0.5 + ar + 0.1} y={-ar * 0.35} fontSize="0.36" fill="#666">{slopeAngle}°</text>
                    </g>
                  );
                })()}
              </>
            );
          })()
        ) : (
          <>
            <rect x={vbX} y={0} width={vbW} height={mg} fill="rgba(110,158,106,0.25)" />
            <line x1={vbX} y1={0} x2={vbX + vbW} y2={0} stroke="#6e9e6a" strokeWidth="0.08" />
          </>
        )}

        {/* Pergola posts */}
        {installationType === 'pergola' && (() => {
          const h = (config as PanelConfig).mountHeight;
          return (
            <>
              <line x1={yMin} y1={0} x2={yMin} y2={-h} stroke="#78716c" strokeWidth="0.09" />
              <line x1={yMax} y1={0} x2={yMax} y2={-h} stroke="#78716c" strokeWidth="0.09" />
              <line x1={yMin} y1={-h} x2={yMax} y2={-h} stroke="#78716c" strokeWidth="0.07" />
              <DimLine x1={yMin} y1={0} x2={yMin} y2={-h} offset={-1.4} label={`${h.toFixed(1)} m`} />
            </>
          );
        })()}

        {/* Section panels */}
        {sectionPanels.map(panel => (
          <polygon
            key={panel.panelIndex}
            points={panel.corners.map(c => `${c.y},${-c.z}`).join(' ')}
            fill={panelFill} stroke={panelStroke} strokeWidth="0.055"
          />
        ))}

        {/* Tilt angle arc */}
        {arcEl}

        {/* Depth dimension */}
        <DimLine x1={yMin} y1={-zMax} x2={yMax} y2={-zMax} offset={-1.3} label={`${(yMax - yMin).toFixed(2)} m`} />

        {/* Height dimension */}
        <DimLine x1={yMax} y1={0} x2={yMax} y2={-zMax} offset={1.3} label={`${zMax.toFixed(2)} m`} />
      </svg>
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

  const allCorners = panels.flatMap(p => p.corners);
  const bb = computeBBox(allCorners);
  const totalW = bb.xMax - bb.xMin;
  const totalD = bb.yMax - bb.yMin;
  const totalH = bb.zMax - bb.zMin;

  const rows = installationType === 'pergola' ? [
    ['設置タイプ', '藤棚型（パーゴラ）'],
    ['配置', `${(config as PanelConfig).colsEW}列 × ${(config as PanelConfig).rowsNS}行`],
    ['パネル枚数', `${totalPanels} 枚`],
    ['パネルサイズ', `${config.panelWidth} m × ${config.panelDepth} m`],
    ['総パネル面積', `${area.toFixed(1)} m²`],
    ['推定発電量', `${estKw.toFixed(1)} kW`],
    ['架台高さ', `${(config as PanelConfig).mountHeight} m`],
    ['傾斜角', `${(config as PanelConfig).tiltAngle}°`],
    ['向き（方位）', `${(config as PanelConfig).facingAzimuth}°（${azLabel((config as PanelConfig).facingAzimuth)}）`],
    ['EW間隔', `${(config as PanelConfig).ewSpacing} m`],
    ['NS間隔', `${(config as PanelConfig).nsSpacing} m`],
    ['設置面積（外形）', `${totalW.toFixed(2)} × ${totalD.toFixed(2)} m`],
    ['最高点', `${(bb.zMax).toFixed(2)} m`],
  ] : [
    ['設置タイプ', '法面型（野立て）'],
    ['配置', `${(config as SlopeConfig).colsAcross}列 × ${(config as SlopeConfig).rowsDown}行`],
    ['パネル枚数', `${totalPanels} 枚`],
    ['パネルサイズ', `${config.panelWidth} m × ${config.panelDepth} m`],
    ['総パネル面積', `${area.toFixed(1)} m²`],
    ['推定発電量', `${estKw.toFixed(1)} kW`],
    ['法面傾斜角', `${(config as SlopeConfig).slopeAngle}°`],
    ['追加傾斜', `${(config as SlopeConfig).additionalTilt}°`],
    ['有効傾斜角', `${(config as SlopeConfig).slopeAngle + (config as SlopeConfig).additionalTilt}°`],
    ['向き（方位）', `${(config as SlopeConfig).facingAzimuth}°（${azLabel((config as SlopeConfig).facingAzimuth)}）`],
    ['横間隔', `${(config as SlopeConfig).acrossSpacing} m`],
    ['縦間隔（斜面）', `${(config as SlopeConfig).downSpacing} m`],
    ['ベース設置高', `${(config as SlopeConfig).baseMountHeight} m`],
    ['設置面積（外形）', `${totalW.toFixed(2)} × ${totalD.toFixed(2)} m`],
    ['最高点', `${(bb.zMax).toFixed(2)} m`],
  ];

  return (
    <div className="spec-table-wrap">
      <div className="drawing-info-bar">
        <span className="dv-label">仕様一覧表</span>
        <span>{installation.name}</span>
        <span>施工業者共有用</span>
      </div>
      <table className="spec-table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function azLabel(az: number): string {
  const dirs = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
  return dirs[Math.round(az / 22.5) % 16];
}

// ===== Main DrawingView Modal =====

export default function DrawingView({ installation, onClose }: Props) {
  const [tab, setTab] = useState<DrawingTab>('3d');

  const tabs: [DrawingTab, string][] = [
    ['3d', '🏗 3Dビュー'],
    ['plan', '🗺 平面図'],
    ['elevation', '🏢 正面図'],
    ['section', '✂ 断面図'],
  ];

  return (
    <div className="drawing-modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawing-modal-inner">
        <div className="drawing-modal-header">
          <div className="drawing-header-left">
            <span className="drawing-header-icon">📐</span>
            <span className="drawing-header-title">図面・3Dビュー</span>
            <span className="drawing-inst-badge">{installation.name}</span>
            <span className={`drawing-type-badge ${installation.installationType}`}>
              {installation.installationType === 'pergola' ? '藤棚型' : '法面型'}
            </span>
          </div>
          <div className="drawing-header-right">
            <button className="btn-draw-action" onClick={() => window.print()}>🖨 印刷</button>
            <button className="btn-draw-close" onClick={onClose}>✕ 閉じる</button>
          </div>
        </div>

        <div className="drawing-tab-bar">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              className={`drawing-tab${tab === id ? ' active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="drawing-tab-content">
          {tab === '3d' && (
            <div className="drawing-3d-layout">
              <ThreeViewer installation={installation} />
              <div className="drawing-3d-spec">
                <SpecTable installation={installation} />
              </div>
            </div>
          )}
          {tab === 'plan' && <PlanView installation={installation} />}
          {tab === 'elevation' && <ElevationView installation={installation} />}
          {tab === 'section' && <SectionView installation={installation} />}
        </div>
      </div>
    </div>
  );
}
