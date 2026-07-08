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
  drag pin-to-pin to wire, drag gates to move (attached wires re-route live,
  like the original), click a toggle to flip it, live wire colors matching
  the original (red=1, black=0, green=Hi-Z, blue=unknown, cyan=conflict),
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

## Roadmap

Ordered roughly by impact for the teaching use case. The guiding rule:
match CedarLogic's editor feel first, add new capabilities second.

### 1 — Keep circuits (next up)

- [ ] Save/load to localStorage with autosave
- [ ] Export/import circuit files (JSON first; `.cdl` compatibility below)
- [ ] Copy/paste with id remapping (original: `cmdPasteBlock`)
- [ ] Multi-select: rubber-band selection, group move/delete
  (original: `DRAG_SELECT`/`DRAG_SELECTION`)

### 2 — Sequential logic (unlocks the second half of a DLD course)

- [ ] Clock gate (variable-rate square wave) — needs the sim to step
  continuously instead of settling once per edit
- [ ] Pause/step/resume simulation controls
- [ ] D and JK flip-flops, registers (defs already in `cl_gatedefs.xml`;
  logic types `REGISTER`/`JKFF` need porting)
- [ ] Pulse gate (one-shot on click) and keypad
- [ ] Oscilloscope window with named feeds (original: `OscopeFrame`)

### 3 — Editor parity polish

- [ ] Gate rotation/mirroring (gui params the original already stores)
- [ ] Labels and TO/FROM wireless connectors
- [ ] Show potential-connection highlights while dragging a selection,
  auto-connect overlapping pins on drop (original: `GUICanvas` hotspot pass)
- [ ] Preserve user wire adjustments across net merges
- [ ] Zoom-to-fit, minimap (original: `klsMiniMap`)
- [ ] Touch/trackpad input with forgiving hit targets (chance to beat the
  original, which assumes a precise mouse)

### 4 — The wide part: MSI components and buses

- [ ] Multi-bit buses (wire state is already a vector in the original;
  bus color blends by value)
- [ ] MUX / decoder / priority encoder / adder / comparator logic types
- [ ] RAM/ROM with the popup memory editor (original: `RamPopupDialog`)
- [ ] Parse the full 100+ gate `cl_gatedefs.xml` and organize the palette
  into the original's library groups

### 5 — Beyond parity

- [ ] Open original `.cdl` circuit files (original: `CircuitParse`) so
  existing course material just works
- [ ] Multi-tab circuits, per-tab autosave
- [ ] Shareable circuits: thin backend (Rails) with accounts, classes,
  and assignment links — deferred until the editor earns it
- [ ] Guided-lab mode: instructor-authored checkpoints the sim can verify
  (e.g. "build a circuit matching this truth table")

## Known simplifications (vs. CedarLogic)

- Merging two wires re-routes a bridge between the joined pins rather than
  preserving every user adjustment on both nets
- An LED's four pins don't merge nets the way the original's NODE type does

## Reference

The original C++ source (BSD) informs behavior and rendering:
https://github.com/CedarvilleCS/CedarLogic
