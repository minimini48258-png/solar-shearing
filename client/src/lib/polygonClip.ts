/**
 * Sutherland-Hodgman ポリゴンクリッピング
 * subject ポリゴンを clip ポリゴン（凸多角形）で切り取る。
 * 座標は [x, y]（lng/lat でも meters でも同様に動作）。
 */

type Pt = [number, number];

function isInsideEdge(p: Pt, a: Pt, b: Pt): boolean {
  // a→b の左側（CCW で「内側」）にあるか
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
}

function edgeIntersect(p1: Pt, p2: Pt, a: Pt, b: Pt): Pt {
  const dx1 = p2[0] - p1[0], dy1 = p2[1] - p1[1];
  const dx2 = b[0]  - a[0],  dy2 = b[1]  - a[1];
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-12) return p1;
  const t = ((a[0] - p1[0]) * dy2 - (a[1] - p1[1]) * dx2) / denom;
  return [p1[0] + t * dx1, p1[1] + t * dy1];
}

function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a;
}

function ensureCCW(pts: Pt[]): Pt[] {
  return signedArea(pts) >= 0 ? pts : [...pts].reverse();
}

/**
 * subject ポリゴンを clip 凸ポリゴンで切り取り、交差部分を返す。
 * 交差なし or 縮退した場合は空配列を返す。
 * 入力は閉じていない頂点リスト（最終点 ≠ 先頭点）を想定。
 */
export function clipPolygon(subject: Pt[], clip: Pt[]): Pt[] {
  const clipCCW = ensureCCW([...clip]);
  let output = [...subject];
  const n = clipCCW.length;
  for (let i = 0; i < n; i++) {
    if (output.length === 0) return [];
    const input = [...output];
    output = [];
    const a = clipCCW[i], b = clipCCW[(i + 1) % n];
    let S = input[input.length - 1];
    for (const E of input) {
      const EIn = isInsideEdge(E, a, b);
      const SIn = isInsideEdge(S, a, b);
      if (EIn) {
        if (!SIn) output.push(edgeIntersect(S, E, a, b));
        output.push(E);
      } else if (SIn) {
        output.push(edgeIntersect(S, E, a, b));
      }
      S = E;
    }
  }
  return output;
}
