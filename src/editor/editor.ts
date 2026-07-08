import type { GateDef } from '../gatedefs.ts';
import { Circuit, type LogicType } from '../logic/circuit.ts';
import { State } from '../logic/values.ts';
import {
  findHotspot,
  gateBodyHit,
  hotspotPos,
  routeWire,
  snap,
  type PlacedGate,
  type Point,
  type Wire,
  type WireConn,
} from './model.ts';
import { drawGateFill, drawGateShape, innerBox, stateColor } from './render.ts';
import {
  addBranch,
  autoRoute,
  dragSegTo,
  junctionPoints,
  movePin,
  segDistance,
  segEnds,
  unionGeoms,
  type WireGeom,
} from './wiregeom.ts';

type Mode =
  | { kind: 'idle' }
  | { kind: 'placing'; def: GateDef }
  | { kind: 'paletteDrag'; def: GateDef; startX: number; startY: number }
  | { kind: 'pan'; startX: number; startY: number; startOx: number; startOy: number }
  | { kind: 'dragGate'; gateId: number; grabDx: number; grabDy: number; moved: boolean; preMove: Snapshot }
  | { kind: 'dragSeg'; wireId: number; segId: number; vertical: boolean; moved: boolean; preMove: Snapshot }
  | { kind: 'wiring'; from: WireConn };

type Selection = { kind: 'gate' | 'wire'; id: number } | null;

// Undo/redo works on whole-topology snapshots: the editor already rebuilds
// the sim from scratch on every change, so restoring a snapshot is exactly
// one rebuild. GateDefs are shared immutable data and are not cloned.
interface Snapshot {
  gates: PlacedGate[];
  wires: Wire[];
  nextId: number;
}

const MAX_UNDO = 200;

const HOTSPOT_RADIUS = 0.45;
const WIRE_HIT_RADIUS = 0.3;

export class Editor {
  private gates: PlacedGate[] = [];
  private wires: Wire[] = [];
  private circuit = new Circuit();
  private nextId = 1;

  private view = { ox: 0, oy: 0, scale: 18 };
  private mode: Mode = { kind: 'idle' };
  private selection: Selection = null;
  private mouse: Point = { x: 0, y: 0 };
  private overCanvas = false;
  private hoverHotspot: WireConn | null = null;
  private hoverSeg: { wire: Wire; segId: number; vertical: boolean } | null = null;
  private spaceDown = false;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  private ctx: CanvasRenderingContext2D;

