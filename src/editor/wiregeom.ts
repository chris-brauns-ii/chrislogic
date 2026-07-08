// Wire geometry: each wire owns a tree of axis-aligned segments, following
// CedarLogic's wireSegment model. Segments are auto-routed on creation and
// then owned by the user: any segment drags perpendicular to its orientation,
// neighbors stretch to stay joined, and endpoints glued to pins spawn jog
// stubs. A cleanup pass merges collinear segments and prunes dead ends.
import { snap, type Point, type WireConn } from './model.ts';

export interface Seg {
  id: number;
  vertical: boolean;
  pos: number; // x for vertical, y for horizontal
  lo: number; // extent along the segment axis; lo <= hi
  hi: number;
}

export interface Attachment {
  gateId: number;
  pin: string;
  segId: number; // the pin's point always lies on this segment
}

export interface WireGeom {
  segs: Seg[];
  attach: Attachment[];
  nextSeg: number;
}

export type PinAt = (conn: WireConn) => Point;

const EPS = 0.01;
const eq = (a: number, b: number): boolean => Math.abs(a - b) < EPS;

function addSeg(g: WireGeom, vertical: boolean, pos: number, a: number, b: number): Seg {
  const seg: Seg = { id: g.nextSeg++, vertical, pos, lo: Math.min(a, b), hi: Math.max(a, b) };
  g.segs.push(seg);
  return seg;
}

function normalize(s: Seg): void {
  if (s.lo > s.hi) {
    const t = s.lo;
    s.lo = s.hi;
    s.hi = t;
  }
}

export function segEnds(s: Seg): [Point, Point] {
  return s.vertical
    ? [{ x: s.pos, y: s.lo }, { x: s.pos, y: s.hi }]
    : [{ x: s.lo, y: s.pos }, { x: s.hi, y: s.pos }];
}

export function pointOnSeg(p: Point, s: Seg): boolean {
  const along = s.vertical ? p.y : p.x;
  const across = s.vertical ? p.x : p.y;
  return eq(across, s.pos) && along >= s.lo - EPS && along <= s.hi + EPS;
}

export function segDistance(p: Point, s: Seg): number {
  const along = s.vertical ? p.y : p.x;
  const across = s.vertical ? p.x : p.y;
  const t = Math.max(s.lo, Math.min(s.hi, along));
  return Math.hypot(along - t, across - s.pos);
}

// Do two perpendicular segments touch? (Same-orientation contact is handled
// by the collinear merge in cleanup.)
function perpTouch(a: Seg, b: Seg): Point | null {
  if (a.vertical === b.vertical) return null;
  const h = a.vertical ? b : a;
  const v = a.vertical ? a : b;
  if (v.pos >= h.lo - EPS && v.pos <= h.hi + EPS && h.pos >= v.lo - EPS && h.pos <= v.hi + EPS) {
    return { x: v.pos, y: h.pos };
  }
  return null;
}

// ---- construction ----

export function autoRoute(conns: WireConn[], pinAt: PinAt): WireGeom {
  const g: WireGeom = { segs: [], attach: [], nextSeg: 1 };
  if (conns.length === 0) return g;
  const first = conns[0]!;
  if (conns.length === 1) {
    const p = pinAt(first);
    const s = addSeg(g, false, p.y, p.x, p.x);
    g.attach.push({ ...first, segId: s.id });
    return g;
  }
  baseBranch(g, first, conns[1]!, pinAt);
  for (let i = 2; i < conns.length; i++) addBranch(g, conns[i]!, pinAt);
  cleanup(g, pinAt);
  return g;
}

function baseBranch(g: WireGeom, a: WireConn, b: WireConn, pinAt: PinAt): void {
  const pa = pinAt(a);
  const pb = pinAt(b);
  if (eq(pa.y, pb.y)) {
    const s = addSeg(g, false, pa.y, pa.x, pb.x);
    g.attach.push({ ...a, segId: s.id }, { ...b, segId: s.id });
  } else if (eq(pa.x, pb.x)) {
    const s = addSeg(g, true, pa.x, pa.y, pb.y);
    g.attach.push({ ...a, segId: s.id }, { ...b, segId: s.id });
  } else {
    const midX = snap((pa.x + pb.x) / 2);
    const h1 = addSeg(g, false, pa.y, pa.x, midX);
    addSeg(g, true, midX, pa.y, pb.y);
    const h2 = addSeg(g, false, pb.y, midX, pb.x);
    g.attach.push({ ...a, segId: h1.id }, { ...b, segId: h2.id });
  }
}

