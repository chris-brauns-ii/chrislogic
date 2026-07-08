import gatesXml from './gates.xml?raw';
import { parseGateDefs, type GateDef } from './gatedefs.ts';
import { Editor } from './editor/editor.ts';
import { makeThumbnail } from './editor/render.ts';

const defs = parseGateDefs(gatesXml);

const PALETTE: Array<{ name: string; label: string }> = [
  { name: 'AA_TOGGLE', label: 'Toggle (IN)' },
  { name: 'GA_LED', label: 'LED (OUT)' },
  { name: 'AA_AND2', label: '2-input AND' },
  { name: 'AA_AND3', label: '3-input AND' },
  { name: 'AA_AND4', label: '4-input AND' },
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
  item.appendChild(makeThumbnail(def, 100, 56));
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = entry.label;
  item.appendChild(label);
  item.addEventListener('click', () => editor.beginPlace(def));
  palette.appendChild(item);
  items.set(entry.name, item);
}
