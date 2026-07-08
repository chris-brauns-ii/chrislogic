import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, type LogicType, type PinSpec } from './circuit.ts';
import { State } from './values.ts';

const pins = (...names: string[]): PinSpec[] => names.map((name) => ({ name, inverted: false }));
const inv = (...names: string[]): PinSpec[] => names.map((name) => ({ name, inverted: true }));

function build(): Circuit {
  // toggle(1) -> AND.IN_0, toggle(2) -> AND.IN_1, AND.OUT -> LED net
  const c = new Circuit();
  c.addGate(1, 'DRIVER', [], pins('OUT_0'));
  c.addGate(2, 'DRIVER', [], pins('OUT_0'));
  c.addGate(3, 'AND', pins('IN_0', 'IN_1'), pins('OUT'));
  c.addGate(4, 'NODE', pins('N_in0', 'N_in1', 'N_in2', 'N_in3'), []);
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

// two toggles into one 2-input gate; returns output net reader
function twoInput(type: LogicType, outputPins: PinSpec[]): { c: Circuit; out: () => State } {
  const c = new Circuit();
  c.addGate(1, 'DRIVER', [], pins('OUT_0'));
  c.addGate(2, 'DRIVER', [], pins('OUT_0'));
  c.addGate(3, type, pins('IN_0', 'IN_1'), outputPins);
  c.addNet(10);
  c.addNet(11);
  c.addNet(12);
  c.connect(10, 1, 'OUT_0', true);
  c.connect(10, 3, 'IN_0', false);
  c.connect(11, 2, 'OUT_0', true);
  c.connect(11, 3, 'IN_1', false);
  c.connect(12, 3, outputPins[0]!.name, true);
  c.init();
  return { c, out: () => c.netState(12) };
}

test('toggles at 0 -> AND output 0', () => {
  const c = build();
  assert.equal(c.netState(10), State.ZERO);
  assert.equal(c.netState(11), State.ZERO);
  assert.equal(c.netState(12), State.ZERO);
});

test('AND truth table', () => {
  const { c, out } = twoInput('AND', pins('OUT'));
  assert.equal(out(), State.ZERO);
  c.setDriver(1, State.ONE);
  assert.equal(out(), State.ZERO);
  c.setDriver(2, State.ONE);
  assert.equal(out(), State.ONE);
});

test('OR truth table', () => {
  const { c, out } = twoInput('OR', pins('OUT'));
  assert.equal(out(), State.ZERO);
  c.setDriver(1, State.ONE);
  assert.equal(out(), State.ONE);
  c.setDriver(2, State.ONE);
  assert.equal(out(), State.ONE);
});

test('XOR truth table', () => {
  const { c, out } = twoInput('XOR', pins('OUT'));
  assert.equal(out(), State.ZERO);
  c.setDriver(1, State.ONE);
  assert.equal(out(), State.ONE);
  c.setDriver(2, State.ONE);
  assert.equal(out(), State.ZERO);
});

test('NAND: AND with inverted output pin', () => {
  const { c, out } = twoInput('AND', inv('OUT'));
  assert.equal(out(), State.ONE);
  c.setDriver(1, State.ONE);
  c.setDriver(2, State.ONE);
  assert.equal(out(), State.ZERO);
});

test('inverter: BUFFER with inverted output', () => {
  const c = new Circuit();
  c.addGate(1, 'DRIVER', [], pins('OUT_0'));
  c.addGate(2, 'BUFFER', pins('IN_0'), inv('OUT_0'));
  c.addNet(10);
  c.addNet(11);
  c.connect(10, 1, 'OUT_0', true);
  c.connect(10, 2, 'IN_0', false);
  c.connect(11, 2, 'OUT_0', true);
  c.init();
  assert.equal(c.netState(11), State.ONE);
  c.setDriver(1, State.ONE);
  assert.equal(c.netState(11), State.ZERO);
});

test('unconnected AND input -> UNKNOWN output', () => {
  const c = new Circuit();
  c.addGate(1, 'DRIVER', [], pins('OUT_0'));
  c.addGate(3, 'AND', pins('IN_0', 'IN_1'), pins('OUT'));
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
  c.addGate(1, 'DRIVER', [], pins('OUT_0'));
  c.addGate(2, 'DRIVER', [], pins('OUT_0'));
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
  c.addGate(4, 'NODE', pins('N_in0', 'N_in1', 'N_in2', 'N_in3'), []);
  c.addNet(10);
  c.connect(10, 4, 'N_in0', false);
  c.init();
  assert.equal(c.netState(10), State.HI_Z);
});

test('full adder from gates', () => {
  // Sum = A^B^Cin, Cout = AB + Cin(A^B)
  const c = new Circuit();
  c.addGate(1, 'DRIVER', [], pins('OUT_0')); // A
  c.addGate(2, 'DRIVER', [], pins('OUT_0')); // B
  c.addGate(3, 'DRIVER', [], pins('OUT_0')); // Cin
  c.addGate(4, 'XOR', pins('IN_0', 'IN_1'), pins('OUT'));
  c.addGate(5, 'XOR', pins('IN_0', 'IN_1'), pins('OUT'));
  c.addGate(6, 'AND', pins('IN_0', 'IN_1'), pins('OUT'));
  c.addGate(7, 'AND', pins('IN_0', 'IN_1'), pins('OUT'));
  c.addGate(8, 'OR', pins('IN_0', 'IN_1'), pins('OUT'));
  for (const n of [10, 11, 12, 13, 14, 15, 16, 17]) c.addNet(n);
  c.connect(10, 1, 'OUT_0', true); // A
  c.connect(11, 2, 'OUT_0', true); // B
  c.connect(12, 3, 'OUT_0', true); // Cin
  c.connect(10, 4, 'IN_0', false);
  c.connect(11, 4, 'IN_1', false);
  c.connect(13, 4, 'OUT', true); // A^B
  c.connect(13, 5, 'IN_0', false);
  c.connect(12, 5, 'IN_1', false);
  c.connect(14, 5, 'OUT', true); // Sum
  c.connect(10, 6, 'IN_0', false);
  c.connect(11, 6, 'IN_1', false);
  c.connect(15, 6, 'OUT', true); // AB
  c.connect(13, 7, 'IN_0', false);
  c.connect(12, 7, 'IN_1', false);
  c.connect(16, 7, 'OUT', true); // Cin(A^B)
  c.connect(15, 8, 'IN_0', false);
  c.connect(16, 8, 'IN_1', false);
  c.connect(17, 8, 'OUT', true); // Cout
  c.init();

  const bit = (s: State) => (s === State.ONE ? 1 : 0);
  for (let a = 0; a <= 1; a++) {
    for (let b = 0; b <= 1; b++) {
      for (let cin = 0; cin <= 1; cin++) {
        c.setDriver(1, a ? State.ONE : State.ZERO);
        c.setDriver(2, b ? State.ONE : State.ZERO);
        c.setDriver(3, cin ? State.ONE : State.ZERO);
        const total = a + b + cin;
        assert.equal(bit(c.netState(14)), total % 2, `sum a=${a} b=${b} cin=${cin}`);
        assert.equal(bit(c.netState(17)), total >> 1, `cout a=${a} b=${b} cin=${cin}`);
      }
    }
  }
});
