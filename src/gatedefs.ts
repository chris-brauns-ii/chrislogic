// Parser for CedarLogic's gate library format (cl_gatedefs.xml).
// The format is XML-ish but allows `#`-prefixed comment lines, including
// inside <shape> blocks, so it's parsed leniently rather than as strict XML.

export interface Hotspot {
  name: string;
  x: number;
  y: number;
  isInput: boolean;
}

export interface GateDef {
  name: string;
  caption: string;
  guiType: string;
  logicType: string;
  hotspots: Hotspot[];
  lines: Array<[number, number, number, number]>;
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
    for (const io of block.matchAll(/<(input|output)>\s*<name>([\s\S]*?)<\/name>\s*<point>([\s\S]*?)<\/point>/g)) {
      const [x, y] = io[3]!.split(',').map(Number);
      hotspots.push({ name: io[2]!.trim(), x: x!, y: y!, isInput: io[1] === 'input' });
    }

    const lines: Array<[number, number, number, number]> = [];
    for (const l of tag(block, 'shape').matchAll(/<line>([\s\S]*?)<\/line>/g)) {
      const [x1, y1, x2, y2] = l[1]!.split(',').map(Number);
      lines.push([x1!, y1!, x2!, y2!]);
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

    const def: GateDef = {
      name: tag(block, 'name'),
      caption: tag(block, 'caption'),
      guiType: tag(block, 'gui_type'),
      logicType: tag(block, 'logic_type'),
      hotspots,
      lines,
      guiParams: params('gui'),
      logicParams: params('logic'),
      bbox,
    };
    defs.set(def.name, def);
  }
  return defs;
}
