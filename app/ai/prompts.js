// Versioned prompts (SPEC 4.2). The version is stored with every read so a later re-read can say which
// prompt produced the model. Prompts are in English; the model writes reasoning in the UI language.
export const PROMPT_VERSION = '1.0.0';

const NOT_WALLS =
  'These are NOT walls and must never be returned as walls: match lines, sheet frame edges, title block borders, ' +
  'revision clouds, fire compartment lines (e.g. red dash-dot EI60 boundaries), dimension and leader lines, ducts and pipes on HVAC ' +
  'drawings, archive film frames, rulers and frame numbers, stamps and handwritten notes, furniture, turning circles, hatching.';

const COMMON_RULES = (lang) =>
  `Rules:
- Return only the JSON object required by the schema. No prose outside it.
- Coordinates are pixels of the image you were given (x to the right, y downwards, origin top-left). Never convert to metres.
- Every item carries a confidence between 0 and 1 and a short reasoning written in ${lang === 'sv' ? 'Swedish' : 'English'}.
- Never invent geometry to close a room. Uncertain stays uncertain: report it as a gap with classification "uncertain".
- Every gap in a wall is a question, not a fact: classify each as "opening" (door/window with symbol, or context makes it certain), "artifact" (faded or broken line, closed in reality) or "uncertain". On 1-bit scans doors often have no swing arc, only a gap and a short diagonal line.
- Wall centerlines with measured thickness in pixels. A wall that runs along several rooms may be returned as one segment; the app splits it.
- ${NOT_WALLS}
- Not rooms: wardrobes and cupboards drawn as boxes inside rooms ("L.", "G."), chimney blocks and shafts (solid, excluded from room area). Projecting stair towers, bays and oriels are part of the envelope and must be read as such, not flattened into the facade line.
- Room type guesses come from printed room names (KÖK, RUM, WC, TAMB, SOV, BAD) or fixture codes (DM, K/F, KM, TM, G, ST). Glazed loggias are read as heated rooms; the user corrects later. When in doubt whether a space is heated, assume heated.
- On old scans a window is often drawn inside a wall recess wider than the window: report the recess width separately (recess_width_px) and the window width as the best visible estimate.`;

export function systemPrompt({ lang, brief, wizard, floorList }) {
  return `You are the drawing reader of a room-by-room heat loss calculation app for existing Swedish buildings (EN 12831 style).
You read architectural drawings (plans, sections, elevations) and return structured JSON only.

Project brief (written by the user, authoritative on which drawings to use and how):
${brief || '(no brief)'}

Wizard answers: age category ${wizard.ageCategory}; outdoor design temperature ${wizard.outdoorTemp} °C; default indoor setpoint ${wizard.indoorSetpoint} °C; ventilation system ${wizard.ventilationSystem}${wizard.ventilationSystem === 'ftx' ? ` with supply air ${wizard.supplyAirTemp} °C` : ''}.

Floor list so far: ${floorList && floorList.length ? floorList.map((l) => `${l.level}: ${l.name}${l.aliases && l.aliases.length ? ` (aliases: ${l.aliases.join(', ')})` : ''}`).join('; ') : '(none yet)'}

${COMMON_RULES(lang)}`;
}