// Route one more pin to the nearest point on the existing tree.
export function addBranch(g: WireGeom, conn: WireConn, pinAt: PinAt): void {
  const p = pinAt(conn);
  let best: { seg: Seg; q: Point; d: number } | null = null;
  for (const s of g.segs) {
    const along = s.vertical ? p.y : p.x;
    const t = Math.max(s.lo, Math.min(s.hi, along));
    const q = s.vertical ? { x: s.pos, y: t } : { x: t, y: s.pos };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (!best || d < best.d) best = { seg: s, q, d };
  }
  if (!best) {
    const s = addSeg(g, false, p.y, p.x, p.x);
    g.attach.push({ ...conn, segId: s.id });
    return;
  }
  const { seg, q } = best;
  if (pointOnSeg(p, seg)) {
    g.attach.push({ ...conn, segId: seg.id });
  } else if (eq(p.y, q.y)) {
    const s = addSeg(g, false, p.y, p.x, q.x);
    g.attach.push({ ...conn, segId: s.id });
  } else if (eq(p.x, q.x)) {
    const s = addSeg(g, true, p.x, p.y, q.y);
    g.attach.push({ ...conn, segId: s.id });
  } else {
    // elbow: horizontal from the pin, vertical down/up to the tree
    const h = addSeg(g, false, p.y, p.x, q.x);
    addSeg(g, true, q.x, p.y, q.y);
    g.attach.push({ ...conn, segId: h.id });
  }
  cleanup(g, pinAt);
}

// Merge two geometries (net merge) and bridge them with an elbow between the
// two pins the user connected. Segment ids of `b` are renumbered.
export function unionGeoms(a: WireGeom, b: WireGeom, bridgeFrom: Point, bridgeTo: Point, pinAt: PinAt): WireGeom {
  const offset = a.nextSeg;
  const g: WireGeom = {
    segs: [...a.segs.map((s) => ({ ...s })), ...b.segs.map((s) => ({ ...s, id: s.id + offset }))],
    attach: [...a.attach.map((x) => ({ ...x })), ...b.attach.map((x) => ({ ...x, segId: x.segId + offset }))],
    nextSeg: a.nextSeg + b.nextSeg,
  };
  if (eq(bridgeFrom.y, bridgeTo.y)) {
    addSeg(g, false, bridgeFrom.y, bridgeFrom.x, bridgeTo.x);
  } else if (eq(bridgeFrom.x, bridgeTo.x)) {
    addSeg(g, true, bridgeFrom.x, bridgeFrom.y, bridgeTo.y);
  } else {
    addSeg(g, false, bridgeFrom.y, bridgeFrom.x, bridgeTo.x);
    addSeg(g, true, bridgeTo.x, bridgeFrom.y, bridgeTo.y);
  }
  cleanup(g, pinAt);
  return g;
}

// ---- interaction ----

// Drag a segment perpendicular to its orientation. Joined neighbors stretch
// to follow; pins attached to the dragged segment spawn perpendicular stubs.
export function dragSegTo(g: WireGeom, segId: number, newPos: number, pinAt: PinAt): void {
  const seg = g.segs.find((s) => s.id === segId);
  if (!seg || eq(seg.pos, newPos)) return;
  const oldPos = seg.pos;

  for (const n of g.segs) {
    if (n.vertical === seg.vertical) continue;
    const touches = n.pos >= seg.lo - EPS && n.pos <= seg.hi + EPS && oldPos >= n.lo - EPS && oldPos <= n.hi + EPS;
    if (!touches) continue;
    if (eq(n.lo, oldPos)) n.lo = newPos;
    else if (eq(n.hi, oldPos)) n.hi = newPos;
    else {
      // the dragged segment slides along n's interior; extend n if needed
      n.lo = Math.min(n.lo, newPos);
      n.hi = Math.max(n.hi, newPos);
    }
    normalize(n);
  }

  for (const a of g.attach) {
    if (a.segId !== seg.id) continue;
    const p = pinAt(a);
    const stub = addSeg(g, !seg.vertical, seg.vertical ? p.y : p.x, seg.vertical ? p.x : p.y, newPos);
    a.segId = stub.id;
  }

  seg.pos = newPos;
  cleanup(g, pinAt, seg.id);
}

