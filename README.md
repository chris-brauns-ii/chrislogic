# chrislogic

A web recreation of [CEDAR Logic Simulator](https://sourceforge.net/projects/cedarlogic/)
focused on UI parity for teaching digital logic design. TypeScript, Canvas 2D, no
framework in the editor.

## Current slice

- **Gates:** 2/3/4-input AND, toggle switch (IN), LED (OUT)
- **Sim:** event-driven core with CedarLogic's 5-value logic
  (`ZERO`, `ONE`, `HI_Z`, `CONFLICT`, `UNKNOWN`) and per-gate propagation delay
- **Editor:** click-to-place from the palette, drag pin-to-pin to wire,
  drag gates to move (wires follow), click a toggle to flip it, live wire
  colors matching the original (red=1, black=0, green=Hi-Z, blue=unknown,
  cyan=conflict), pan/zoom, delete
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
- No undo/redo, copy/paste, save/load, buses, rotation, or multi-select yet
- An LED's four pins don't merge nets the way the original's NODE type does

## Reference

The original C++ source (BSD) informs behavior and rendering:
https://github.com/CedarvilleCS/CedarLogic