export const JOB_PROMPTS = {
  overview: ({ sheetName, page }) =>
    `Overview pass for sheet "${sheetName}" (page ${page}). This is the whole sheet at low resolution.
Tasks: classify the drawing (plan or vertical; discipline; which floor(s) and which part of the floor it shows, mapping floor names through the brief's alias table where possible);
find the drawing region (the rectangle with the building, excluding title block, frame and legends);
give a rough building outline polygon and rough room label positions; list every candidate reference measurement for scale: written dimension chain values (a and b = the two ends of the dimension line, value_text as printed, value_mm converted) and scale bars (a = 0 end, b = the far end, value_mm = the bar's total length in mm of building);
note the scale stamp (e.g. "1:100") if printed, whether a scale bar and written dimensions exist, and rate clarity and completeness 0..1. Report drawings that are unusable as plans (foundation plans, forms without drawings) as type "other".`,
  tile: ({ sheetName, tile, mmPerPxHint }) =>
    `Detail tile of sheet "${sheetName}": columns ${tile.col}, row ${tile.row}, covering sheet pixels x ${tile.x}–${tile.x + tile.w}, y ${tile.y}–${tile.y + tile.h}. ${mmPerPxHint ? `Approximate resolution: ${mmPerPxHint.toFixed(1)} mm of building per pixel.` : 'Resolution unknown until the scale step.'}
Read everything in this tile: walls (centerlines and thickness in pixels), enclosed rooms with label text and room type, openings (windows and doors) with width in pixels along the wall, gaps in walls with classification, and every text label (room names, apartment labels like "2 RoK C1402 34,0 m²", dimension strings, level texts, fixture codes).
Walls cut by the tile edge are returned to the edge; the combined pass joins them. Use the same wall ids as wall_ref in openings and gaps.`,
  vertical: ({ sheetName, page }) =>
    `Vertical drawing (section or elevation) "${sheetName}" (page ${page}).
Read: the floor levels (name as printed, level number if the brief allows, y of the floor line, level text like "+26.35"), floor-to-floor heights in pixels between consecutive levels (with printed height text when present), every window and door with its pixel size and sill, the ground line, whether the roof space is a cold attic, and candidate reference measurements for scale (written heights or levels first, then a scale bar).`,
  combined: ({ levelName, sheetIds, baseSheetId }) =>
    `Combined pass for floor "${levelName}". Input: the extracted data of all detail tiles of its sheets (${sheetIds.join(', ')}; base sheet ${baseSheetId}), already converted to sheet pixel coordinates (tile offsets applied), plus the extracted data of the vertical drawings.
Tasks: merge tiles and sheet seams: join walls continuing across tile or sheet edges, remove duplicates in overlap strips by position, deduplicate labels; form the room list on the merged set (one room per enclosed space, anchor inside the room, name from the labels, room type with confidence); attach openings to walls; match openings to the vertical drawings (height_estimate_mm with confidence HIGH when found in a vertical drawing this opening maps to, MEDIUM when same room type and width as a known opening, LOW when only same width and look; vertical_link with the sheet and the framed rectangle when found); compare the same wall in neighbouring apartments and on other floors when data is given; classify remaining gaps.
Coordinates: pixel coordinates of the base sheet. For other sheets of the same floor give sheet_offsets (dx, dy to add to their pixel coordinates to land in the base sheet frame) and return their objects already in the base frame. Propose a floor height (mm) when the vertical drawings give one, and an underground percentage guess from the ground datum when found.`,
  regional: ({ levelName, region, comments }) =>
    `Regional re-read of floor "${levelName}", region sheet pixels x ${region.x}–${region.x + region.w}, y ${region.y}–${region.y + region.h} (the image is this region; its origin is the region's top-left, coordinates you return are relative to the region image).
The current objects in this region are given as JSON (ids, geometry in region pixels). The user's comments and annotations follow. Re-read ONLY this region and return upserts and deletions that implement the comments (e.g. "this is not a wall" → walls_delete; "these are two walls" → replace one wall by two). Keep ids of unchanged objects. Explain the changes in "explanation".
User comments:
${comments.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
  command: ({ commandText, projectSummary }) =>
    `Command window. The user asks for a project-wide change. You never change anything yourself: return either a question back (kind "question", with clickable options where possible) when anything is ambiguous, or a proposal (kind "proposal") listing every change object by object (object_type, object_id, field, old_value, new_value). Fields you may propose to change: config.* (project configuration values), room.setpoint, room.ventilationLs, room.supplyTempOverride, room.infiltrationAchOverride, room.heated, room.name, room.roomType, wall.percentUnderground, wall.wallTypeId, opening.openingTypeId, outsideSpace.temp. Values are given as strings.
Project summary (JSON):
${projectSummary}

User command: ${commandText}`,
};
