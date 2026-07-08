# chrislogic

A web recreation of [CEDAR Logic Simulator](https://sourceforge.net/projects/cedarlogic/)
focused on UI parity for teaching digital logic design. TypeScript, Canvas 2D, no
framework in the editor.

## Current slice

- **Gates:** AND/OR/XOR (2/3/4-input), NAND, NOR, XNOR, inverter, toggle
  switch (IN), LED (OUT) — inversion bubbles are per-pin `<inverted>` flags,
  exactly as the original encodes them
- **Sim:** event-driven core with CedarLogic's 5-value logic
  (`ZERO`, `ONE`, `HI_Z`, `CONFLICT`, `UNKNOWN`) and per-gate propagation delay
- **Editor:** drag gates from the palette (or click, then click the canvas),
  drag pin-to-pin to wire, drag gates to move (wires follow), click a toggle
  to flip it, live wire colors matching the original (red=1, black=0,
  green=Hi-Z, blue=unknown, cyan=conflict), pan/zoom, delete, and
  undo/redo (Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z)
- **Demo:** boots with a working full adder (A, B, Cin toggles → Sum, Cout LEDs)
- **Gate library:** shapes and pin positions parsed from `src/gates.xml` —
  definitions extracted verbatim from CedarLogic's BSD-licensed
  `cl_gatedefs.xml`, so rendering matches the original

## Run

```sh
npm install
npm run dev    # dev server
npm test       # sim-core tests (Node 23.6+ runs TS natively)
npm run build  # typecheck + production build
```

## Known simplifications (vs. CedarLogic)

- Wires route automatically (star + elbows); the original's user-draggable
  wire segment trees are not implemented yet
- No copy/paste, save/load, buses, rotation, or multi-select yet
- An LED's four pins don't merge nets the way the original's NODE type does

## Reference

The original C++ source (BSD) informs behavior and rendering:
https://github.com/CedarvilleCS/CedarLogic
