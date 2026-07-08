import type { GateDef } from '../gatedefs.ts';
import { State } from '../logic/values.ts';
import type { PlacedGate } from './model.ts';

// Exact state colors from CedarLogic's guiWire.cpp / guiGateLED::draw.
export function stateColor(s: State): string {
  switch (s) {
    case State.ZERO: return 'rgb(0, 0, 0)';
    case State.ONE: return 'rgb(255, 0, 0)';
    case State.HI_Z: return 'rgb(0, 199, 0)';
    case State.UNKNOWN: return 'rgb(77, 77, 255)';
    case State.CONFLICT: return 'rgb(0, 255, 255)';
  }
}

export function drawGateShape(
  ctx: CanvasRenderingContext2D,
  def: GateDef,
  pxScale: number,
  selected = false,
): void {
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 1.4 / pxScale;
  ctx.setLineDash(selected ? [0.2, 0.2] : []);
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of def.lines) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  for (const [cx, cy, r] of def.circles) {
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

// Fill boxes for the interactive gates, mirroring guiGateTOGGLE/guiGateLED.
// Both use a +/-0.76 inner square; LED_BOX/CLICK_BOX params can override.
export function innerBox(def: GateDef): [number, number, number, number] {
  const param = def.guiParams['LED_BOX'] ?? def.guiParams['CLICK_BOX'];
  if (param) {
    const [x1, y1, x2, y2] = param.split(',').map(Number);
    return [x1!, y1!, x2!, y2!];
  }
  return [-0.76, -0.76, 0.76, 0.76];
}

export function drawGateFill(ctx: CanvasRenderingContext2D, gate: PlacedGate, ledState: State): void {
  const guiType = gate.def.guiType;
  if (guiType !== 'TOGGLE' && guiType !== 'LED') return;
  const [x1, y1, x2, y2] = innerBox(gate.def);
  ctx.fillStyle = guiType === 'TOGGLE' ? stateColor(gate.toggleState) : stateColor(ledState);
  ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
}

export function makeThumbnail(def: GateDef, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const { bbox, hotspots } = def;
  let { minX, minY, maxX, maxY } = bbox;
  for (const h of hotspots) {
    minX = Math.min(minX, h.x);
    minY = Math.min(minY, h.y);
    maxX = Math.max(maxX, h.x);
    maxY = Math.max(maxY, h.y);
  }
  const scale = Math.min((width - 10) / (maxX - minX), (height - 10) / (maxY - minY));

  const ctx = canvas.getContext('2d')!;
  // y is negated: gate coordinates are y-up (OpenGL), canvas is y-down.
  ctx.setTransform(scale * dpr, 0, 0, -scale * dpr, (width / 2 - ((minX + maxX) / 2) * scale) * dpr, (height / 2 + ((minY + maxY) / 2) * scale) * dpr);
  drawGateShape(ctx, def, scale);
  return canvas;
}
