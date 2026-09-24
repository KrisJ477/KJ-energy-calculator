# Heat Loss Calculation App — Specification (v1)

Date: 2026-09-24
Status: Under discussion. Not yet released for build. Section 9 lists open questions.

---

## 0. Implementation Instructions

Build this application strictly according to this specification.

- Every feature must be traceable to this document. Do not add features, tests, tooling, documentation or "nice to haves" that are not specified here.
- Do not make assumptions about unclear or ambiguous requirements. If you find a gap, a conflict, or something undefined, STOP and raise it for discussion. Do not resolve it yourself, and do not proceed on "he probably meant this".
- Section 9 lists questions already known to be open. Raise them before building the affected part.
- Where this document points to a standard (EN 12831, EN ISO 13370, EN ISO 10456, EN ISO 6946) for values or methods, do not invent numbers; ask which edition/source to use if unclear.
- Where a default value is given and marked "starting value", it is the user's own guess to be tuned, not a sourced figure.

---

## 1. Purpose

A web app that reads architectural drawings (PDF plans, sections, elevations) of existing buildings, typically older ones, builds a simplified building model, and performs room-by-room heat loss calculations of the kind the user currently produces in MagiCAD Room. The result does not need to be perfect, but it must be good and auditable.

The core of the app is: drawing reading + the simplified transmission/ventilation/infiltration calculation. IFC export is not part of v1.

---

## 2. Architecture (decided)

- Web app, no desktop install. The 3D models are small and simple.
- Frontend: static files, 3D viewer built with Three.js.
- Backend: a Cloudflare Worker that holds the Anthropic API key and forwards requests. The key never lives in the browser.
- Access: simple password protection. The password is stored as a secret in the Worker. The app asks for it once and remembers it in that browser. The Worker rejects any request without the correct password.
- Deployment: GitHub → Cloudflare, same pattern as the user's existing static sites.
- PDF handling: pages are rendered to images in the browser with PDF.js and sent to the API. Where the PDF has a text layer, text (room names, dimension strings, labels) is extracted directly instead of being read visually. Scanned PDFs fall back to vision for everything.
- Geometry is read by vision only in v1. No extraction of vector line work from the PDF.
- Models: Claude Opus for the full initial read and the combined pass (4.2). Claude Haiku for regional re-reads during 2D correction. Cost is not a factor at this scale (well under one dollar per building); accuracy is.
- The 3D model is always generated from the approved 2D data plus stacking data. It is never edited as its own thing. Properties and overrides live on objects and survive regeneration (3.11).
- Project persistence, both of:
  - Autosave in the browser: the current project (drawings, geometry, edits, constructions, settings) is saved continuously in browser storage and restored when the app is reopened. Protects against refresh, closed tab or crash. Lives only in that browser on that computer; lost if browser data is cleared.
  - Project file: "Save" downloads the whole project as one file; "Open" loads it back. For backup and for moving a project between computers. Nothing is stored on a server.

---

## 3. Data Model

Design principle: the model is built around what the calculation needs, not around perfect geometry. Per room the calculation needs: area, height/volume, the bounding surfaces with type/area/U-value, what is on the other side of each surface, and ventilation/infiltration data.

### 3.1 Golden rule
Every surface (wall segment, floor/ceiling piece, slab piece) separates exactly two spaces. A space is a room, outside air, soil, or an annotated zone. If a wall runs along three rooms it is split at the junctions. If a room's ceiling has two rooms above it, the ceiling is split into two pieces. A surface bordering three spaces is a bug, not a case to handle.

