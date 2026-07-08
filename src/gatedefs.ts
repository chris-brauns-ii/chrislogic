// Parser for CedarLogic's gate library format (cl_gatedefs.xml).
// The format is XML-ish but allows `#`-prefixed comment lines, including
// inside <shape> blocks, so it's parsed leniently rather than as strict XML.

export interface Hotspot {
  name: string;
  x: number;
  y: number;
  isInput: boolean;
  inverted: boolean; // NAND/NOR/XNOR/inverter pins carry <inverted>true</inverted>
}

export interface GateDef {
  name: string;
  caption: string;
  guiType: string;
  logicType: string;
  hotspots: Hotspot[];
  lines: Array<[number, number, number, number]>;
  circles: Array<[cx: number, cy: number, r: number]>; // inversion bubbles
  guiParams: Record<string, string>;
  logicParams: Record<string, string>;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1]!.trim() : '';
}

export function parseGateDefs(text: string): Map<string, GateDef> {
  const stripped = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

  const defs = new Map<string, GateDef>();
  for (const m of stripped.matchAll(/<gate>([\s\S]*?)<\/gate>/g)) {
    const block = m[1]!;

    const hotspots: Hotspot[] = [];
    for (const io of block.matchAll(/<(input|output)>([\s\S]*?)<\/\1>/g)) {
      const body = io[2]!;
      const [x, y] = tag(body, 'point').split(',').map(Number);
      hotspots.push({
        name: tag(body, 'name'),
        x: x!,
        y: y!,
        isInput: io[1] === 'input',
        inverted: tag(body, 'inverted') === 'true',
      });
    }

    const shape = tag(block, 'shape');
    const lines: Array<[number, number, number, number]> = [];
    for (const l of shape.matchAll(/<line>([\s\S]*?)<\/line>/g)) {
      const [x1, y1, x2, y2] = l[1]!.split(',').map(Number);
      lines.push([x1!, y1!, x2!, y2!]);
    }
    const circles: Array<[number, number, number]> = [];
    for (const c of shape.matchAll(/<circle>([\s\S]*?)<\/circle>/g)) {
      const [cx, cy, r] = c[1]!.split(',').map(Number); // 4th value (segment count) unused
      circles.push([cx!, cy!, r!]);
    }

    const params = (kind: string): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const p of block.matchAll(new RegExp(`<${kind}_param>([\\s\\S]*?)</${kind}_param>`, 'g'))) {
        const s = p[1]!.trim();
        const space = s.indexOf(' ');
        if (space > 0) out[s.slice(0, space)] = s.slice(space + 1).trim();
      }
      return out;
    };

    const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const [x1, y1, x2, y2] of lines) {
      bbox.minX = Math.min(bbox.minX, x1, x2);
      bbox.minY = Math.min(bbox.minY, y1, y2);
      bbox.maxX = Math.max(bbox.maxX, x1, x2);
      bbox.maxY = Math.max(bbox.maxY, y1, y2);
    }
    for (const [cx, cy, r] of circles) {
      bbox.minX = Math.min(bbox.minX, cx - r);
      bbox.minY = Math.min(bbox.minY, cy - r);
      bbox.maxX = Math.max(bbox.maxX, cx + r);
      bbox.maxY = Math.max(bbox.maxY, cy + r);
    }

    const def: GateDef = {
      name: tag(block, 'name'),
      caption: tag(block, 'caption'),
      guiType: tag(block, 'gui_type'),
      logicType: tag(block, 'logic_type'),
      hotspots,
      lines,
      circles,
      guiParams: params('gui'),
      logicParams: params('logic'),
      bbox,
    };
    defs.set(def.name, def);
  }
  return defs;
}
