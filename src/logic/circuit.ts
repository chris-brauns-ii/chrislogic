// Event-driven simulation core, a scoped-down port of CedarLogic's logic/
// engine: gates schedule timed drive changes on nets, nets resolve their
// state from all drivers, state changes trigger re-evaluation of readers.
import { State } from './values.ts';

export type LogicType = 'AND' | 'OR' | 'XOR' | 'BUFFER' | 'DRIVER' | 'NODE';

export interface PinSpec {
  name: string;
  inverted: boolean;
}

// Pin inversion (the bubble on NAND/NOR/XNOR/inverter pins) flips only
// well-defined values; HI_Z/UNKNOWN/CONFLICT pass through.
function invert(s: State): State {
  if (s === State.ZERO) return State.ONE;
  if (s === State.ONE) return State.ZERO;
  return s;
}

const GATE_DELAY = 1;

interface Conn {
  gateId: number;
  pin: string;
  isOutput: boolean;
}

interface SimEvent {
  time: number;
  seq: number; // FIFO tiebreaker so a later-scheduled drive wins at equal time
  gateId: number;
  pin: string;
  value: State;
}

class Net {
  id: number;
  conns: Conn[] = [];
  state: State = State.HI_Z;
  constructor(id: number) {
    this.id = id;
  }
}

class SimGate {
  id: number;
  type: LogicType;
  inputPins: PinSpec[];
  outputPins: PinSpec[];
  pins = new Map<string, number>(); // pin name -> net id
  drives = new Map<string, State>(); // applied drive per output pin
  driverValue: State = State.ZERO; // DRIVER gates only
  constructor(id: number, type: LogicType, inputPins: PinSpec[], outputPins: PinSpec[]) {
    this.id = id;
    this.type = type;
    this.inputPins = inputPins;
    this.outputPins = outputPins;
  }
}

export class Circuit {
  time = 0;
  private gates = new Map<number, SimGate>();
  private nets = new Map<number, Net>();
  private queue: SimEvent[] = [];
  private seq = 0;

  addGate(id: number, type: LogicType, inputPins: PinSpec[], outputPins: PinSpec[]): void {
    this.gates.set(id, new SimGate(id, type, inputPins, outputPins));
  }

  addNet(id: number): void {
    this.nets.set(id, new Net(id));
  }

  connect(netId: number, gateId: number, pin: string, isOutput: boolean): void {
    const gate = this.gates.get(gateId);
    const net = this.nets.get(netId);
    if (!gate || !net) throw new Error(`connect: unknown gate ${gateId} or net ${netId}`);
    gate.pins.set(pin, netId);
    net.conns.push({ gateId, pin, isOutput });
  }

  setDriver(gateId: number, value: State): void {
    const gate = this.gates.get(gateId);
    if (!gate) throw new Error(`setDriver: unknown gate ${gateId}`);
    gate.driverValue = value;
    this.runUntilQuiet(new Set([gateId]));
  }

  netState(netId: number): State {
    return this.nets.get(netId)?.state ?? State.HI_Z;
  }

  // Evaluate every gate, then settle. Called once after (re)building topology.
  init(): void {
    this.runUntilQuiet(new Set(this.gates.keys()));
  }

  private runUntilQuiet(pending: Set<number>, maxIterations = 10000): void {
    let guard = 0;
    while (guard++ < maxIterations) {
      for (const gateId of pending) this.evaluate(this.gates.get(gateId)!);
      pending.clear();

      if (this.queue.length === 0) break;
      this.queue.sort((a, b) => a.time - b.time || a.seq - b.seq);
      this.time = this.queue[0]!.time;

      const changedNets = new Set<number>();
      while (this.queue.length > 0 && this.queue[0]!.time === this.time) {
        const e = this.queue.shift()!;
        const gate = this.gates.get(e.gateId);
        if (!gate) continue; // gate deleted while event in flight
        gate.drives.set(e.pin, e.value);
        const netId = gate.pins.get(e.pin);
        if (netId !== undefined) changedNets.add(netId);
      }

      for (const netId of changedNets) {
        const net = this.nets.get(netId)!;
        const next = this.resolve(net);
        if (next === net.state) continue;
        net.state = next;
        for (const conn of net.conns) {
          if (!conn.isOutput) pending.add(conn.gateId);
        }
      }
    }
  }

  // Combine every drive on the net into a single resolved state.
  private resolve(net: Net): State {
    let hasZero = false;
    let hasOne = false;
    let hasUnknown = false;
    for (const conn of net.conns) {
      if (!conn.isOutput) continue;
      const drive = this.gates.get(conn.gateId)?.drives.get(conn.pin) ?? State.HI_Z;
      if (drive === State.ZERO) hasZero = true;
      else if (drive === State.ONE) hasOne = true;
      else if (drive === State.UNKNOWN || drive === State.CONFLICT) hasUnknown = true;
    }
    if (hasZero && hasOne) return State.CONFLICT;
    if (hasUnknown) return State.UNKNOWN;
    if (hasOne) return State.ONE;
    if (hasZero) return State.ZERO;
    return State.HI_Z;
  }

  private readInput(gate: SimGate, pin: PinSpec): State {
    const netId = gate.pins.get(pin.name);
    const s = netId !== undefined ? this.nets.get(netId)!.state : State.HI_Z;
    return pin.inverted ? invert(s) : s;
  }

  private evaluate(gate: SimGate): void {
    let desired: Array<[PinSpec, State]>;
    switch (gate.type) {
      case 'AND': {
        let value: State = State.ONE;
        for (const pin of gate.inputPins) {
          const s = this.readInput(gate, pin);
          if (s === State.ZERO) {
            value = State.ZERO;
            break;
          }
          if (s !== State.ONE) value = State.UNKNOWN;
        }
        desired = [[gate.outputPins[0]!, value]];
        break;
      }
      case 'OR': {
        let value: State = State.ZERO;
        for (const pin of gate.inputPins) {
          const s = this.readInput(gate, pin);
          if (s === State.ONE) {
            value = State.ONE;
            break;
          }
          if (s !== State.ZERO) value = State.UNKNOWN;
        }
        desired = [[gate.outputPins[0]!, value]];
        break;
      }
      case 'XOR': {
        let value: State = State.ZERO;
        for (const pin of gate.inputPins) {
          const s = this.readInput(gate, pin);
          if (s === State.ONE) value = value === State.ONE ? State.ZERO : State.ONE;
          else if (s !== State.ZERO) {
            value = State.UNKNOWN;
            break;
          }
        }
        desired = [[gate.outputPins[0]!, value]];
        break;
      }
      case 'BUFFER': {
        const s = this.readInput(gate, gate.inputPins[0]!);
        const value = s === State.ZERO || s === State.ONE ? s : State.UNKNOWN;
        desired = [[gate.outputPins[0]!, value]];
        break;
      }
      case 'DRIVER':
        desired = [[gate.outputPins[0]!, gate.driverValue]];
        break;
      case 'NODE':
        desired = [];
        break;
    }
    for (const [pin, raw] of desired) {
      const value = pin.inverted ? invert(raw) : raw;
      if ((gate.drives.get(pin.name) ?? State.HI_Z) !== value) {
        this.queue.push({ time: this.time + GATE_DELAY, seq: this.seq++, gateId: gate.id, pin: pin.name, value });
      }
    }
  }
}