### 3.2 Room
- id: room number in the form `level-index`, no zero padding (1-9, 11-21). Index is a running number per floor. When a floor is copied to other floors (4.4), indexes carry over, so 3-7 and 8-7 are the same room in different apartments. When a room is split by a separator, the largest resulting room keeps the number and the others take the next free indexes on that floor. Nothing is ever renumbered.
- Level numbers: taken from the drawings where the drawings number the floors ("Plan 1", "Plan 2"). A floor that only has a name is numbered from its neighbour: a basement ("Källare") gets the number one below the floor above it (below Plan 1 → 0, the next basement down → −1); an attic ("Vind") gets the number one above the floor below it. The user confirms the floor list.
- floor
- name (from drawing text or user)
- room_type, with confidence flag and short reasoning ("kitchen: sink and stove symbols present"). Low confidence is flagged.
- area, height (= floor-to-floor, 4.6), volume
- heated: true/false. Default true. The user turns it off for unheated spaces (stairwells, storage, garage). No room-type rule.
- setpoint temperature: input for heated rooms (project default, overridable per room or in bulk); solved output for unheated rooms (5.2)
- ventilation flow (rule table by room type, overridable)
- infiltration, air changes per hour: derived with the EN 12831 method from an air-tightness value n50 (air changes per hour at 50 Pa) set per age category (3.14), overridable.
- comments (free text)
- origin/edit tag (3.10)

### 3.3 Wall (one object per segment)
- id, floor
- centerline geometry, measured thickness (raw value from the read, kept as read)
- wall_type reference (W1, W2, …) → construction → U-value
- side_a, side_b: space ids (room, "outside", "soil", zone)
- percent_underground (exterior walls only, default 0)
- origin/edit tag

Temperatures are never stored on walls. The calculation pulls each side's temperature from the room, the building configuration (outdoor, soil) or the annotated zone.

A wall with percent_underground > 0 is split horizontally into two segments, one "to soil" and one "to outside air", same U-value. Changing the percentage re-splits.

### 3.4 Floor / ceiling pieces between floors
- Generated by overlapping the room polygons of adjacent floors. One piece per overlap area, so a ceiling under two rooms becomes two pieces (3.1).
- Slivers below a threshold caused by imperfect alignment are absorbed into the neighbouring piece (threshold open, 9.2).
- Area with no room above: goes to roof or outside air. Area with no room below: goes to the ground slab (3.5) or outside air.
- Between stacked unheated spaces such as a stairwell, the piece is of a special "fake floor" type with a very high U-value (default 100 W/m²K, settings page, 3.14), so heat passes almost freely and the solved temperatures even out upward (5.2).

### 3.5 Ground slab
- Split into a perimeter band and an inner area. Band width user-set, default 3 m.
- Band goes to a "soil near facade" temperature, inner area to a warmer "deep soil" temperature. Both are project configuration values, shown as separate rows in the room breakdown. Starting values: band 5 °C, inner 12 °C, to be tuned against the ISO 13370 total below.
- One slab construction, same U-value for both zones. Rooms straddling the band boundary get two floor surfaces (3.1).
- Verification: the building's total slab loss is computed once with EN ISO 13370 (building-level B′ = A/(½P), equivalent thickness, soil conductivity default per the standard) and shown next to the summed per-room slab loss. Both numbers are shown side by side, with no automatic warning or threshold; the user judges any disagreement and adjusts the zone temperatures if needed. The app never adjusts them itself. ISO 13370 is NOT applied per room; per-room application breaks down (interior rooms → zero, corner rooms → inflated).

### 3.6 Roof and attic
- Roof treated as a flat surface for calculation. User assigns roof construction / U-value.
- Cold attic: not modelled and not calculated. An unheated attic is simply outdoor air: the top-floor ceiling (its own floor type, 3.8) goes straight to outdoor temperature. No attic room, no attic volume, no gable walls, no solved attic temperature.
- Partly heated attic (very unusual): the user annotates the heated area on the plan (zone annotation, 3.9) and sends it back to the AI to be read in as a room.
- When no attic appears in the drawings: the top ceiling is the roof (roof construction), straight to outdoor air.

