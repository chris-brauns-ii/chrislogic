import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from './circuit.ts';
import { State } from './values.ts';

const AND_PINS = { inputs: ['IN_0', 'IN_1'], outputs: ['OUT'] };

function build(): Circuit {
  // toggle(1) -> AND.IN_0, toggle(2) -> AND.IN_1, AND.OUT -> LED net
  const c = new Circuit();
  c.addGate(1, 'DRIVER', [], ['OUT_0']);
  c.addGate(2, 'DRIVER', [], ['OUT_0']);
  c.addGate(3, 'AND', AND_PINS.inputs, AND_PINS.outputs);
  c.addGate(4, 'NODE', ['N_in0', 'N_in1', 'N_in2', 'N_in3'], []);
  c.addNet(10);
  c.addNet(11);
  c.addNet(12);
  c.connect(10, 1, 'OUT_0', true);
  c.connect(10, 3, 'IN_0', false);
  c.connect(11, 2, 'OUT_0', true);
  c.connect(11, 3, 'IN_1', false);
  c.connect(12, 3, 'OUT', true);
  c.connect(12, 4, 'N_in0', false);
  c.init();
  return c;
}

test('toggles at 0 -> AND output 0', () => {
  const c = build();
  assert.equal(c.netState(10), State.ZERO);
  assert.equal(c.netState(11), State.ZERO);
  assert.equal(c.netState(12), State.ZERO);
});

test('one toggle high -> AND output stays 0', () => {
  const c = build();
  c.setDriver(1, State.ONE);
  assert.equal(c.netState(10), State.ONE);
  assert.equal(c.netState(12), State.ZERO);
});

test('both toggles high -> AND output 1', () => {
  const c = build();
  c.setDriver(1, State.ONE);
  c.setDriver(2, State.ONE);
  assert.equal(c.netState(12), State.ONE);
});

test('unconnected AND input -> UNKNOWN output', () => {
  const c = new Circuit();
  c.addGate(1, 'DRIVER', [], ['OUT_0']);
  c.addGate(3, 'AND', AND_PINS.inputs, AND_PINS.outputs);
  c.addNet(10);
  c.addNet(12);
  c.connect(10, 1, 'OUT_0', true);
  c.connect(10, 3, 'IN_0', false);
  c.connect(12, 3, 'OUT', true);
  c.init();
  c.setDriver(1, State.ONE); // IN_0=1, IN_1 floating
  assert.equal(c.netState(12), State.UNKNOWN);
  c.setDriver(1, State.ZERO); // a 0 input dominates: output 0 despite floating pin
  assert.equal(c.netState(12), State.ZERO);
});

test('two drivers fighting -> CONFLICT', () => {
  const c = new Circuit();
  c.addGate(1, 'DRIVER', [], ['OUT_0']);
  c.addGate(2, 'DRIVER', [], ['OUT_0']);
  c.addNet(10);
  c.connect(10, 1, 'OUT_0', true);
  c.connect(10, 2, 'OUT_0', true);
  c.init();
  c.setDriver(1, State.ONE);
  assert.equal(c.netState(10), State.CONFLICT);
  c.setDriver(2, State.ONE);
  assert.equal(c.netState(10), State.ONE);
});

test('undriven net -> HI_Z', () => {
  const c = new Circuit();
  c.addGate(4, 'NODE', ['N_in0', 'N_in1', 'N_in2', 'N_in3'], []);
  c.addNet(10);
  c.connect(10, 4, 'N_in0', false);
  c.init();
  assert.equal(c.netState(10), State.HI_Z);
});
