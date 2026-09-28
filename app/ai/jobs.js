// Read orchestration (SPEC 4.2, 4.3, 4.5, 4.11): builds jobs, sends them through the provider and applies
// the structured results to the project. Coordinates stay in sheet pixels; scaling is the app's job.
import { SCHEMAS } from './schemas.js';
import { PROMPT_VERSION, systemPrompt, JOB_PROMPTS } from './prompts.js';
import { uid, newWall, newOpening, newRoom, ORIGIN, nextRoomIndex, roomIdFor } from '../state/model.js';
import { getBlob, loadBitmap, openPdf, renderPdfRegion, canvasToBlob, downscale, inkFraction } from '../drawings/loader.js';
import { tileSizePx, tileGrid, rectIntersectsPolygon, overviewScale } from '../drawings/tiling.js';
import { loadBilevel } from '../drawings/bilevel.js';
import { getLanguage } from '../i18n/strings.js';

export class ReadRunner {
  constructor(store, providerFactory) {
    this.store = store;
    this.providerFactory = providerFactory; // () → provider (api or manual)
    this.concurrency = 4;
    this.progress = { jobs: {} }; // id → { type, status, sheetId, level, error }
    this.listeners = new Set();
  }
  onProgress(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  setStatus(id, patch) {
    this.progress.jobs[id] = { ...(this.progress.jobs[id] || {}), ...patch };
    for (const fn of this.listeners) fn(this.progress);
  }
  get project() {
    return this.store.project;
  }
  wizard() {
    const c = this.project.config;
    return { ageCategory: c.ageCategory, outdoorTemp: c.outdoorTemp, indoorSetpoint: c.indoorSetpoint, ventilationSystem: c.ventilationSystem, supplyAirTemp: c.supplyAirTemp };
  }
  system() {
    return systemPrompt({ lang: getLanguage(), brief: this.project.brief, wizard: this.wizard(), floorList: this.project.levels });
  }
  modelFor(jobKey) {
    return this.project.config.ai.models[jobKey] || 'claude-opus-5';
  }

  // Run one job through the provider and record it in project.reads.
  async runJob(job) {
    const provider = this.providerFactory();
    this.setStatus(job.id, { type: job.type, status: 'running', sheetId: job.meta && job.meta.sheetId, level: job.meta && job.meta.level });
    this.store.update(
      (p) => {
        p.reads.push({ id: job.id, jobType: job.type, model: job.model, promptVersion: job.promptVersion, mode: provider.mode, createdAt: new Date().toISOString(), status: 'pending', sheetId: job.meta && job.meta.sheetId, level: job.meta && job.meta.level });
      },
      { undoable: false }
    );
    try {
      const res = await provider.run(job);
      this.store.update(
        (p) => {
          const r = p.reads.find((x) => x.id === job.id);
          if (r) {
            r.status = 'done';
            r.model = res.model;
            r.mode = res.mode;
            r.usage = res.usage;
            r.finishedAt = new Date().toISOString();
          }
        },
        { undoable: false }
      );
      this.setStatus(job.id, { status: 'done' });
      return res;
    } catch (e) {
      this.store.update(
        (p) => {
          const r = p.reads.find((x) => x.id === job.id);
          if (r) {
            r.status = 'failed';
            r.error = String(e.message || e);
          }
        },
        { undoable: false }
      );
      this.setStatus(job.id, { status: 'failed', error: String(e.message || e) });
      throw e;
    }
  }

  makeJob(type, { model, user, images, schema, meta }) {
    return { id: uid('req'), type, model, system: this.system(), user, images, schema, promptVersion: PROMPT_VERSION, brief: this.project.brief, meta };
  }

  // ---------- image access ----------
  // Render a region of a sheet (sheet px) at scale factor f (≤1) into a canvas.
  async renderSheetRegion(sheet, region, factor = 1) {
    if (sheet.raster === 'bilevel') {
      const bl = await loadBilevel(sheet, getBlob);
      if (!bl) throw new Error('scan bits missing from browser storage');
      return bl.toCanvas(region, factor);
    }
    if (sheet.raster === 'pdf-on-demand') {
      const doc = await openPdf(sheet.drawingId);
      const page = await doc.getPage(sheet.page + 1);
      const dpi = sheet.renderDpi * factor;
      const r = { x: region.x * factor, y: region.y * factor, w: region.w * factor, h: region.h * factor };
      return renderPdfRegion(page, dpi, r);
    }
    const bmp = await loadBitmap(sheet.imageKey);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(region.w * factor));
    canvas.height = Math.max(1, Math.round(region.h * factor));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, region.x, region.y, region.w, region.h, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  // ---------- full read ----------
  async fullRead(sheetIds = null, { onlyLevels = null, onlyUnread = false } = {}) {
    const sheets = this.project.sheets.filter((s) => (!sheetIds || sheetIds.includes(s.id)) && s.role !== 'ignore' && (!onlyUnread || !s.readStatus || s.readStatus === 'unread' || s.readStatus === 'overview'));
    // 1. per sheet: overview then tiles (all sheets in parallel, tiles with limited concurrency)
    await runLimited(sheets, this.concurrency, (sheet) => this.readSheet(sheet));
    // 2. combined pass per floor
    const levels = new Set();
    for (const s of this.project.sheets) if (s.type === 'plan' && s.level != null && s.role !== 'ignore' && s.role !== 'cross-check') levels.add(s.level);
    for (const level of [...levels].sort((a, b) => a - b)) {
      if (onlyLevels && !onlyLevels.includes(level)) continue;
      await this.combinedPass(level);
    }
    this.store.update((p) => {
      p.ui.readDone = true;
    }, { undoable: false });
  }

  async readSheet(sheetIn) {
    const sheet = this.project.sheets.find((s) => s.id === sheetIn.id);
    const cfg = this.project.config.ai;
    const full = { x: 0, y: 0, w: sheet.widthPx, h: sheet.heightPx };
    if (sheet.classification && sheet.overviewReadId && sheet.readStatus === 'overview') {
      // resume: the overview was already read, continue with the detail reads
      return this.afterOverview(sheet.id);
    }
    // overview: whole sheet at the model limit
    const f = overviewScale(full, cfg);
    const ovCanvas = await this.renderSheetRegion(sheet, full, f);
    const ovBlob = await canvasToBlob(ovCanvas);
    const ovJob = this.makeJob('overview', { model: this.modelFor('read'), user: JOB_PROMPTS.overview({ sheetName: sheetLabel(this.project, sheet), page: sheet.page + 1 }) + `\nThe image is the whole sheet scaled by ${f.toFixed(4)} (image px × ${(1 / f).toFixed(3)} = sheet px).`, images: [{ name: 'overview.png', blob: ovBlob }], schema: SCHEMAS.overview, meta: { sheetId: sheet.id, scale: f } });
    const ov = await this.runJob(ovJob);
    const inv = 1 / f;
    const scaleRect = (r) => ({ x: r.x * inv, y: r.y * inv, w: r.w * inv, h: r.h * inv });
    const scalePt = (p) => ({ x: p.x * inv, y: p.y * inv });
    const data = ov.data;
    this.store.update((p) => {
      const s = p.sheets.find((x) => x.id === sheet.id);
      s.classification = data.classification;
      s.classification.reasoning = data.classification.reasoning;
      s.overviewReadId = ovJob.id;
      s.type = data.classification.type === 'vertical' ? 'vertical' : data.classification.type === 'plan' ? 'plan' : s.type;
      s.discipline = data.classification.discipline;
      if (!s.crop && data.drawing_region && data.drawing_region.w > 0) s.crop = clampRect(scaleRect(data.drawing_region), full);
      s.buildingOutline = (data.building_outline || []).map(scalePt);
      s.roughRooms = (data.rough_rooms || []).map((r) => ({ label: r.label, center: scalePt(r.center) }));
      s.referenceMeasurements = (data.reference_measurements || []).map((m) => ({ ...m, a: scalePt(m.a), b: scalePt(m.b) }));
      s.titleText = data.title_text || [];
      s.notes = data.notes || [];
      if (s.level == null) s.level = proposeLevel(p, data.classification.floors);
      s.partOfFloor = data.classification.part_of_floor || '';
      s.readStatus = 'overview';
      if (data.classification.floors) s.proposedFloors = data.classification.floors;
      if (data.classification.scale_stamp && !s.scaleStamp) s.scaleStamp = parseStamp(data.classification.scale_stamp);
      // SPEC 3.13: the reader proposes the role, the user confirms (a role set by hand is kept)
      if (data.classification.proposed_role && s.roleOrigin !== 'user') {
        s.role = data.classification.proposed_role;
        s.roleOrigin = 'ai';
        s.roleReasoning = data.classification.role_reasoning || '';
      }
    }, { undoable: false });
    return this.afterOverview(sheet.id);
  }

  async afterOverview(sheetId) {
    const sheet = { id: sheetId };
    const updated = this.project.sheets.find((x) => x.id === sheet.id);
    if (updated.role === 'ignore') {
      this.store.update((p) => {
        const s = p.sheets.find((x) => x.id === sheet.id);
        s.readStatus = 'ignored';
      }, { undoable: false });
      return;
    }
    if (updated.type !== 'plan' && updated.type !== 'vertical') {
      this.store.update((p) => {
        const s = p.sheets.find((x) => x.id === sheet.id);
        s.readStatus = 'unusable';
      }, { undoable: false });
      return;
    }
    if (updated.role === 'scale-reference' || updated.role === 'cross-check') {
      // no detail tiles: only the overview's reference measurements are used (SPEC 3.13, 4.4); alignment is manual
      this.store.update((p) => {
        const s = p.sheets.find((x) => x.id === sheet.id);
        s.readStatus = 'overview-only';
        s.tiles = [];
        s.tileReads = [];
      }, { undoable: false });
      return;
    }
    if (updated.type === 'vertical') {
      await this.readVertical(updated);
      return;
    }
    await this.readTiles(updated);
  }

  async readTiles(sheet) {
    const cfg = this.project.config.ai;
    const crop = sheet.crop || { x: 0, y: 0, w: sheet.widthPx, h: sheet.heightPx };
    const tilePx = tileSizePx(cfg);
    const mmPerPx = sheet.nominalMmPerPx || null;
    const overlapPx = mmPerPx ? Math.round((cfg.tileOverlapM * 1000) / mmPerPx) : Math.round(tilePx * 0.13);
    const grid = tileGrid(crop, tilePx, overlapPx);
    const outline = sheet.buildingOutline && sheet.buildingOutline.length >= 3 ? sheet.buildingOutline : null;
    const tiles = [];
    for (const t of grid) {
      if (outline && !rectIntersectsPolygon(t, outline)) continue;
      tiles.push(t);
    }
    this.store.update((p) => {
      const s = p.sheets.find((x) => x.id === sheet.id);
      s.tiles = tiles.map((t, i) => ({ ...t, index: i, status: 'pending' }));
      s.tileReads = [];
    }, { undoable: false });
    const results = [];
    await runLimited(tiles, this.concurrency, async (t, i) => {
      const canvas = await this.renderSheetRegion(sheet, t, 1);
      const ink = inkFraction(canvas);
      if (ink < 0.002) {
        this.store.update((p) => {
          const s = p.sheets.find((x) => x.id === sheet.id);
          s.tiles[i].status = 'skipped-empty';
        }, { undoable: false });
        return;
      }
      const blob = await canvasToBlob(canvas);
      const job = this.makeJob('tile', { model: this.modelFor('read'), user: JOB_PROMPTS.tile({ sheetName: sheetLabel(this.project, sheet), tile: t, mmPerPxHint: mmPerPx }), images: [{ name: `tile_${t.col}_${t.row}.png`, blob }], schema: SCHEMAS.tile, meta: { sheetId: sheet.id, tile: t, level: sheet.level } });
      const res = await this.runJob(job);
      const shifted = shiftTile(res.data, t);
      results[i] = { tile: t, readId: job.id, data: shifted };
      this.store.update((p) => {
        const s = p.sheets.find((x) => x.id === sheet.id);
        s.tiles[i].status = 'done';
        s.tiles[i].readId = job.id;
        s.tileReads = s.tileReads || [];
        s.tileReads.push({ tile: t, readId: job.id, data: shifted });
      }, { undoable: false });
    });
    this.store.update((p) => {
      const s = p.sheets.find((x) => x.id === sheet.id);
      s.readStatus = 'tiles';
    }, { undoable: false });
    return results;
  }

  async readVertical(sheet) {
    const cfg = this.project.config.ai;
    const crop = sheet.crop || { x: 0, y: 0, w: sheet.widthPx, h: sheet.heightPx };
    // vertical drawings: tile like plans but with fewer, larger context; here one pass per tile row across the crop
    const tilePx = tileSizePx(cfg);
    const mmPerPx = sheet.nominalMmPerPx || null;
    const overlapPx = mmPerPx ? Math.round((cfg.tileOverlapM * 1000) / mmPerPx) : Math.round(tilePx * 0.13);
    const grid = tileGrid(crop, tilePx, overlapPx);
    const reads = [];
    await runLimited(grid, this.concurrency, async (t, i) => {
      const canvas = await this.renderSheetRegion(sheet, t, 1);
      if (inkFraction(canvas) < 0.002) return;
      const blob = await canvasToBlob(canvas);
      const job = this.makeJob('vertical', { model: this.modelFor('read'), user: JOB_PROMPTS.vertical({ sheetName: sheetLabel(this.project, sheet), page: sheet.page + 1 }) + `\nThis image is the tile at sheet pixels x ${t.x}–${t.x + t.w}, y ${t.y}–${t.y + t.h}; add the offset when you think in sheet coordinates (return tile-relative pixels).`, images: [{ name: `vertical_${t.col}_${t.row}.png`, blob }], schema: SCHEMAS.vertical, meta: { sheetId: sheet.id, tile: t } });
      const res = await this.runJob(job);
      reads[i] = { tile: t, readId: job.id, data: shiftVertical(res.data, t) };
    });
    this.store.update((p) => {
      const s = p.sheets.find((x) => x.id === sheet.id);
      s.verticalReads = reads.filter(Boolean);
      s.readStatus = 'done';
      // merge levels/heights/openings from all tiles
      const levels = [];
      const ftf = [];
      const openings = [];
      let ground = null;
      let coldAttic = null;
      for (const r of s.verticalReads) {
        for (const l of r.data.levels) if (!levels.some((x) => x.name === l.name && Math.abs(x.floor_line_y - l.floor_line_y) < 5)) levels.push(l);
        ftf.push(...r.data.floor_to_floor);
        openings.push(...r.data.openings);
        if (r.data.ground_line && r.data.ground_line.y != null) ground = r.data.ground_line;
        if (r.data.roof && r.data.roof.cold_attic != null) coldAttic = r.data.roof.cold_attic;
      }
      s.verticalLevels = levels;
      s.floorToFloor = ftf;
      s.verticalOpenings = openings;
      s.groundLine = ground;
      s.coldAttic = coldAttic;
      s.referenceMeasurements = [...(s.referenceMeasurements || []), ...s.verticalReads.flatMap((r) => r.data.reference_measurements)];
    }, { undoable: false });
  }

  // Combined pass per floor over the extracted data of all its tiles/sheets plus vertical drawings.
  async combinedPass(level) {
    const p = this.project;
    const sheets = p.sheets.filter((s) => s.type === 'plan' && s.level === level && s.role !== 'ignore' && s.role !== 'cross-check');
    if (!sheets.length) return;
    const base = sheets.find((s) => s.role === 'base') || sheets[0];
    const verticals = p.sheets.filter((s) => s.type === 'vertical' && s.readStatus === 'done');
    const lvl = p.levels.find((l) => l.level === level);
    const input = {
      floor: { level, name: lvl ? lvl.name : String(level), aliases: lvl ? lvl.aliases : [] },
      sheets: sheets.map((s) => ({ sheet_id: s.id, role: s.role, part_of_floor: s.partOfFloor, width_px: s.widthPx, height_px: s.heightPx, is_base: s.id === base.id, tiles: (s.tileReads || []).map((r) => ({ tile: r.tile, ...r.data })) })),
      vertical_drawings: verticals.map((s) => ({ sheet_id: s.id, levels: s.verticalLevels, floor_to_floor: s.floorToFloor, openings: s.verticalOpenings, ground_line: s.groundLine, cold_attic: s.coldAttic })),
      other_floors: p.levels.filter((l) => l.level !== level).map((l) => ({ level: l.level, walls: p.walls.filter((w) => w.level === l.level && !w.deleted).slice(0, 400).map((w) => ({ id: w.id, a: w.aPx, b: w.bPx, thickness_px: w.thicknessPx })) })),
    };
    const user = JOB_PROMPTS.combined({ levelName: input.floor.name, sheetIds: sheets.map((s) => s.id), baseSheetId: base.id }) + `\n\nExtracted data (JSON):\n${JSON.stringify(input)}`;
    const job = this.makeJob('combined', { model: this.modelFor('combined'), user, images: [], schema: SCHEMAS.floor, meta: { level, sheetId: base.id } });
    const res = await this.runJob(job);
    this.applyFloorResult(level, base, res.data, job.id, { mode: 'replace' });
  }

  // Apply a floor read result (combined pass or full-floor re-read) to the project.
  applyFloorResult(level, baseSheet, data, readId, { mode = 'replace', keepEdits = false } = {}) {
    this.store.update(
      (p) => {
        const prevWalls = p.walls.filter((w) => w.level === level);
        const prevRooms = p.rooms.filter((r) => r.level === level);
        const prevOpenings = p.openings.filter((o) => prevWalls.some((w) => w.id === o.wallId));
        const prevGaps = p.gaps.filter((g) => g.level === level);
        if (mode === 'replace') {
          p.walls = p.walls.filter((w) => w.level !== level);
          p.rooms = p.rooms.filter((r) => r.level !== level);
          p.openings = p.openings.filter((o) => !prevWalls.some((w) => w.id === o.wallId));
          p.gaps = p.gaps.filter((g) => g.level !== level);
        }
        for (const so of data.sheet_offsets || []) {
          const s = p.sheets.find((x) => x.id === so.sheet_id);
          if (s && s.id !== baseSheet.id) s.proposedOffset = { dx: so.dx, dy: so.dy, reasoning: so.reasoning };
        }
        const wallIdMap = {};
        for (const w of data.walls) {
          const nw = newWall(baseSheet.id, level, w.a, w.b, null, { thicknessPx: w.thickness_px, confidence: w.confidence, reasoning: w.reasoning, exteriorGuess: w.exterior_guess, readId, sourceIds: w.source_ids });
          wallIdMap[w.id] = nw.id;
          p.walls.push(nw);
        }
        let idx = nextRoomIndex(p, level);
        for (const r of data.rooms) {
          const room = newRoom(level, idx++, { name: r.name, roomType: r.room_type === 'unknown' ? 'other' : r.room_type, roomTypeConfidence: r.room_type_confidence, reasoning: r.reasoning, anchorPx: r.anchor, sheetId: baseSheet.id, apartment: r.apartment, printedAreaM2: r.printed_area_m2, heated: r.heated_guess !== false, readId, aiId: r.id });
          p.rooms.push(room);
        }
        for (const o of data.openings) {
          const wallId = wallIdMap[o.wall_ref] || null;
          const op = newOpening(wallId, o.kind, { aPx: o.a, bPx: o.b, widthPx: o.width_px, recessWidthPx: o.recess_width_px, heightMm: o.height_estimate_mm, heightConfidence: o.height_confidence, source: o.height_source, verticalLink: o.vertical_link, sillMm: o.sill_mm, confidence: o.confidence, reasoning: o.reasoning, sheetId: baseSheet.id, level, readId });
          p.openings.push(op);
        }
        for (const g of data.gaps) {
          p.gaps.push({ id: uid('gap'), level, sheetId: baseSheet.id, wallId: wallIdMap[g.wall_ref] || null, aPx: g.a, bPx: g.b, classification: g.classification, reasoning: g.reasoning, resolved: g.classification !== 'uncertain', readId });
        }
        const lvl = p.levels.find((l) => l.level === level);
        if (lvl) {
          if (data.floor_height_mm && !lvl.heightMm) lvl.heightMm = data.floor_height_mm;
          lvl.undergroundGuess = data.underground_guess;
          // the machine guess is the default percent underground of the level's exterior walls until the user changes it (SPEC 4.7)
          const pct = data.underground_guess && data.underground_guess.percent;
          const lowest = Math.min(...p.levels.map((l) => l.level));
          if (pct > 0 && level === lowest && !lvl.undergroundAnswered) for (const w of p.walls) if (w.level === level && !w.deleted && w.exteriorGuess !== false && w.origin !== ORIGIN.user) w.percentUnderground = pct;
          lvl.lastReadId = readId;
          lvl.readNotes = data.notes;
        }
        if (keepEdits) restoreEdits(p, level, { prevWalls, prevRooms, prevOpenings, prevGaps });
      },
      { label: 'read', meta: { level } }
    );
  }

  // ---------- regional re-read on comments (SPEC 4.5) and annotations (3.9) ----------
  async regionalReread(level, regionPx, sheet, comments, currentObjects) {
    const canvas = await this.renderSheetRegion(sheet, regionPx, 1);
    const blob = await canvasToBlob(canvas);
    const rel = (pt) => ({ x: pt.x - regionPx.x, y: pt.y - regionPx.y });
    const objects = {
      walls: currentObjects.walls.map((w) => ({ id: w.id, a: rel(w.aPx), b: rel(w.bPx), thickness_px: w.thicknessPx })),
      rooms: currentObjects.rooms.map((r) => ({ id: r.id, name: r.name, room_type: r.roomType, anchor: r.anchorPx ? rel(r.anchorPx) : null })),
      openings: currentObjects.openings.map((o) => ({ id: o.id, kind: o.kind, wall_ref: o.wallId, a: o.aPx ? rel(o.aPx) : null, b: o.bPx ? rel(o.bPx) : null, width_px: o.widthPx })),
      gaps: currentObjects.gaps.map((g) => ({ id: g.id, a: rel(g.aPx), b: rel(g.bPx), classification: g.classification })),
      annotations: currentObjects.annotations || [],
    };
    const user = JOB_PROMPTS.regional({ levelName: String(level), region: regionPx, comments }) + `\n\nCurrent objects (region pixels):\n${JSON.stringify(objects)}`;
    const job = this.makeJob('regional', { model: this.modelFor('regional'), user, images: [{ name: 'region.png', blob }], schema: SCHEMAS.regional, meta: { level, sheetId: sheet.id, region: regionPx } });
    const res = await this.runJob(job);
    return { readId: job.id, data: res.data };
  }

  applyRegionalResult(level, sheet, regionPx, data, readId, origin = ORIGIN.regional) {
    const touched = [];
    const abs = (pt) => (pt ? { x: pt.x + regionPx.x, y: pt.y + regionPx.y } : null);
    this.store.update(
      (p) => {
        for (const id of data.walls_delete) {
          const w = p.walls.find((x) => x.id === id);
          if (w) {
            w.deleted = true;
            w.origin = origin;
            w.readId = readId;
            touched.push({ type: 'wall', id, change: 'deleted' });
          }
        }
        for (const w of data.walls_upsert) {
          const ex = p.walls.find((x) => x.id === w.id);
          if (ex) {
            Object.assign(ex, { aPx: abs(w.a), bPx: abs(w.b), thicknessPx: w.thickness_px, reasoning: w.reasoning, confidence: w.confidence, origin, readId, deleted: false });
            touched.push({ type: 'wall', id: w.id, change: 'updated' });
          } else {
            const nw = newWall(sheet.id, level, abs(w.a), abs(w.b), null, { thicknessPx: w.thickness_px, confidence: w.confidence, reasoning: w.reasoning, origin, readId, aiId: w.id });
            p.walls.push(nw);
            touched.push({ type: 'wall', id: nw.id, change: 'added' });
          }
        }
        for (const id of data.rooms_delete) {
          const i = p.rooms.findIndex((x) => x.id === id);
          if (i >= 0) {
            p.rooms.splice(i, 1);
            touched.push({ type: 'room', id, change: 'deleted' });
          }
        }
        let idx = nextRoomIndex(p, level);
        for (const r of data.rooms_upsert) {
          const ex = p.rooms.find((x) => x.id === r.id);
          if (ex) {
            Object.assign(ex, { name: r.name, roomType: r.room_type === 'unknown' ? ex.roomType : r.room_type, roomTypeConfidence: r.room_type_confidence, reasoning: r.reasoning, anchorPx: abs(r.anchor), origin, readId });
            touched.push({ type: 'room', id: r.id, change: 'updated' });
          } else {
            const room = newRoom(level, idx++, { name: r.name, roomType: r.room_type === 'unknown' ? 'other' : r.room_type, roomTypeConfidence: r.room_type_confidence, reasoning: r.reasoning, anchorPx: abs(r.anchor), sheetId: sheet.id, heated: r.heated_guess !== false, origin, readId });
            p.rooms.push(room);
            touched.push({ type: 'room', id: room.id, change: 'added' });
          }
        }
        for (const id of data.openings_delete) {
          const o = p.openings.find((x) => x.id === id);
          if (o) {
            o.deleted = true;
            o.origin = origin;
            touched.push({ type: 'opening', id, change: 'deleted' });
          }
        }
        for (const o of data.openings_upsert) {
          const ex = p.openings.find((x) => x.id === o.id);
          const wallId = p.walls.find((x) => x.id === o.wall_ref || x.aiId === o.wall_ref) ? (p.walls.find((x) => x.id === o.wall_ref) || p.walls.find((x) => x.aiId === o.wall_ref)).id : ex ? ex.wallId : null;
          const patch = { wallId, kind: o.kind, aPx: abs(o.a), bPx: abs(o.b), widthPx: o.width_px, recessWidthPx: o.recess_width_px, heightMm: o.height_estimate_mm ?? (ex ? ex.heightMm : null), heightConfidence: o.height_confidence ?? (ex ? ex.heightConfidence : null), reasoning: o.reasoning, confidence: o.confidence, origin, readId, deleted: false };
          if (ex) {
            Object.assign(ex, patch);
            touched.push({ type: 'opening', id: o.id, change: 'updated' });
          } else {
            const op = newOpening(wallId, o.kind, { ...patch, sheetId: sheet.id, level });
            p.openings.push(op);
            touched.push({ type: 'opening', id: op.id, change: 'added' });
          }
        }
        for (const id of data.gaps_delete) {
          const i = p.gaps.findIndex((x) => x.id === id);
          if (i >= 0) {
            p.gaps.splice(i, 1);
            touched.push({ type: 'gap', id, change: 'deleted' });
          }
        }
        for (const g of data.gaps_upsert) {
          const ex = p.gaps.find((x) => x.id === g.id);
          if (ex) Object.assign(ex, { aPx: abs(g.a), bPx: abs(g.b), classification: g.classification, reasoning: g.reasoning, resolved: g.classification !== 'uncertain', readId });
          else p.gaps.push({ id: uid('gap'), level, sheetId: sheet.id, aPx: abs(g.a), bPx: abs(g.b), classification: g.classification, reasoning: g.reasoning, resolved: g.classification !== 'uncertain', readId, origin });
          touched.push({ type: 'gap', id: g.id, change: ex ? 'updated' : 'added' });
        }
        const read = p.reads.find((r) => r.id === readId);
        if (read) {
          read.objectsTouched = touched;
          read.explanation = data.explanation;
        }
      },
      { label: 'regional re-read', meta: { level } }
    );
    return touched;
  }

  // ---------- full-floor re-read (SPEC 4.5 dialog) ----------
  async fullFloorReread(level, { keepEdits }) {
    const sheets = this.project.sheets.filter((s) => s.type === 'plan' && s.level === level && s.role !== 'ignore' && s.role !== 'cross-check');
    for (const s of sheets) await this.readTiles(s);
    const base = sheets.find((s) => s.role === 'base') || sheets[0];
    const p = this.project;
    const verticals = p.sheets.filter((s) => s.type === 'vertical' && s.readStatus === 'done');
    const lvl = p.levels.find((l) => l.level === level);
    const input = {
      floor: { level, name: lvl ? lvl.name : String(level) },
      sheets: sheets.map((s) => ({ sheet_id: s.id, role: s.role, is_base: s.id === base.id, tiles: (s.tileReads || []).map((r) => ({ tile: r.tile, ...r.data })) })),
      vertical_drawings: verticals.map((s) => ({ sheet_id: s.id, levels: s.verticalLevels, floor_to_floor: s.floorToFloor, openings: s.verticalOpenings })),
    };
    const job = this.makeJob('combined', { model: this.modelFor('fullFloorReread'), user: JOB_PROMPTS.combined({ levelName: input.floor.name, sheetIds: sheets.map((s) => s.id), baseSheetId: base.id }) + `\n\nExtracted data (JSON):\n${JSON.stringify(input)}`, images: [], schema: SCHEMAS.floor, meta: { level, sheetId: base.id } });
    const res = await this.runJob(job);
    this.applyFloorResult(level, base, res.data, job.id, { mode: 'replace', keepEdits });
  }

  // ---------- command window (SPEC 4.11) ----------
  async command(commandText, projectSummary) {
    const job = this.makeJob('command', { model: this.modelFor('command'), user: JOB_PROMPTS.command({ commandText, projectSummary: JSON.stringify(projectSummary) }), images: [], schema: SCHEMAS.command, meta: {} });
    const res = await this.runJob(job);
    return { readId: job.id, data: res.data };
  }
}

// Objects with a human or AI-corrected tag are restored over the new result (SPEC 4.5, "keep my edits").
function restoreEdits(p, level, prev) {
  const unmatched = [];
  const near = (a, b, tol) => a && b && Math.hypot(a.x - b.x, a.y - b.y) <= tol;
  for (const w of prev.prevWalls) {
    if (w.origin === ORIGIN.machine) continue;
    const m = p.walls.find((n) => n.level === level && ((near(n.aPx, w.aPx, 40) && near(n.bPx, w.bPx, 40)) || (near(n.aPx, w.bPx, 40) && near(n.bPx, w.aPx, 40))));
    if (m) Object.assign(m, { ...w, id: m.id, restored: true });
    else if (w.deleted) {
      const del = p.walls.find((n) => n.level === level && ((near(n.aPx, w.aPx, 80) && near(n.bPx, w.bPx, 80)) || (near(n.aPx, w.bPx, 80) && near(n.bPx, w.aPx, 80))));
      if (del) del.deleted = true;
      else unmatched.push({ type: 'wall', id: w.id });
    } else unmatched.push({ type: 'wall', id: w.id });
  }
  for (const r of prev.prevRooms) {
    if (r.origin === ORIGIN.machine && !r.userEdited) continue;
    const m = p.rooms.find((n) => n.level === level && near(n.anchorPx, r.anchorPx, 300));
    if (m) Object.assign(m, { ...r, id: m.id, index: m.index, restored: true });
    else unmatched.push({ type: 'room', id: r.id });
  }
  for (const o of prev.prevOpenings) {
    if (o.origin === ORIGIN.machine && !o.userEdited) continue;
    const m = p.openings.find((n) => n.level === level && near(n.aPx, o.aPx, 60));
    if (m) Object.assign(m, { ...o, id: m.id, wallId: m.wallId, restored: true });
    else unmatched.push({ type: 'opening', id: o.id });
  }
  const lvl = p.levels.find((l) => l.level === level);
  if (lvl) lvl.rereadUnmatched = unmatched;
}

function shiftTile(data, t) {
  const sh = (pt) => ({ x: pt.x + t.x, y: pt.y + t.y });
  return {
    walls: data.walls.map((w) => ({ ...w, a: sh(w.a), b: sh(w.b) })),
    rooms: data.rooms.map((r) => ({ ...r, center: sh(r.center) })),
    openings: data.openings.map((o) => ({ ...o, a: sh(o.a), b: sh(o.b) })),
    gaps: data.gaps.map((g) => ({ ...g, a: sh(g.a), b: sh(g.b) })),
    text_labels: data.text_labels.map((l) => ({ ...l, at: sh(l.at) })),
    notes: data.notes,
  };
}
function shiftVertical(data, t) {
  const sh = (pt) => ({ x: pt.x + t.x, y: pt.y + t.y });
  return {
    ...data,
    drawing_region: data.drawing_region ? { ...data.drawing_region, x: data.drawing_region.x + t.x, y: data.drawing_region.y + t.y } : null,
    levels: data.levels.map((l) => ({ ...l, floor_line_y: l.floor_line_y + t.y })),
    openings: data.openings.map((o) => ({ ...o, x: o.x + t.x, y: o.y + t.y, sill_px: o.sill_px != null ? o.sill_px + t.y : o.sill_px })),
    ground_line: data.ground_line && data.ground_line.y != null ? { ...data.ground_line, y: data.ground_line.y + t.y } : data.ground_line,
    reference_measurements: (data.reference_measurements || []).map((m) => ({ ...m, a: sh(m.a), b: sh(m.b) })),
  };
}
function clampRect(r, full) {
  const x = Math.max(full.x, Math.min(r.x, full.x + full.w - 1));
  const y = Math.max(full.y, Math.min(r.y, full.y + full.h - 1));
  return { x, y, w: Math.max(1, Math.min(r.w, full.x + full.w - x)), h: Math.max(1, Math.min(r.h, full.y + full.h - y)) };
}
function parseStamp(s) {
  const m = /1\s*:\s*(\d+)/.exec(s || '');
  return m ? parseInt(m[1], 10) : null;
}
export function sheetLabel(project, sheet) {
  const d = project.drawings.find((x) => x.id === sheet.drawingId);
  return `${d ? d.fileName : sheet.drawingId}${d && d.pages > 1 ? ` p${sheet.page + 1}` : ''}`;
}
// Map an AI floor name to a level through the alias table (SPEC 3.2).
export function proposeLevel(project, floors) {
  if (!floors || !floors.length) return null;
  for (const f of floors) {
    if (f.level_number != null) return f.level_number;
    const name = (f.name || '').trim().toLowerCase();
    for (const l of project.levels) {
      if ((l.name || '').toLowerCase() === name) return l.level;
      if ((l.aliases || []).some((a) => a.trim().toLowerCase() === name)) return l.level;
    }
  }
  return null;
}
async function runLimited(items, limit, fn) {
  const queue = items.map((it, i) => () => fn(it, i));
  const workers = [];
  let next = 0;
  const errors = [];
  for (let k = 0; k < Math.min(limit, queue.length); k++) {
    workers.push(
      (async () => {
        while (next < queue.length) {
          const i = next++;
          try {
            await queue[i]();
          } catch (e) {
            errors.push(e);
            console.error(e);
          }
        }
      })()
    );
  }
  await Promise.all(workers);
  if (errors.length) throw errors[0];
}
export { roomIdFor };
