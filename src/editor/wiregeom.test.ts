import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoRoute, dragSegTo, movePin, pointOnSeg, type PinAt, type WireGeom } from './wiregeom.ts';
import type { Point, WireConn } from './model.ts';

// pins keyed by "gateId:pin"
function pins(map: Record<string, Point>): { conns: WireConn[]; at: PinAt } {
  const conns = Object.keys(map).map((k) => {
    const [gateId, pin] = k.split(':');
    return { gateId: Number(gateId), pin: pin! };
  });
  return { conns, at: (c) => map[`${c.gateId}:${c.pin}`]! };
}

function attachedSeg(g: WireGeom, gateId: number) {
  const a = g.attach.find((x) => x.gateId === gateId)!;
  return g.segs.find((s) => s.id === a.segId)!;
}

function assertPinsOnSegs(g: WireGeom, at: PinAt): void {
  for (const a of g.attach) {
    const seg = g.segs.find((s) => s.id === a.segId);
    assert.ok(seg, `attachment ${a.gateId}:${a.pin} points at missing seg`);
    assert.ok(pointOnSeg(at(a), seg!), `pin ${a.gateId}:${a.pin} not on its segment`);
  }
}

test('autoRoute two unaligned pins -> H-V-H', () => {
  const { conns, at } = pins({ '1:OUT': { x: -6, y: 0 }, '2:IN_0': { x: -3, y: 1 } });
  const g = autoRoute(conns, at);
  assert.equal(g.segs.length, 3);
  assert.equal(g.segs.filter((s) => s.vertical).length, 1);
  assertPinsOnSegs(g, at);
});

test('autoRoute aligned pins -> single segment holding both', () => {
  const { conns, at } = pins({ '1:OUT': { x: -6, y: 0 }, '2:N_in0': { x: 7, y: 0 } });
  const g = autoRoute(conns, at);
  assert.equal(g.segs.length, 1);
  assert.equal(g.attach.length, 2);
});

test('drag the trunk: joined horizontals stretch to follow', () => {
  const { conns, at } = pins({ '1:OUT': { x: 0, y: 0 }, '2:IN_0': { x: 10, y: 4 } });
  const g = autoRoute(conns, at);
  const trunk = g.segs.find((s) => s.vertical)!;
  assert.equal(trunk.pos, 5);
  dragSegTo(g, trunk.id, 8, at);
  assert.equal(trunk.pos, 8);
  const h1 = attachedSeg(g, 1);
  const h2 = attachedSeg(g, 2);
  assert.equal(h1.hi, 8); // stretched from x=5 to x=8
  assert.equal(h2.lo, 8);
  assertPinsOnSegs(g, at);
});

test('drag a pinned segment: jog stub spawns at the pin', () => {
  const { conns, at } = pins({ '1:OUT': { x: 0, y: 0 }, '2:IN_0': { x: 10, y: 4 } });
  const g = autoRoute(conns, at);
  const h1 = attachedSeg(g, 1); // pinned at (0,0)
  dragSegTo(g, h1.id, -2, at); // drag down
  assert.equal(h1.pos, -2);
  const stub = attachedSeg(g, 1);
  assert.notEqual(stub.id, h1.id);
  assert.ok(stub.vertical);
  assert.equal(stub.pos, 0); // at the pin's x
  assert.deepEqual([stub.lo, stub.hi], [-2, 0]);
  assertPinsOnSegs(g, at);
});

test('drag a straight two-pin wire -> U shape with two stubs', () => {
  const { conns, at } = pins({ '1:OUT': { x: 0, y: 0 }, '2:N_in0': { x: 6, y: 0 } });
  const g = autoRoute(conns, at);
  dragSegTo(g, g.segs[0]!.id, 2, at);
  assert.equal(g.segs.length, 3);
  assert.equal(g.segs.filter((s) => s.vertical).length, 2);
  assertPinsOnSegs(g, at);
});

test('movePin along the segment axis stretches it', () => {
  const map: Record<string, Point> = { '1:OUT': { x: 0, y: 0 }, '2:N_in0': { x: 6, y: 0 } };
  const { conns, at } = pins(map);
  const g = autoRoute(conns, at);
  map['1:OUT'] = { x: -3, y: 0 };
  movePin(g, conns[0]!, { x: 0, y: 0 }, { x: -3, y: 0 }, at);
  assert.equal(g.segs.length, 1);
  assert.equal(g.segs[0]!.lo, -3);
  assertPinsOnSegs(g, at);
});

test('movePin off-axis spawns a jog and stays glued while dragging', () => {
  const map: Record<string, Point> = { '1:OUT': { x: 0, y: 0 }, '2:N_in0': { x: 6, y: 0 } };
  const { conns, at } = pins(map);
  const g = autoRoute(conns, at);
  // gate drags up in two steps, like a live mouse drag
  map['1:OUT'] = { x: 0, y: 2 };
  movePin(g, conns[0]!, { x: 0, y: 0 }, { x: 0, y: 2 }, at);
  assertPinsOnSegs(g, at);
  map['1:OUT'] = { x: 1, y: 3 };
  movePin(g, conns[0]!, { x: 0, y: 2 }, { x: 1, y: 3 }, at);
  assertPinsOnSegs(g, at);
});

test('three-pin wire: branch lands on the tree with junction, drags stay consistent', () => {
  const map: Record<string, Point> = {
    '1:OUT': { x: 0, y: 0 },
    '2:IN_0': { x: 10, y: 4 },
    '3:IN_1': { x: 10, y: -4 },
  };
  const { conns, at } = pins(map);
  const g = autoRoute(conns, at);
  assertPinsOnSegs(g, at);
  const trunk = g.segs.find((s) => s.vertical && s.pos === 5);
  assert.ok(trunk, 'trunk exists at midX');
  dragSegTo(g, trunk!.id, 3, at);
  assertPinsOnSegs(g, at);
});