  constructor(
    private canvas: HTMLCanvasElement,
    private hintEl: HTMLElement,
    private onModeChange: (def: GateDef | null) => void,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.attachEvents();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
    const frame = () => {
      this.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    this.setHint();
  }

  beginPlace(def: GateDef): void {
    this.mode = { kind: 'placing', def };
    this.selection = null;
    this.onModeChange(def);
    this.setHint();
  }

  // Mousedown on a palette item: drag onto the canvas to drop a gate
  // (CedarLogic's DRAG_NEWGATE). A plain click falls back to placing mode.
  beginPaletteDrag(def: GateDef, e: MouseEvent): void {
    this.selection = null;
    this.mode = { kind: 'paletteDrag', def, startX: e.clientX, startY: e.clientY };
    this.onModeChange(def);
    this.setHint();
  }

  // ---- programmatic construction (demo circuits, future file load) ----

  place(def: GateDef, x: number, y: number): number {
    const id = this.nextId++;
    this.gates.push({ id, def, x: snap(x), y: snap(y), toggleState: State.ZERO });
    return id;
  }

  wire(conns: Array<[gateId: number, pin: string]>): void {
    this.wires.push({ id: this.nextId++, conns: conns.map(([gateId, pin]) => ({ gateId, pin })), geom: null });
  }

  private pinPos(c: WireConn): Point {
    const gate = this.gates.find((g) => g.id === c.gateId)!;
    return hotspotPos(gate, findHotspot(gate, c.pin)!);
  }

  private geomOf(w: Wire): WireGeom {
    if (!w.geom) w.geom = autoRoute(w.conns, (c) => this.pinPos(c));
    return w.geom;
  }

  refresh(): void {
    this.rebuild();
  }

  // ---- undo/redo ----

  private cloneWire(w: Wire): Wire {
    return {
      id: w.id,
      conns: w.conns.map((c) => ({ ...c })),
      geom: w.geom
        ? {
            segs: w.geom.segs.map((s) => ({ ...s })),
            attach: w.geom.attach.map((a) => ({ ...a })),
            nextSeg: w.geom.nextSeg,
          }
        : null,
    };
  }

  private snapshot(): Snapshot {
    return {
      gates: this.gates.map((g) => ({ ...g })),
      wires: this.wires.map((w) => this.cloneWire(w)),
      nextId: this.nextId,
    };
  }

  private restore(s: Snapshot): void {
    this.gates = s.gates.map((g) => ({ ...g }));
    this.wires = s.wires.map((w) => this.cloneWire(w));
    this.nextId = s.nextId;
    this.selection = null;
    this.rebuild();
  }

  private checkpoint(pre: Snapshot = this.snapshot()): void {
    this.undoStack.push(pre);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.snapshot());
    this.restore(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.restore(next);
  }

  // ---- topology -> simulation ----

  // The editor is the source of truth; rebuild the circuit from scratch on
  // every topology change. Instant at classroom scale and can't drift.
  private rebuild(): void {
    this.circuit = new Circuit();
    for (const gate of this.gates) {
      const pin = (h: { name: string; inverted: boolean }) => ({ name: h.name, inverted: h.inverted });
      const inputs = gate.def.hotspots.filter((h) => h.isInput).map(pin);
      const outputs = gate.def.hotspots.filter((h) => !h.isInput).map(pin);
      this.circuit.addGate(gate.id, gate.def.logicType as LogicType, inputs, outputs);
    }
    for (const wire of this.wires) {
      this.circuit.addNet(wire.id);
      for (const conn of wire.conns) {
        const gate = this.gates.find((g) => g.id === conn.gateId)!;
        const hs = findHotspot(gate, conn.pin)!;
        this.circuit.connect(wire.id, conn.gateId, conn.pin, !hs.isInput);
      }
    }
    for (const gate of this.gates) {
      if (gate.def.logicType === 'DRIVER') this.circuit.setDriver(gate.id, gate.toggleState);
    }
    this.circuit.init();
  }

  private connectWire(a: WireConn, b: WireConn): void {
    if (a.gateId === b.gateId && a.pin === b.pin) return;
    const wireOf = (c: WireConn) =>
      this.wires.find((w) => w.conns.some((x) => x.gateId === c.gateId && x.pin === c.pin));
    const wa = wireOf(a);
    const wb = wireOf(b);
    if (wa && wa === wb) return; // already on the same net
    this.checkpoint();
    const pinAt = (c: WireConn) => this.pinPos(c);
    if (!wa && !wb) {
      this.wires.push({ id: this.nextId++, conns: [a, b], geom: null });
    } else if (wa && !wb) {
      addBranch(this.geomOf(wa), b, pinAt);
      wa.conns.push(b);
    } else if (!wa && wb) {
      addBranch(this.geomOf(wb), a, pinAt);
      wb.conns.push(a);
    } else if (wa && wb && wa !== wb) {
      wa.geom = unionGeoms(this.geomOf(wa), this.geomOf(wb), this.pinPos(a), this.pinPos(b), pinAt);
      wa.conns.push(...wb.conns);
      this.wires = this.wires.filter((w) => w !== wb);
    }
    this.rebuild();
  }

  private deleteSelection(): void {
    if (!this.selection) return;
    this.checkpoint();
    if (this.selection.kind === 'gate') {
      const id = this.selection.id;
      this.gates = this.gates.filter((g) => g.id !== id);
      for (const wire of this.wires) {
        const before = wire.conns.length;
        wire.conns = wire.conns.filter((c) => c.gateId !== id);
        if (wire.conns.length !== before) wire.geom = null; // re-route survivors
      }
      this.wires = this.wires.filter((w) => w.conns.length >= 2);
    } else {
      this.wires = this.wires.filter((w) => w.id !== this.selection!.id);
    }
    this.selection = null;
    this.rebuild();
  }

  private flipToggle(gate: PlacedGate): void {
    gate.toggleState = gate.toggleState === State.ONE ? State.ZERO : State.ONE;
    this.circuit.setDriver(gate.id, gate.toggleState);
  }

  // Keep wire geometry glued to a gate's pins while it moves.
  private glueWires(gate: PlacedGate, oldX: number, oldY: number): void {
    for (const wire of this.wires) {
      for (const conn of wire.conns) {
        if (conn.gateId !== gate.id) continue;
        const hs = findHotspot(gate, conn.pin)!;
        const geom = this.geomOf(wire);
        const ok = movePin(
          geom,
          conn,
          { x: oldX + hs.x, y: oldY + hs.y },
          { x: gate.x + hs.x, y: gate.y + hs.y },
          (c) => this.pinPos(c),
        );
        if (!ok) wire.geom = null; // inconsistent geometry: fall back to re-route
      }
    }
  }

  // ---- hit testing ----

  private hotspotAt(p: Point): WireConn | null {
    for (const gate of this.gates) {
      for (const hs of gate.def.hotspots) {
        const pos = hotspotPos(gate, hs);
        if (Math.hypot(p.x - pos.x, p.y - pos.y) <= HOTSPOT_RADIUS) {
          return { gateId: gate.id, pin: hs.name };
        }
      }
    }
    return null;
  }

  private gateAt(p: Point): PlacedGate | null {
    for (let i = this.gates.length - 1; i >= 0; i--) {
      if (gateBodyHit(this.gates[i]!, p)) return this.gates[i]!;
    }
    return null;
  }

  private wireAt(p: Point): { wire: Wire; segId: number; vertical: boolean } | null {
    for (const wire of this.wires) {
      for (const seg of this.geomOf(wire).segs) {
        if (segDistance(p, seg) <= WIRE_HIT_RADIUS) {
          return { wire, segId: seg.id, vertical: seg.vertical };
        }
      }
    }
    return null;
  }

  private wirePoints(wire: Wire): Point[] {
    return wire.conns.map((c) => {
      const gate = this.gates.find((g) => g.id === c.gateId)!;
      return hotspotPos(gate, findHotspot(gate, c.pin)!);
    });
  }

  // ---- input events ----

  private toWorld(e: MouseEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - this.view.ox) / this.view.scale,
      y: (this.view.oy - (e.clientY - rect.top)) / this.view.scale,
    };
  }

  private attachEvents(): void {
    const c = this.canvas;
    c.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.spaceDown = false;
    });
  }

  private onMouseDown(e: MouseEvent): void {
    const p = this.toWorld(e);
    const wantPan = e.button === 1 || e.button === 2 || this.spaceDown;

    if (wantPan) {
      if (e.button === 2 && this.mode.kind === 'placing') {
        this.onModeChange(null); // right-click exits placement
      }
      this.mode = { kind: 'pan', startX: e.clientX, startY: e.clientY, startOx: this.view.ox, startOy: this.view.oy };
      this.setHint();
      return;
    }
    if (e.button !== 0) return;

    if (this.mode.kind === 'placing') {
      this.checkpoint();
      this.gates.push({
        id: this.nextId++,
        def: this.mode.def,
        x: snap(p.x),
        y: snap(p.y),
        toggleState: State.ZERO,
      });
      this.rebuild();
      return; // stay in placing mode; Esc/right-click exits
    }

    const hotspot = this.hotspotAt(p);
    if (hotspot) {
      this.mode = { kind: 'wiring', from: hotspot };
      this.setHint();
      return;
    }

    const gate = this.gateAt(p);
    if (gate) {
      this.selection = { kind: 'gate', id: gate.id };
      this.mode = {
        kind: 'dragGate',
        gateId: gate.id,
        grabDx: p.x - gate.x,
        grabDy: p.y - gate.y,
        moved: false,
        preMove: this.snapshot(),
      };
      return;
    }

    const hit = this.wireAt(p);
    if (hit) {
      this.selection = { kind: 'wire', id: hit.wire.id };
      this.mode = {
        kind: 'dragSeg',
        wireId: hit.wire.id,
        segId: hit.segId,
        vertical: hit.vertical,
        moved: false,
        preMove: this.snapshot(),
      };
      return;
    }

    this.selection = null;
    this.mode = { kind: 'pan', startX: e.clientX, startY: e.clientY, startOx: this.view.ox, startOy: this.view.oy };
  }

  private onMouseMove(e: MouseEvent): void {
    const p = this.toWorld(e);
    this.mouse = p;
    const rect = this.canvas.getBoundingClientRect();
    this.overCanvas =
      e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;

    if (this.mode.kind === 'pan') {
      this.view.ox = this.mode.startOx + (e.clientX - this.mode.startX);
      this.view.oy = this.mode.startOy + (e.clientY - this.mode.startY);
    }

    if (this.mode.kind === 'dragGate') {
      const mode = this.mode;
      const gate = this.gates.find((g) => g.id === mode.gateId);
      if (gate) {
        const nx = snap(p.x - mode.grabDx);
        const ny = snap(p.y - mode.grabDy);
        if (nx !== gate.x || ny !== gate.y) {
          const ox = gate.x;
          const oy = gate.y;
          gate.x = nx;
          gate.y = ny;
          mode.moved = true;
          this.glueWires(gate, ox, oy);
        }
      }
    }

    if (this.mode.kind === 'dragSeg') {
      const mode = this.mode;
      const wire = this.wires.find((w) => w.id === mode.wireId);
      const seg = wire?.geom?.segs.find((s) => s.id === mode.segId);
      if (wire && seg) {
        const newPos = snap(mode.vertical ? p.x : p.y);
        if (newPos !== seg.pos) {
          dragSegTo(wire.geom!, seg.id, newPos, (c) => this.pinPos(c));
          mode.moved = true;
        }
      } else {
        this.mode = { kind: 'idle' }; // segment merged away mid-drag
      }
    }

    this.hoverHotspot = this.mode.kind === 'idle' || this.mode.kind === 'wiring' ? this.hotspotAt(p) : null;
    this.hoverSeg =
      this.mode.kind === 'idle' && !this.hoverHotspot && !this.gateAt(p) ? this.wireAt(p) : null;
    this.updateCursor();
  }

  private onMouseUp(e: MouseEvent): void {
    const p = this.toWorld(e);

    if (this.mode.kind === 'paletteDrag') {
      const mode = this.mode;
      const moved = Math.hypot(e.clientX - mode.startX, e.clientY - mode.startY) > 4;
      if (this.overCanvas) {
        this.checkpoint();
        this.gates.push({ id: this.nextId++, def: mode.def, x: snap(p.x), y: snap(p.y), toggleState: State.ZERO });
        this.rebuild();
        this.mode = { kind: 'idle' };
        this.onModeChange(null);
      } else if (!moved) {
        this.mode = { kind: 'placing', def: mode.def }; // plain click: place-on-click mode
      } else {
        this.mode = { kind: 'idle' };
        this.onModeChange(null);
      }
      this.setHint();
      return;
    }

    if (this.mode.kind === 'wiring') {
      const target = this.hotspotAt(p);
      if (target) this.connectWire(this.mode.from, target);
      this.mode = { kind: 'idle' };
      this.setHint();
      return;
    }

    if (this.mode.kind === 'dragGate') {
      const mode = this.mode;
      this.mode = { kind: 'idle' };
      if (mode.moved) {
        this.checkpoint(mode.preMove); // undo returns the gate to where the drag began
      }
      if (!mode.moved) {
        const gate = this.gates.find((g) => g.id === mode.gateId);
        if (gate && gate.def.guiType === 'TOGGLE') {
          const [x1, y1, x2, y2] = innerBox(gate.def);
          const lx = p.x - gate.x;
          const ly = p.y - gate.y;
          if (lx >= x1 && lx <= x2 && ly >= y1 && ly <= y2) this.flipToggle(gate);
        }
      }
      return;
    }

    if (this.mode.kind === 'dragSeg') {
      if (this.mode.moved) this.checkpoint(this.mode.preMove);
      this.mode = { kind: 'idle' };
      return;
    }

    if (this.mode.kind === 'pan') this.mode = { kind: 'idle' };
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = Math.max(5, Math.min(80, this.view.scale * factor));
    const applied = next / this.view.scale;
    this.view.ox = mx - (mx - this.view.ox) * applied;
    this.view.oy = my - (my - this.view.oy) * applied;
    this.view.scale = next;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      this.spaceDown = true;
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? this.redo() : this.undo();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }
    if (e.key === 'Escape') {
      this.mode = { kind: 'idle' };
      this.selection = null;
      this.onModeChange(null);
      this.setHint();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.deleteSelection();
    }
  }

  private updateCursor(): void {
    const seg = this.mode.kind === 'dragSeg' ? this.mode : this.hoverSeg;
    const cursor =
      this.mode.kind === 'pan' ? 'grabbing'
      : this.mode.kind === 'placing' ? 'copy'
      : this.mode.kind === 'wiring' || this.hoverHotspot ? 'crosshair'
      : seg ? (seg.vertical ? 'ew-resize' : 'ns-resize')
      : 'default';
    this.canvas.style.cursor = cursor;
  }

  private setHint(): void {
    this.hintEl.textContent =
      this.mode.kind === 'placing'
        ? 'Click to place · Esc or right-click to stop'
        : this.mode.kind === 'paletteDrag'
          ? 'Drop on the canvas to place'
          : this.mode.kind === 'wiring'
            ? 'Release on a pin to connect · release elsewhere to cancel'
            : 'Drag gates from the palette · drag pin-to-pin to wire · click a toggle to flip it · wheel zooms, drag empty space pans · Delete removes selection';
  }

  // ---- rendering ----

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const wrap = this.canvas.parentElement!;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    if (this.view.ox === 0 && this.view.oy === 0) {
      this.view.ox = w / 3;
      this.view.oy = h / 2;
    }
  }

  private render(): void {
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;
    const { ox, oy, scale } = this.view;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);

    // world transform: y-up like the original's OpenGL canvas
    ctx.setTransform(scale * dpr, 0, 0, -scale * dpr, ox * dpr, oy * dpr);

    this.drawGrid(w, h);

    for (const wire of this.wires) this.drawWire(wire);
    if (this.mode.kind === 'wiring') this.drawPendingWire(this.mode.from);
    for (const gate of this.gates) this.drawGate(gate);
    if (this.mode.kind === 'placing' || (this.mode.kind === 'paletteDrag' && this.overCanvas)) {
      this.drawGhost(this.mode.def);
    }
    this.drawHotspots();
  }

  private drawGrid(w: number, h: number): void {
    const { ctx } = this;
    const { ox, oy, scale } = this.view;
    if (scale < 7) return;
    const minX = Math.floor(-ox / scale);
    const maxX = Math.ceil((w - ox) / scale);
    const minY = Math.floor((oy - h) / scale);
    const maxY = Math.ceil(oy / scale);
    ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = '#e9eef5';
    ctx.beginPath();
    for (let x = minX; x <= maxX; x++) {
      ctx.moveTo(x, minY);
      ctx.lineTo(x, maxY);
    }
    for (let y = minY; y <= maxY; y++) {
      ctx.moveTo(minX, y);
      ctx.lineTo(maxX, y);
    }
    ctx.stroke();
  }

  private drawWire(wire: Wire): void {
    const { ctx } = this;
    const geom = this.geomOf(wire);
    const color = stateColor(this.circuit.netState(wire.id));
    const selected = this.selection?.kind === 'wire' && this.selection.id === wire.id;

    ctx.strokeStyle = color;
    ctx.lineWidth = (selected ? 3 : 2) / this.view.scale;
    ctx.setLineDash(selected ? [0.25, 0.25] : []);
    ctx.beginPath();
    for (const seg of geom.segs) {
      const [a, b] = segEnds(seg);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = color;
    for (const p of junctionPoints(geom)) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of this.wirePoints(wire)) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawPendingWire(from: WireConn): void {
    const { ctx } = this;
    const gate = this.gates.find((g) => g.id === from.gateId);
    if (!gate) return;
    const a = hotspotPos(gate, findHotspot(gate, from.pin)!);
    const target = this.hoverHotspot
      ? hotspotPos(this.gates.find((g) => g.id === this.hoverHotspot!.gateId)!, findHotspot(this.gates.find((g) => g.id === this.hoverHotspot!.gateId)!, this.hoverHotspot.pin)!)
      : this.mouse;
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1.5 / this.view.scale;
    ctx.setLineDash([0.2, 0.2]);
    ctx.beginPath();
    for (const s of routeWire([a, target])) {
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawGate(gate: PlacedGate): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(gate.x, gate.y);
    const ledState = this.ledState(gate);
    drawGateFill(ctx, gate, ledState);
    const selected = this.selection?.kind === 'gate' && this.selection.id === gate.id;
    drawGateShape(ctx, gate.def, this.view.scale, selected);
    ctx.restore();
  }

  private ledState(gate: PlacedGate): State {
    if (gate.def.guiType !== 'LED') return State.HI_Z;
    for (const wire of this.wires) {
      if (wire.conns.some((c) => c.gateId === gate.id)) return this.circuit.netState(wire.id);
    }
    return State.HI_Z; // unconnected LED reads HI_Z, like the original
  }

  private drawGhost(def: GateDef): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.translate(snap(this.mouse.x), snap(this.mouse.y));
    drawGateShape(ctx, def, this.view.scale);
    ctx.restore();
  }

  private drawHotspots(): void {
    const { ctx } = this;
    const connected = new Set<string>();
    for (const wire of this.wires) {
      for (const c of wire.conns) connected.add(`${c.gateId}:${c.pin}`);
    }
    for (const gate of this.gates) {
      for (const hs of gate.def.hotspots) {
        if (connected.has(`${gate.id}:${hs.name}`)) continue;
        const pos = hotspotPos(gate, hs);
        ctx.fillStyle = '#999';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 0.08, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (this.hoverHotspot) {
      const gate = this.gates.find((g) => g.id === this.hoverHotspot!.gateId);
      if (gate) {
        const pos = hotspotPos(gate, findHotspot(gate, this.hoverHotspot.pin)!);
        ctx.strokeStyle = this.mode.kind === 'wiring' ? '#0a0' : '#e80';
        ctx.lineWidth = 2 / this.view.scale;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 0.3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}