### 3.7 Window / Door
- id, parent wall id, type (window/door)
- All doors are modelled, interior doors (in walls between two spaces) as well as exterior doors. Doors between rooms at the same temperature contribute nothing; doors to colder spaces (e.g. a flat's front door to an unheated stairwell) do.
- Default door types: one for exterior doors and one for interior doors, each with its own construction and U-value (3.8). The user can add further door types.
- width (from plan, reliable)
- height: null, or an estimated value with confidence:
  - HIGH: found in a vertical drawing (section or elevation) that this opening maps to. ±50 mm is acceptable.
  - MEDIUM: not found, but same room type and same width as openings whose height is known (other kitchen windows).
  - LOW: not found, not same room type, but same width and same look (opening symbol etc.) as a known opening.
- source and reasoning string, shown on inspection
- vertical-drawing link: if found, the object also carries its coordinates in that drawing so the user can jump there with the opening framed
- construction type → U-value
- origin/edit tag

### 3.8 Constructions and materials
- Material library: name, lambda (W/mK). Populated from EN ISO 10456 design values; manufacturer data added by the user for specific products. The builder does not type values from memory.
- Construction: an ordered list of layers (material, thickness). U-value calculated from the layers (surface resistances per EN ISO 6946). A U-value may alternatively be entered directly (e.g. a known window type).
- Wall types (W1, W2, …), floor types (F1, F2, …), roof types, slab, window/door types each reference a construction.
- Floor types apply to the floor/ceiling pieces between storeys (3.4). Default assignment: all pieces between storeys get one floor type, except the top-floor ceiling below a cold attic, which gets its own, separate floor type. The user can reassign individual pieces to other floor types (e.g. timber joist floor in the main building, concrete over the basement). Fake floors (3.4) are not floor types.
- Full traceability chain: room loss ← surface ← wall type ← construction ← layers ← material. Changing a material's lambda or a layer's thickness recalculates everything downstream immediately, visible in the chain.
- A material or construction in use cannot be deleted, only changed.

### 3.9 Zone annotation
For partly heated attics and similar: the user draws a rectangle and writes a comment ("this part heated to 12 °C, rest is outside temperature"). The app treats the rectangle edge as a boundary with the given temperature on that side.

### 3.10 Origin / edit tag
Every object records whether it came from the machine read, was changed by an AI regional re-read on a user comment, was changed by the experimental command window (4.11), or was edited by the user. Required so that a later re-read can flag human edits before overwriting them.

### 3.11 Object identity across regeneration
Overrides and assignments live on objects. When a 2D edit or a re-read splits or merges an object (a separator through a room with a ventilation override, a re-read splitting a wall with a construction assignment), the override is carried to all resulting objects and flagged for review. It is never silently dropped.

### 3.12 Virtual separators
A user-drawn line with no thickness and no U-value. It splits an open space into separate rooms (open kitchen / hallway / living room, or zoning a large office). Room detection treats it as a boundary; the calculation sees no transmission across it. Ventilation is applied per resulting room. Separators and zone annotations survive every kind of re-read (4.5).

### 3.13 Sheets
A floor may be drawn across several PDF sheets (two, three or more). Each sheet object has: floor, part-of-floor, crop rectangle (excludes title block and frame), its own scale, and its position relative to the floor composite (4.3). All downstream objects belong to the floor, never to a sheet.

### 3.14 Building configuration
- age category, used only to set the default air-tightness n50 for infiltration (3.2, 4.8, 5.1). There is no building type setting. Categories follow Swedish building code eras. n50 values are starting values (engineering estimates bounded by Swedish/Nordic measurements and code requirements, multi-family values used for all buildings), to be verified (9.6):
  - before 1941: n50 = 4.0 /h
  - 1941–1960: n50 = 3.0 /h
  - 1961–1975: n50 = 2.0 /h
  - 1976–1990: n50 = 1.5 /h
  - 1991–2005: n50 = 1.2 /h
  - 2006 and later: n50 = 0.8 /h
- infiltration shielding class (EN 12831:2003): none / moderate / heavy, project-wide, default moderate
- fake floor U-value (3.4): default 100 W/m²K
- base ventilation flow: default 0.35 l/s per m² floor area, project-wide, overridable per room. Deliberately not called a minimum: the user may set it lower, including zero, project-wide or per room (5.1).
- outdoor design temperature: a single value typed by the user in the wizard, no table
- default indoor setpoint: one project value
- soil temperature for walls below grade (default 8 °C), slab band and inner zone temperatures (3.5)
- ventilation system: FTX with heat recovery / mechanical exhaust / natural. Determines supply air temperature (FTX default 18 °C; exhaust or natural: outdoor air).
- thermal bridge surcharge: project-wide percentage on transmission, default 15 %
- snap tolerance for geometry cleanup, default 100 mm (9.1)
- ground slab band width, default 3 m
- vertical-drawing sanity range: door height 2.0–2.2 m. Door height is the only sanity check (no ceiling height check).
- scale truth: reference features (north wall, west wall lengths) established on the reference floor (4.4)

All configuration values live on one settings page.

### 3.15 Measurement basis
- Room floor area and volume: to the inside faces of the bounding walls (the actual heated space, Swedish room area convention). Volume = inside area × room height (4.6).
- Exterior walls, roof and ground slab: outside dimensions (conservative; permitted by EN 12831, roughly covers corner losses).
- Interior walls between spaces: centreline dimensions.
- Floor/ceiling pieces between floors (3.4): from the overlap of the rooms' inside-face polygons.
- Openings: wall areas are net. Window and door areas are subtracted from the wall they sit in and counted as separate surfaces with their own U-value.

---

## 4. Workflow

### 4.1 Setup wizard
User answers: age category, outdoor design temperature, default indoor setpoint, ventilation system type, supply air temperature if FTX. These prime the read (ventilation defaults, infiltration defaults).
- Age category: the wizard explains what the choice is used for (the default infiltration, air leakage through the building envelope) and shows the infiltration value used for each interval next to it, so the user sees the consequence of the choice before picking.

### 4.2 Upload and full read
- User uploads all drawings (plans, sections, elevations, any mix). Sections and elevations are one category, "vertical drawings", and follow the same rules throughout: scaled the same way, mined for heights the same way. Elevations are usually the better source for window heights (whole facades); sections for floor heights and ground datum.
- All reading passes run first, across all drawings, before the user is asked anything.

How the read runs (decided):
- One call per sheet, run in parallel, each at full resolution. The stitched composite of a multi-sheet floor is never sent as one image.
- Then one combined pass over the extracted data of all sheets (plus crops where needed) for cross-drawing work: matching openings between plans and vertical drawings, comparing the same wall in neighbouring apartments and on the floor above, gap classification, and seam handling for multi-sheet floors (4.3).
- Structured output: every read returns a fixed JSON schema (drawing classification, walls, rooms, openings, gaps, text labels), each item with confidence and reasoning. The builder defines the schema. The model never returns prose.
- Prompt context: the wizard answers, the floor list so far, and for the combined pass the extracted data from all drawings.
- Coordinates are in image pixels; scaling to millimetres is the app's job, not the model's.
- The read may not invent geometry to close a room. Uncertain stays uncertain.
- Match lines, sheet frame edges and title block borders are not walls. The reader is told this explicitly.
- Rendering resolution and tiling of large pages into overlapping crops: open until real drawings have been tried (9.3).
- Prompts are versioned and stored with the project, so a later re-read can state which prompt version produced the model.

What is read:
- Per sheet: classify type (plan / vertical) and which floor(s), and which part of the floor, it shows.
- Per plan: walls as centerlines with measured thickness, enclosed rooms, openings with width, text labels.
- Per vertical drawing: floor-to-floor heights, opening heights, ground level, roof/attic.
- Gaps in walls: every gap is a question, not a fact. The reader classifies each as opening, artifact (faded line, closed), or uncertain, using context: door symbols, the same wall in the neighbouring apartment, the floor above, whether the room would otherwise be unbounded. Each gap is an object with classification and reasoning. Uncertain gaps are flagged for 2D review. Nothing is silently closed.
- Output: everything found, plus a single consolidated gap list (4.7).

### 4.3 Multi-sheet floors
Assembling:
- Each sheet gets a crop rectangle so its title block and frame do not overlap the neighbour's content.
- Each sheet is scaled on its own (4.4 method), or via a wall it shares with an already-scaled sheet of the same floor.
- Position: the user clicks the same point on two overlapping sheets (a wall corner near the match line) and the app aligns them. The app may propose the match from shared walls in the overlap strip; the user confirms, or corrects it in manual alignment mode (4.4).
- The floor's reference features for scale correction (4.4) are measured on the assembled composite, not on one sheet.

Showing:
- Each sheet is a layer. Paper white is made transparent. Two sliders per sheet: paper opacity and line opacity. The vector overlay sits above all sheet layers. Nothing is cut, so no text is lost at a seam.

Reading:
- Sheets are read separately (4.2). The combined pass handles seams on the extracted data: walls continuing across a seam are joined, duplicates in the overlap strip are removed by position, rooms are formed on the merged set, labels deduplicated. Everything downstream sees one floor.

### 4.4 Scale
Scale is the most critical step. From experience, AI gets it wrong often, and every downstream area scales with it squared.

Reference floor (truth):
- The reference floor is the floor with the best drawing for the job (clearest, most complete, scale stamp or dimension text present), not necessarily floor 1. The app proposes one; the user confirms or picks another.
- The app makes an initial guess: from a scale stamp if present; otherwise it finds a door and assumes 1 m width.
- The guess is shown as a red reference bar with two draggable end anchors and a label with its assumed real length ("this line is assumed to be 1 m") and the method that produced it.
- The user drags the anchors to two known points and types the real distance. This sets the reference floor scale.
- The app identifies two reference features at an angle to each other, typically the north wall and the west wall, and stores their lengths.

All other floors:
- The app finds the same two reference features on each floor and computes the correction that makes them match the reference floor.
- If both features need approximately the same correction, it is applied automatically so all floors share one truth. A stripe of "exterior" ceiling in the middle of the building from a misaligned floor is exactly the bug this prevents.
- If the two features need clearly different corrections (north +2 %, west +20 %), the floor is flagged: skewed drawing, or a different section of the building. The user decides, using manual alignment mode (below).
- Two references at an angle also catch rotational skew.

Vertical drawings:
- Scaled to the same truth via one reference feature shared with the plans (e.g. the north wall). Only one vector is available because of the viewing angle, so no cross-check.
- Sanity checks instead, using the configured ranges (3.14): door heights 2.0–2.2 m; any printed scale bar must agree. Failed checks flag the drawing, which can then be corrected in manual alignment mode (below).

Manual alignment mode:
One tool for every case where the machine cannot match scale, stacking or sheet assembly: a floor against the reference floor or the floor below, a sheet against its neighbouring sheet of the same floor (4.3), a vertical drawing against the plans.
- Opens automatically on any flagged mismatch (scale correction disagreement, stacking deviation (4.6), unresolved sheet seam, failed vertical-drawing sanity check), and from a button at any time.
- Display: the layer being aligned is overlaid on the reference layer. Each layer has its own opacity slider and colour tint (e.g. reference blue, moving layer red), so matches and mismatches are visible.
- Primary method, point pairs: the user clicks a point on the reference, then the same point on the moving layer (stair corner, exterior wall corner), twice. From the two pairs the app computes move, rotation and uniform scale exactly.
- Fine adjustment: drag to move, rotate handle, scale field/slider, arrow-key nudging.
- Non-uniform scale: separate horizontal and vertical scale factors are allowed, for drawings stretched in one direction (typically bad scans). Available only in this manual tool, never applied automatically, and shown with a clear warning on the layer.
- Vertical drawings: same tool, constrained to what the view allows: one point pair along the shared horizontal dimension plus a height reference (e.g. a floor level line).
- Live feedback: the reference feature lengths (north wall, west wall) and their deviation in % against the reference floor are shown while aligning.
- No re-read: alignment changes only the layer's placement transform. Geometry already read from that layer moves with it; no AI calls are made.
- Audit: the resulting scale/placement records its method as "manual alignment" together with the point pairs used (7).
- This places whole layers only. It is not a geometry editing tool; the "manual geometry tools beyond delete" exclusion (8) is unaffected.

Copying floors:
- After a floor is approved (4.5), the user can apply it to a range of floors ("apply to floors 3–9"). The app copies geometry, wall types, openings, room names and numbers, then diffs against each target floor's own read and flags every difference for the user. Room numbers carry over with the floor level changed (3.2).

### 4.5 2D approve and adjust, floor by floor
Display:
- Backdrop: the sheet layers (4.3). Overlay: the vector interpretation. The user can switch and fade layers.

Geometry cleanup (mechanical, before rooms are formed):
- Wall endpoints within the snap tolerance of another wall are snapped onto it. Overshoots shorter than the tolerance are trimmed. Near-collinear consecutive segments of the same thickness are merged.
- The snap tolerance is for numeric jitter only. Anything larger is a gap and is handled by the read's gap classification (4.2), never auto-closed.
- Default 100 mm, very much open (9.1).

Wall type mapping:
- All measured wall thicknesses are listed. An adjustable tolerance band clusters similar values; clusters are colour-coded on the plan across all floors.
- The user assigns clusters to wall types (300 and 310 → W1, 250 → W2). Better to discover too many groups than too few.
- Each wall keeps its raw measured thickness. The band is UI only; changing it regroups instantly with no re-read.

Opening mapping:
- Same method for windows and doors, grouped by (width, estimated height) with the confidence score visible. User assigns groups to window/door types.
- Each opening has a button to jump to its linked vertical drawing with the opening framed.

Room mapping:
- Room type guesses shown with confidence and reasoning. User corrects names/types.
- User draws virtual separators and zone annotations where needed.
- User sets percent_underground per exterior wall, or accepts the machine guess from the ground datum found in vertical drawings.
- User resolves flagged uncertain gaps.

Corrections (primary method):
- The user clicks a wall/opening/region and leaves a plain-language comment, in Swedish ("det här är inte en vägg", "detta är två väggar").
- Comments are batched per floor, not sent one by one.
- On request, the app sends the region image plus comments to Haiku, which re-reads that region only and updates it. Changes are highlighted and recorded on the object (3.10).

Manual tools: delete only. Click a line or wall and delete it (junk, hatching, scan artifacts). No merge, no snap, no move. Everything else goes through comments; further tools are added only if the comment method proves too slow or unreliable.

Re-read / new underlay dialog (one dialog, two triggers: the user orders a machine re-read of a floor, or imports a new underlay for a floor):
- Swap underlay only: the new image replaces the backdrop and is auto-rescaled to the existing geometry using the reference features. Layout and walls untouched.
- Re-read, keep my edits: the re-read runs, then every object with a human or AI-corrected tag is restored over the new result. The app lists objects it could not match to a new object.
- Re-read, discard my edits: clean re-read; everything on that floor returns to machine origin.
- Cancel.
Separators and zone annotations survive in all cases.

### 4.6 Stacking
- Assumption: floors are of equal footprint and stack directly. Deviations are special cases and are flagged; a floor that is misplaced over the one below is corrected in manual alignment mode (4.4).
- Room height = floor-to-floor height. Slab thickness is ignored in all calculations (wall area and volume come out slightly high, which is the conservative side). Slabs get a fixed display thickness in 3D that is used nowhere in the calculation.
- Floor/ceiling pieces from polygon overlap (3.4). Bottom floor sits on the ground slab (3.5); top floor gets the roof, or the top-floor ceiling to outdoor air when there is a cold attic (3.6).
- Spaces spanning floors (stairwells, shafts, double-height rooms): one room per floor, connected vertically by fake floors (3.4), typically marked unheated by the user.
- Anything that looks like an exterior wall is treated as exterior with outdoor temperature outside it, unless the user overrides (shared wall with an adjoining building).
- Floor heights come from vertical drawings where found; otherwise they appear in the gap list.

### 4.7 Gap dialog
Asked once, after all reads, only for what blocks 3D or the calculation:
- Floor heights, when no vertical drawing gave them.
- Floor order, only if the drawing labels leave it unclear which is bottom and top.
- Underground percentage, only where no ground datum was found to guess from.
- Attic: is there a cold attic above the top floor (decides whether the top ceiling uses the roof construction or the top-floor ceiling type), only when no vertical drawing shows it.
- Opening heights: when a group of windows or doors has no height from any source, asked once per group.
Nothing else. Unheated rooms are a flag in the room panel, not a gap.

### 4.8 Constructions and ventilation assignment
Sits before 3D generation, so the first 3D view already shows watts.
- Wall types, roof, slab, window/door types are assigned constructions (3.8).
- Ventilation rules by room type (0.35 l/s per m² for general rooms, a fixed 20–30 l/s for kitchens), applied via the room type classification, overridable per room. Supply air temperature from the system type.
- Infiltration per room from EN 12831 defaults by building age, overridable per room.
All of it remains changeable later in audit mode.

### 4.9 3D model
- Generated from the approved 2D data plus stacking data.
- Walls extruded with thickness, floors/ceilings/roof as slabs with display thickness, windows and doors as sized solids cut into walls. Everything is visible geometry.
- Each room shown as a translucent coloured box for its extent, plus a small hovering orb at its centre as the click handle, so the room object does not get in the way of selecting walls and floors.
- User can rotate, zoom, pan.

### 4.10 Audit mode: 3D review and list view
Room panel (click a room orb):
- Shows: room number, total heat loss in watts at design conditions, split into ventilation, infiltration, and transmission per surface, with the thermal bridge surcharge shown as its own row.
- Editable here: name, room type, heated/unheated, setpoint, ventilation flow, infiltration ach, comment.
- Not editable here: geometry, wall types, U-values (those go through 2D and constructions).
- Bulk edit: select several rooms by freehand selection in 3D or by room type from a list, and change any of the editable fields for all of them at once.

List view (separate tab):
- All rooms with their number and watts.
- Selecting a room: it stays solid in 3D, everything else drops to 90 % transparency. Its bounding elements (walls, openings, floor, ceiling) are colour-coded to matching rows in the room's breakdown list showing watts, m² and ΔT per element. Ventilation and infiltration are rows without a colour.

Iteration:
- The user changes values in the panel and the app recalculates.
- The user can go back to 2D, fix geometry, and regenerate 3D; overrides are carried and flagged (3.11).

### 4.11 Command window (experimental)
- A free-text window for project-wide changes ("change ground temperature to 5 °C across the project"), clearly labelled experimental.
- Rule: on any ambiguity the model must ask back before touching anything, and the UI is built around that exchange. "Change ground temperature to 5 °C" returns "for the wall soil temperature, the slab band, the inner zone, or all three?" and nothing changes until the user answers.
- Every change it makes is listed afterwards, object by object, and tagged on the objects (3.10), so the user can see exactly what was touched.
- This is separate from the regional comment corrections in 4.5, which are scoped to one object or region on one floor.

---

## 5. Calculation

### 5.1 Method
Room-by-room, EN 12831 style, steady state, three buckets per heated room:
- Transmission through every bounding surface: U × A × (T_room − T_other_side), where the other side is a room (heated or solved unheated), outside air, soil (walls), slab zone temperature, or an annotated zone. Multiplied by (1 + thermal bridge surcharge).
- Ventilation: flow × air heat capacity × (T_room − T_supply).
- Infiltration: room volume × ach × air heat capacity × (T_room − T_outside), with ach = 2 × n50 × e × ε per EN 12831:2003. Both factors are derived per room from the model:
  - e (shielding coefficient) from the number of the room's exterior walls that contain openings, using the project shielding class (3.14): 0 such walls → e = 0; 1 → none 0.03 / moderate 0.02 / heavy 0.01; more than 1 → none 0.05 / moderate 0.03 / heavy 0.02.
  - ε (height correction) from the room's height above ground level: 0–10 m → 1.0; >10–30 m → 1.2; >30 m → 1.5.
- Base ventilation flow: in rooms without mechanical ventilation, the air flow used is the larger of the infiltration flow and the base ventilation flow (3.14), with the loss calculated against outdoor temperature. This replaces EN 12831's 0.5 /h hygiene minimum with the Swedish 0.35 l/s per m² floor area.
Air density, heat capacity, default ach by age, surface resistances: from EN 12831 / EN ISO 6946, not invented.

### 5.2 Unheated rooms
- Temperature is solved, not input: the U×A-weighted average of the surrounding temperatures, with the room's own infiltration and ventilation counted as a path to outdoor air.
- Several connected unheated rooms (a stairwell over ten floors, joined by fake floors) form a small linear system, one equation per unheated room, solved once. No iteration.
- Order: solve unheated temperatures first, then compute heated rooms.
- Unheated rooms have no demand; they are not included in totals.

### 5.3 Ground
- Walls below grade: to soil temperature (configuration).
- Slab: two-zone model (3.5), verified against an EN ISO 13370 building-level total.

### 5.4 Output
- Watts at design conditions per room, per floor, and for the building. Totals are sums over heated rooms only. No W/K output.

---

## 6. Model usage summary
- Opus: per-sheet reads, the combined pass, and any full-floor re-read.
- Haiku: regional re-reads driven by user comments, batched per floor.
- Command window (4.11): model choice open (9.4).

---

## 7. What the app must always show
- For every inferred value (scale, wall type grouping, opening height, room type, underground percentage, gap classification): the source and the reasoning, visible on inspection.
- For scale: which method produced it and what the reference line is assumed to measure.
- For every U-value: the full chain down to materials (3.8).
- For every AI-driven change (regional re-read, command window): the list of objects touched.

---

## 8. Out of scope for v1 (decided)
- IFC export (a real IFC export is a v2 nice-to-have).
- Vector line extraction from PDFs.
- Per-wall or corner-adjusted infiltration.
- Per-junction thermal bridges.
- Room area sanity checks after scaling (dropped; scale is already cross-checked and odd rooms are visible in 2D).
- Manual geometry tools beyond delete.
- Sensitivity analysis (section 10).
- Any feature not listed in this document.

---

## 9. Open questions (raise before building the affected part)
9.1 Snap tolerance: default 100 mm, VERY MUCH OPEN until real read output has been seen.
9.2 Sliver threshold for floor/ceiling overlap pieces (3.4): value not set.
9.3 Rendering resolution for pages sent to the API, and tiling of large pages into overlapping crops: open until real drawings have been tried.
9.4 Command window (4.11): which model, and the exact ask-back protocol.
9.5 Slab zone temperatures: starting values 5 °C / 12 °C are the user's guesses, to be tuned against the ISO 13370 total.
9.6 Infiltration: n50 starting values (3.14) to be verified against EN 12831:2003 Table D.5 and SBN 1980 section 33:3. Also verify the e and ε table values (5.1) against the standard.

---

## 10. Noted for later (not v1)
- Sensitivity analysis: flag which rooms' heat loss is most affected by uncertain U-value guesses, so site investigation can be prioritised; combined with the room-type confidence flag (low confidence + high sensitivity = go look). Not available in MagiCAD Room today. The per-element audit view is designed to support this.
- Real IFC export.
