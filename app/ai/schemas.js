// Fixed JSON output schemas for every AI job (SPEC 4.2: the model never returns prose).
// Schemas follow the structured-output subset: object/array/string/number/integer/boolean/null, enum, anyOf,
// required, additionalProperties: false. Coordinates are pixels of the image the model was given.

const str = { type: 'string' };
const num = { type: 'number' };
const int = { type: 'integer' };
const bool = { type: 'boolean' };
const nullable = (s) => ({ anyOf: [s, { type: 'null' }] });
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items) => ({ type: 'array', items });
const point = obj({ x: num, y: num });
const rect = obj({ x: num, y: num, w: num, h: num });

export const ROOM_TYPE_ENUM = ['living', 'bedroom', 'kitchen', 'bathroom', 'wc', 'hall', 'storage', 'stairwell', 'laundry', 'office', 'shop', 'garage', 'loggia', 'corridor', 'technical', 'other', 'unknown'];
const roomType = { type: 'string', enum: ROOM_TYPE_ENUM };
const discipline = { type: 'string', enum: ['architectural', 'structural', 'ventilation', 'plumbing', 'electrical', 'other'] };

const classification = obj({
  type: { type: 'string', enum: ['plan', 'vertical', 'other'] },
  vertical_subtype: nullable({ type: 'string', enum: ['section', 'elevation'] }),
  discipline,
  floors: arr(obj({ name: str, level_number: nullable(int), reasoning: str })),
  part_of_floor: str,
  scale_stamp: nullable(str),
  has_scale_bar: bool,
  has_written_dimensions: bool,
  clarity: num,
  completeness: num,
  reasoning: str,
});

const referenceMeasurement = obj({ kind: { type: 'string', enum: ['dimension', 'scale_bar', 'level_difference'] }, a: point, b: point, value_text: str, value_mm: nullable(num), reasoning: str });

export const OVERVIEW_SCHEMA = obj({
  classification,
  drawing_region: rect,
  building_outline: arr(point),
  rough_rooms: arr(obj({ label: str, center: point })),
  reference_measurements: arr(referenceMeasurement),
  title_text: arr(str),
  notes: arr(str),
});

const wall = obj({ id: str, a: point, b: point, thickness_px: num, confidence: num, reasoning: str });
const room = obj({ id: str, label_text: str, room_type: roomType, room_type_confidence: num, reasoning: str, center: point, apartment: str, printed_area_m2: nullable(num), heated_guess: bool });
const opening = obj({ id: str, kind: { type: 'string', enum: ['window', 'door'] }, wall_ref: str, a: point, b: point, width_px: num, recess_width_px: nullable(num), has_swing_arc: bool, confidence: num, reasoning: str });
const gap = obj({ id: str, wall_ref: str, a: point, b: point, classification: { type: 'string', enum: ['opening', 'artifact', 'uncertain'] }, reasoning: str });
const textLabel = obj({ text: str, at: point, kind: { type: 'string', enum: ['room_name', 'apartment', 'dimension', 'level', 'fixture', 'other'] } });

export const TILE_SCHEMA = obj({ walls: arr(wall), rooms: arr(room), openings: arr(opening), gaps: arr(gap), text_labels: arr(textLabel), notes: arr(str) });

export const VERTICAL_SCHEMA = obj({
  classification,
  drawing_region: rect,
  levels: arr(obj({ name: str, level_number: nullable(int), floor_line_y: num, level_text: nullable(str), reasoning: str })),
  floor_to_floor: arr(obj({ lower: str, upper: str, height_px: num, height_text: nullable(str), reasoning: str })),
  openings: arr(obj({ id: str, kind: { type: 'string', enum: ['window', 'door'] }, x: num, y: num, w_px: num, h_px: num, sill_px: nullable(num), floor_name: str, label: str, confidence: num, reasoning: str })),
  ground_line: obj({ y: nullable(num), reasoning: str }),
  roof: obj({ cold_attic: nullable(bool), reasoning: str }),
  reference_measurements: arr(referenceMeasurement),
  notes: arr(str),
});

const floorWall = obj({ id: str, sheet_id: str, a: point, b: point, thickness_px: num, exterior_guess: nullable(bool), confidence: num, reasoning: str, source_ids: arr(str) });
const floorRoom = obj({ id: str, name: str, room_type: roomType, room_type_confidence: num, reasoning: str, anchor: point, apartment: str, printed_area_m2: nullable(num), heated_guess: bool });
const floorOpening = obj({
  id: str,
  kind: { type: 'string', enum: ['window', 'door'] },
  wall_ref: str,
  a: point,
  b: point,
  width_px: num,
  recess_width_px: nullable(num),
  height_estimate_mm: nullable(num),
  height_confidence: nullable({ type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] }),
  height_source: str,
  vertical_link: nullable(obj({ sheet_id: str, x: num, y: num, w: num, h: num })),
  sill_mm: nullable(num),
  confidence: num,
  reasoning: str,
});

export const FLOOR_SCHEMA = obj({
  walls: arr(floorWall),
  rooms: arr(floorRoom),
  openings: arr(floorOpening),
  gaps: arr(gap),
  sheet_offsets: arr(obj({ sheet_id: str, dx: num, dy: num, reasoning: str })),
  underground_guess: obj({ percent: nullable(num), reasoning: str }),
  floor_height_mm: nullable(num),
  notes: arr(str),
});

export const REGIONAL_SCHEMA = obj({
  walls_upsert: arr(floorWall),
  walls_delete: arr(str),
  rooms_upsert: arr(floorRoom),
  rooms_delete: arr(str),
  openings_upsert: arr(floorOpening),
  openings_delete: arr(str),
  gaps_upsert: arr(gap),
  gaps_delete: arr(str),
  explanation: str,
});

export const COMMAND_SCHEMA = obj({
  kind: { type: 'string', enum: ['question', 'proposal'] },
  question: nullable(obj({ text: str, options: arr(str) })),
  changes: arr(obj({ object_type: str, object_id: str, field: str, old_value: str, new_value: str, reasoning: str })),
  summary: str,
});

export const SCHEMAS = { overview: OVERVIEW_SCHEMA, tile: TILE_SCHEMA, vertical: VERTICAL_SCHEMA, floor: FLOOR_SCHEMA, regional: REGIONAL_SCHEMA, command: COMMAND_SCHEMA };
