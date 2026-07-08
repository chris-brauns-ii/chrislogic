import gatesXml from './gates.xml?raw';
import { parseGateDefs, type GateDef } from './gatedefs.ts';
import { Editor } from './editor/editor.ts';
import { makeThumbnail } from './editor/render.ts';

const defs = parseGateDefs(gatesXml);

const PALETTE: Array<{ name: string; label: string }> = [
  { name: 'AA_TOGGLE', label: 'Toggle (IN)' },
  { name: 'GA_LED', label: 'LED (OUT)' },
  { name: 'AA_INVERTER', label: 'NOT' },
  { name: 'AA_AND2', label: '2-input AND' },
  { name: 'AA_AND3', label: '3-input AND' },
  { name: 'AA_AND4', label: '4-input AND' },
  { name: 'AE_OR2', label: '2-input OR' },
  { name: 'AE_OR3', label: '3-input OR' },
  { name: 'AE_OR4', label: '4-input OR' },
  { name: 'AI_XOR2', label: '2-input XOR' },
  { name: 'AI_XOR3', label: '3-input XOR' },
  { name: 'AI_XOR4', label: '4-input XOR' },
  { name: 'BA_NAND2', label: '2-input NAND' },
  { name: 'BE_NOR2', label: '2-input NOR' },
  { name: 'AO_XNOR2', label: '2-input XNOR' },
];

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const hint = document.getElementById('hint')!;
const palette = document.getElementById('palette')!;

const items = new Map<string, HTMLElement>();

const editor = new Editor(canvas, hint, (def: GateDef | null) => {
  for (const [name, el] of items) el.classList.toggle('active', def !== null && name === def.name);
});

for (const entry of PALETTE) {
  const def = defs.get(entry.name);
  if (!def) throw new Error(`missing gate def: ${entry.name}`);

  const item = document.createElement('div');
  item.className = 'palette-item';
  item.appendChild(makeThumbnail(def, 100, 48));
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = entry.label;
  item.appendChild(label);
  item.addEventListener('mousedown', (e) => {
    e.preventDefault(); // keep thumbnail from starting a native drag
    editor.beginPaletteDrag(def, e);
  });
  palette.appendChild(item);
  items.set(entry.name, item);
}

// Demo circuit: a full adder. Sum = A^B^Cin, Cout = AB + Cin(A^B).
function buildFullAdder(): void {
  const g = (name: string) => defs.get(name)!;
  const tA = editor.place(g('AA_TOGGLE'), -16, 6);
  const tB = editor.place(g('AA_TOGGLE'), -16, 2);
  const tC = editor.place(g('AA_TOGGLE'), -16, -4);
  const xor1 = editor.place(g('AI_XOR2'), -8, 4);
  const xor2 = editor.place(g('AI_XOR2'), 0, 2);
  const and1 = editor.place(g('AA_AND2'), -8, -2);
  const and2 = editor.place(g('AA_AND2'), 0, -6);
  const or1 = editor.place(g('AE_OR2'), 8, -4);
  const sum = editor.place(g('GA_LED'), 8, 2);
  const cout = editor.place(g('GA_LED'), 16, -4);

  editor.wire([[tA, 'OUT_0'], [xor1, 'IN_0'], [and1, 'IN_0']]);
  editor.wire([[tB, 'OUT_0'], [xor1, 'IN_1'], [and1, 'IN_1']]);
  editor.wire([[tC, 'OUT_0'], [xor2, 'IN_1'], [and2, 'IN_1']]);
  editor.wire([[xor1, 'OUT'], [xor2, 'IN_0'], [and2, 'IN_0']]);
  editor.wire([[xor2, 'OUT'], [sum, 'N_in0']]);
  editor.wire([[and1, 'OUT'], [or1, 'IN_0']]);
  editor.wire([[and2, 'OUT'], [or1, 'IN_1']]);
  editor.wire([[or1, 'OUT'], [cout, 'N_in0']]);
  editor.refresh();
}

buildFullAdder();