// A pin moved (its gate was dragged). Stretch the attached segment along its
// axis; if the pin also moved off-axis, spawn a perpendicular jog stub.
export function movePin(g: WireGeom, conn: WireConn, oldP: Point, newP: Point, pinAt: PinAt): boolean {
  const a = g.attach.find((x) => x.gateId === conn.gateId && x.pin === conn.pin);
  if (!a) return false;
  const seg = g.segs.find((s) => s.id === a.segId);
  if (!seg) return false;

  const oldAlong = seg.vertical ? oldP.y : oldP.x;
  const newAlong = seg.vertical ? newP.y : newP.x;
  const newAcross = seg.vertical ? newP.x : newP.y;

  if (eq(seg.lo, oldAlong)) seg.lo = newAlong;
  else if (eq(seg.hi, oldAlong)) seg.hi = newAlong;
  else {
    seg.lo = Math.min(seg.lo, newAlong);
    seg.hi = Math.max(seg.hi, newAlong);
  }
  normalize(seg);

  if (!eq(newAcross, seg.pos)) {
    const stub = addSeg(g, !seg.vertical, newAlong, newAcross, seg.pos);
    a.segId = stub.id;
  }
  cleanup(g, pinAt);
  return true;
}

// ---- cleanup ----

export function cleanup(g: WireGeom, pinAt: PinAt, protectId?: number): void {
  mergeCollinear(g, protectId);
  relocateZeroSegs(g, pinAt);
  pruneOrphans(g, protectId);
  mergeCollinear(g, protectId);
}

function mergeCollinear(g: WireGeom, protectId?: number): void {
  const groups = new Map<string, Seg[]>();
  for (const s of g.segs) {
    const key = `${s.vertical}:${Math.round(s.pos * 4)}`;
    const group = groups.get(key);
    if (group) group.push(s);
    else groups.set(key, [s]);
  }
  const out: Seg[] = [];
  const remap = new Map<number, number>();
  for (const group of groups.values()) {
    group.sort((x, y) => x.lo - y.lo);
    let run: Seg[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const survivor = run.find((s) => s.id === protectId) ?? run[0]!;
      const merged: Seg = {
        id: survivor.id,
        vertical: survivor.vertical,
        pos: survivor.pos,
        lo: Math.min(...run.map((s) => s.lo)),
        hi: Math.max(...run.map((s) => s.hi)),
      };
      for (const s of run) remap.set(s.id, merged.id);
      out.push(merged);
      run = [];
    };
    for (const s of group) {
      if (run.length > 0 && s.lo > run.reduce((m, r) => Math.max(m, r.hi), -Infinity) + EPS) flush();
      run.push(s);
    }
    flush();
  }
  g.segs = out;
  for (const a of g.attach) a.segId = remap.get(a.segId) ?? a.segId;
}

// A zero-length segment is just an attachment point; if its pin lies on
// another segment, move the attachment there and drop the stub.
function relocateZeroSegs(g: WireGeom, pinAt: PinAt): void {
  const removable = new Set<number>();
  for (const s of g.segs) {
    if (!eq(s.lo, s.hi)) continue;
    const holders = g.attach.filter((a) => a.segId === s.id);
    let allRelocated = true;
    for (const a of holders) {
      const p = pinAt(a);
      const host = g.segs.find((o) => o.id !== s.id && !eq(o.lo, o.hi) && pointOnSeg(p, o));
      if (host) a.segId = host.id;
      else allRelocated = false;
    }
    if (allRelocated) removable.add(s.id);
  }
  if (g.segs.length > 1) g.segs = g.segs.filter((s) => !removable.has(s.id));
}

// Remove dead-end segments: no attachments and joined to the rest of the
// wire at no more than one point.
function pruneOrphans(g: WireGeom, protectId?: number): void {
  let removed = true;
  while (removed && g.segs.length > 1) {
    removed = false;
    for (const s of g.segs) {
      if (s.id === protectId) continue;
      if (g.attach.some((a) => a.segId === s.id)) continue;
      const touchPoints = new Set<string>();
      for (const o of g.segs) {
        if (o.id === s.id) continue;
        const pt = perpTouch(s, o);
        if (pt) touchPoints.add(`${Math.round(pt.x * 4)}:${Math.round(pt.y * 4)}`);
      }
      if (touchPoints.size <= 1) {
        g.segs = g.segs.filter((o) => o.id !== s.id);
        removed = true;
        break;
      }
    }
  }
}

// Junction dots: points where a segment end meets another segment's interior
// (T) or two segments cross (X). Plain corners get no dot.
export function junctionPoints(g: WireGeom): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < g.segs.length; i++) {
    for (let j = i + 1; j < g.segs.length; j++) {
      const a = g.segs[i]!;
      const b = g.segs[j]!;
      const pt = perpTouch(a, b);
      if (!pt) continue;
      const aAlong = a.vertical ? pt.y : pt.x;
      const bAlong = b.vertical ? pt.y : pt.x;
      const aEnd = eq(aAlong, a.lo) || eq(aAlong, a.hi);
      const bEnd = eq(bAlong, b.lo) || eq(bAlong, b.hi);
      if (!(aEnd && bEnd)) points.push(pt);
    }
  }
  return points;
}
