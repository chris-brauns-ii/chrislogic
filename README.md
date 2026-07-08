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
  drag pin-to-pin to wire, drag gates to move (wires stay glued, spawning
  jogs as needed), click a toggle to flip it, live wire colors matching the
  original (red=1, black=0, green=Hi-Z, blue=unknown, cyan=conflict),
  pan/zoom, delete, and undo/redo (Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z)
- **Wires are segment trees** (CedarLogic's wireSegment model): auto-routed
  on creation, then user-owned — drag any segment perpendicular to tidy the
  diagram; neighbors stretch, pinned ends spawn jog stubs, collinear
  segments merge, and dead ends are pruned
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

- No copy/paste, save/load, buses, rotation, or multi-select yet
- Merging two wires re-routes a bridge between the joined pins rather than
  preserving every user adjustment on both nets
- An LED's four pins don't merge nets the way the original's NODE type does

## Reference

The original C++ source (BSD) informs behavior and rendering:
https://github.com/CedarvilleCS/CedarLogic
