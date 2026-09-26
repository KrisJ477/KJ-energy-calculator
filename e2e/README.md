# End-to-end run in manual mode (SPEC §0 test list)

This folder holds the harness used to run the app end to end against the two
test projects (Brf Blodnävan, Forsåker Kv 39) in **manual mode**, i.e. with a
human answering every AI request bundle. Nothing here is part of the app.

## Parts

- `server.cjs` – static no-cache server for the repo on 127.0.0.1:8123.
- `drive.cjs` – Playwright driver. `node drive.cjs serve` starts a persistent
  headless Chromium (profile in `e2e/profile/`), hooks `showDirectoryPicker`
  so the manual-mode exchange folder is the browser's OPFS, and listens on
  127.0.0.1:8124 for commands. `c.sh <cmd> [args]` sends a command:
  `init <brief.md> <name> <age> <tout> <tin> <vent>`, `upload <files…>`,
  `pull` (copies new request bundles from OPFS to `e2e/exchange/requests/`),
  `push` (writes `e2e/exchange/responses/<id>.json` into OPFS),
  `eval "<js>"` (`store` and `ctx` are in scope; the code must `return`),
  `shot <view>`, `reload`, `status`.
- `reqinfo.py` – lists pulled requests (job type, sheet, tile, level).
- `compile.py <id> answers/<id>.txt` – compiles a compact hand annotation into a
  schema-valid response for a tile, vertical, or overview request. The line
  syntax is documented at the top of the file; `answers/` holds every
  annotation written during the runs (request ids are session specific).
- `checkresp.mjs <id>` – validates a response against the request's schema
  with the app's own validator.
- `combine.py <id> [plan_px_per_m] [vertical_px_per_m] [snap_m]` – the manual
  answer for a combined-pass request: merges the tile data of the base sheet
  (collinear segments, endpoint snapping within `snap_m`, room and opening
  de-duplication, opening heights from the vertical reads).
- `overlay.py`, `overlay_combined.py` – draw an answer over the tile / overview
  image for visual checking. `tileassist.py` detects thick black bands on
  bilevel scans as a starting point for wall annotation.
- `rerun_combined.sh "<levels>"` – re-runs the combined pass for the given
  levels and answers each request with `combine.py`.

## Flow used

1. `node server.cjs &`, `node drive.cjs serve &`.
2. `c.sh init …`, `c.sh upload <pdf/tiff…>`.
3. `c.sh eval "ctx.runner.fullRead()…"`, then repeat: `c.sh pull`,
   annotate every pending request (`answers/<id>.txt`), `compile.py`,
   `checkresp.mjs`, `c.sh push`, until the read is done.
4. Floors, scale, corrections, constructions, gaps, 3D, audit through the UI
   (or `c.sh eval` on the store for repeatable steps), `c.sh shot <view>`.

The drawings themselves are not in the repository (Google Drive project
folders, see docs/PROJECT-PREPARATION.md).
