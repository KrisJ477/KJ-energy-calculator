# Project preparation: the drawing conversation and the project brief

Every existing building has its own drawing history. The app cannot work out on
its own which drawings describe the building as it is today, which are noise, and
what is missing. So each project starts **before the app is opened**, in a
separate conversation with Claude about the drawings. The result is a short
**project brief**. The user pastes it into the setup wizard (SPEC §4.1), and it
goes into the prompt of every AI read.

This document describes what that conversation must settle and what the brief
contains. It is based on test reads of two real projects (see "What we learned"
below).

---

## 1. What the conversation must settle

Work through these in order. Every point ends up in the brief, either as a
decision or as an open question.

1. **Inventory.** List every file: name, date, format (CAD PDF, scanned PDF,
   TIFF, …), discipline (architectural, structural, ventilation, plumbing,
   electrical, other) and type (plan, section, elevation, detail, schedule).
   Look out for:
   - duplicates (the same drawing as both TIFF and PDF, or in two folders);
   - files that belong to **another property** (it happens: archive folders
     are organised by block, not by building);
   - paperwork with no drawing in it (permits, descriptions, forms).
2. **Current state.** Which drawing set shows the building as it is today? List
   later changes that alter the layout (renovations, conversions, a shop turned
   into a flat). Older drawings are valid for the shell only, never for interior
   walls that a later renovation moved.
3. **Drawings per floor and their roles** (SPEC §3.13). For each floor:
   - **base**: layout and room names;
   - **scale reference**: a drawing of the same floor with written dimensions;
   - **change patch**: a later drawing that replaces part of the base;
   - **cross-check**: used only to verify (e.g. room names on a ventilation plan);
   - **ignore**.
   Note parts of a floor that no drawing covers.
4. **Floor names.** Map every naming scheme to one level list (e.g. "första
   våningen" = "Plan 1 vån" = "BV"). Note the level numbers the app should use
   (SPEC §3.2).
5. **Scale.** For each drawing: which known measurement sets the scale (written
   dimensions first, then a scale bar), and which walls are good reference walls
   (long, straight, on every drawing, ideally dimensioned).
6. **Heights.** Which section or elevation gives floor-to-floor height, window
   heights, sills and levels. What applies where it is not drawn.
7. **Boundaries.** Which walls are exterior, which are party walls to a
   neighbour, and which surfaces border a **space outside the project**
   (neighbouring building, garage, shop), with a temperature for each.
8. **Heated or not.** Attic, basement, stairwells, loggias, garages, partly
   heated areas. When in doubt the app assumes heated (SPEC §3.2), so the brief
   only needs to name what is unheated or uncertain.
9. **Constructions.** Any wall, roof or floor build-ups shown on the drawings
   (sections, details, structural drawings), and what has to be assumed.
10. **Drawing conventions and noise.** How rooms are labelled (printed room
    names vs. fixture codes vs. apartment labels only), and what is **not a
    wall** on these particular drawings: fire compartment lines, revision
    clouds, ducts, stamps, film frames, handwriting and so on.
11. **Wizard values.** Age category and ventilation system.
12. **Open questions and site checks.** Everything that cannot be settled from
    the drawings.

## 2. How to run the conversation

1. Give Claude access to the project folder (e.g. Google Drive).
2. Let Claude make the inventory (point 1). For large archives, use a
   background agent that opens every drawing type and reports back.
3. Review low-resolution overviews of the key drawings together.
4. **Test-read one small area** of the proposed base drawing: rooms, walls and
   windows, drawn as an **overlay** on the drawing so errors are visible at a
   glance.
5. **Check the scale:** measure a few long distances on the base drawing and
   compare them with written dimensions (on the same drawing or a scale
   reference). Differences of 1–2 % are normal for scans; more than that needs
   an explanation.
6. Settle points 2–12 with the user, then write the brief.
7. The user reviews the brief before pasting it into the wizard. It can be
   edited in the app at any time.

## 3. What the brief contains

Keep it concise: it is prompt context for every read, not a report. It may be
written in Swedish or English. Recommended headings:

- **Building**: type, age, wings, storeys, main construction.
- **Floor names**: the alias table.
- **Drawings to use**: per floor, with role (base / scale reference / change
  patch / cross-check), plus sources for heights and constructions.
- **Do not use**: drawings to ignore, including duplicates and files for other
  properties.
- **Format and scale**: file types, resolution, scale sources.
- **Room labels**: how rooms are named on these drawings.
- **Not walls**: project-specific noise.
- **Boundaries and heating**: exterior vs party walls, spaces outside the
  project with temperatures, unheated spaces.
- **Known gaps and open questions.**

The brief must say what has **not** been checked, so nobody later mistakes a
guess for a fact.

## 4. What we learned from the test projects

Two projects were used for test reads (drafts of their briefs were produced
with the user and are kept outside this repository):

- **Forsåker Kv 39**: a new-build CAD project (ArchiCAD PDFs, 1:50, very large
  sheets, text layer and named layers).
- **Brf Blodnävan**: a 1924 landshövdingehus with archive scans (1-bit TIFF/PDF,
  200 dpi, 1:100/1:50) from 1924, 1986–88 and later alterations up to 2018.

Findings:

- **Every project is different.** Kv 39 needed "use KFU versions over FFU" and
  "the garage is not part of the project". Blodnävan needed three drawing sets
  from different decades, one for layout, one for dimensions and several patches.
  No fixed rule covers this; the brief does.
- **The right base drawing is often not the obvious one.** Blodnävan's first
  folder held ventilation drawings; the best architectural plans (1988) were
  found only after going through ~25 archive folders. One folder belonged to a
  different property.
- **Scale must come from a measurement.** Scan metadata implied half the true
  resolution on Blodnävan. The scale bar gave the right value, confirmed against
  1924 written dimensions to within 0.5–1.5 %.
- **Scans are slightly anisotropic.** Length and depth differed by 1 % on
  Blodnävan, which the two-reference-wall check (SPEC §4.4) handles.
- **Old dimensions are valid for the shell only.** Interior partitions had moved
  by decimetres in the 1988 renovation.
- **A first read gets structure and labels right and details wrong.** On a
  1988 scan: all room names and main walls correct; missed a projecting stair
  tower, simplified an L-shaped kitchen, ignored a chimney block, was unsure of
  doors (no swing arcs on 1-bit scans), and used window recess width instead of
  window width. These are exactly what the 2D correction step is for.
- **Room labelling differs.** Old drawings print room types (KÖK, RUM, WC);
  modern CAD drawings may label only the apartment and leave room types to
  fixture codes.
- **CAD PDFs contain far more than pixels.** Kv 39 had a text layer and 24 named
  layers; exterior walls, windows and doors could be extracted exactly. This is
  planned for v2 (SPEC §10).
- **Resolution:** see SPEC §4.2 for the tile sizes that worked.
