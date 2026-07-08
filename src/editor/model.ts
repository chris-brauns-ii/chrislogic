import type { GateDef, Hotspot } from '../gatedefs.ts';
import { State } from '../logic/values.ts';

export interface Point {
  x: number;
  y: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PlacedGate {
  id: number;
  def: GateDef;
  x: number;
  y: number;
  toggleState: State; // TOGGLE gates only
}

export interface WireConn {
  gateId: number;
  pin: string;
}

// One wire is one electrical net; it may fan out to many connections.
// Geometry (the segment tree) lives in ./wiregeom.ts; null means "not built
// yet — auto-route from pin positions on next use". Any operation that can't
// update geometry incrementally may set it back to null.
export interface Wire {
  id: number;
  conns: WireConn[];
  geom: import('./wiregeom.ts').WireGeom | null;
}

export function snap(v: number): number {
  return Math.round(v * 2) / 2;
}

export function hotspotPos(gate: PlacedGate, hs: Hotspot): Point {
  return { x: gate.x + hs.x, y: gate.y + hs.y };
}

export function findHotspot(gate: PlacedGate, pin: string): Hotspot | undefined {
  return gate.def.hotspots.find((h) => h.name === pin);
}

// Route a net as a star from the first connection point to each other point,
// using horizontal-vertical-horizontal elbows. (The original's user-editable
// segment trees come later; this gives clean orthogonal wires for now.)
export function routeWire(points: Point[]): Segment[] {
  const segments: Segment[] = [];
  const a = points[0];
  if (!a) return segments;
  for (let i = 1; i < points.length; i++) {
    const b = points[i]!;
    if (a.x === b.x || a.y === b.y) {
      segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    } else {
      const midX = snap((a.x + b.x) / 2);
      segments.push(
        { x1: a.x, y1: a.y, x2: midX, y2: a.y },
        { x1: midX, y1: a.y, x2: midX, y2: b.y },
        { x1: midX, y1: b.y, x2: b.x, y2: b.y },
      );
    }
  }
  return segments;
}

export function pointSegmentDistance(p: Point, s: Segment): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - s.x1) * dx + (p.y - s.y1) * dy) / lengthSq));
  const cx = s.x1 + t * dx;
  const cy = s.y1 + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

export function gateBodyHit(gate: PlacedGate, p: Point): boolean {
  const { minX, minY, maxX, maxY } = gate.def.bbox;
  const lx = p.x - gate.x;
  const ly = p.y - gate.y;
  return lx >= minX - 0.2 && lx <= maxX + 0.2 && ly >= minY - 0.2 && ly <= maxY + 0.2;
}
