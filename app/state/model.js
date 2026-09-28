// Project data model (SPEC 3). Plain JSON objects; factories and id helpers.
import { DEFAULT_CONFIG } from '../engine/constants.js';

export const ORIGIN = { machine: 'machine', regional: 'regional', command: 'command', user: 'user' };

let counter = 0;
export function uid(prefix = 'o') {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newProject(name = '') {
  return {
    schemaVersion: 1,
    meta: { name, createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString() },
    brief: '',
    config: structuredClone(DEFAULT_CONFIG),
    levels: [], // { level, name, aliases[], heightMm, transform, referenceFloor, scaleCorrection, approved, coldAttic }
    drawings: [], // uploaded files: { id, fileName, kind, pages }
    sheets: [], // { id, drawingId, page, imageKey, widthPx, heightPx, level, partOfFloor, role, type, discipline, crop, scale, placement, opacity, textItems, classification, readIds }
    walls: [],
    rooms: [],
    openings: [],
    separators: [],
    annotations: [],
    gaps: [],
    comments: [], // { id, level, targetId?, region?, text, sentInReadId? }
    outsideSpaces: {}, // surface ref → { temp }
    pieceOverrides: {}, // piece id → { floorTypeId?, outsideSpace?: { temp }, flaggedReview? }
    library: defaultLibrary(),
    reads: [], // { id, jobType, model, promptVersion, mode, createdAt, status, sheetId?, level?, objectsTouched? }
    commandLog: [],
    ui: { referenceFloorConfirmed: false, floorsConfirmed: false, gapsAnswered: {}, sheetAlignment: {} },
  };
}

export function defaultLibrary() {
  return {
    materialsExtra: [], // user-added materials (shared library additions are stored outside the project as well)
    constructions: [], // { id, name, layers: [{materialId, thicknessMm} | {resistance,label}], uValueDirect?, source? }
    wallTypes: [], // { id, name, constructionId }
    floorTypes: [], // { id, name, constructionId, kind: 'between'|'top-cold-attic' }
    roofTypes: [], // { id, name, constructionId }
    slabType: null, // { id, name, constructionId }
    openingTypes: [], // { id, name, kind: 'window'|'door', constructionId, defaultFor?: 'exterior-door'|'interior-door' }
  };
}

export function newLevel(level, name = '') {
  return { level, name: name || `Plan ${level}`, aliases: [], heightMm: null, transform: { s: 1, rot: 0, tx: 0, ty: 0 }, referenceFloor: false, scaleCorrection: null, approved: false, coldAttic: null, floorElevationMm: null, referenceWalls: null };
}

export function newSheet(drawingId, page, extra = {}) {
  return {
    id: uid('sh'),
    drawingId,
    page,
    imageKey: null,
    widthPx: 0,
    heightPx: 0,
    level: null,
    partOfFloor: '',
    role: 'base',
    type: 'plan',
    discipline: 'architectural',
    crop: null,
    scale: null, // { mmPerPx, method, label, pxA, pxB, realMm }
    placement: { rot: 0, tx: 0, ty: 0, sx: 1, sy: 1, method: null, pairs: null }, // px→level mm after scale
    opacity: { paper: 0.6, line: 1 },
    textItems: [],
    classification: null,
    readStatus: 'unread',
    verticalLevels: null, // for vertical drawings: [{ name, level, yPx }]
    groundLineYPx: null,
    ...extra,
  };
}

export function newWall(sheetId, level, aPx, bPx, thicknessMm, extra = {}) {
  return { id: uid('w'), sheetId, level, aPx, bPx, thicknessMm, thicknessPx: null, wallTypeId: null, percentUnderground: 0, origin: ORIGIN.machine, confidence: null, reasoning: '', deleted: false, ...extra };
}

export function newRoom(level, index, extra = {}) {
  return { id: `${level < 0 ? `(${level})` : level}-${index}`, level, index, name: '', roomType: 'other', roomTypeConfidence: null, reasoning: '', anchor: null, heated: true, setpoint: null, ventilationLs: null, supplyTempOverride: null, infiltrationAchOverride: null, comment: '', origin: ORIGIN.machine, flaggedReview: false, ...extra };
}

export function roomIdFor(level, index) {
  return `${level < 0 ? `(${level})` : level}-${index}`;
}

export function newOpening(wallId, kind, extra = {}) {
  return { id: uid('op'), wallId, kind, widthMm: null, widthIsRecess: false, heightMm: null, heightConfidence: null, sillMm: null, t: 0.5, source: '', reasoning: '', verticalLink: null, openingTypeId: null, origin: ORIGIN.machine, deleted: false, ...extra };
}

export function nextRoomIndex(project, level) {
  let max = 0;
  for (const r of project.rooms) if (r.level === level && r.index > max) max = r.index;
  return max + 1;
}

export function levelById(project, level) {
  return project.levels.find((l) => l.level === level);
}

export function sortedLevels(project) {
  return [...project.levels].sort((a, b) => a.level - b.level);
}
