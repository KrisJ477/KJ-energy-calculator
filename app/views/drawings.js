// Upload and full read (SPEC 4.2), manual-mode exchange (SPEC 2), per-sheet classification and roles.
import { h, clear, section, button, table, select, toast, download, pickFiles, textInput, modal } from '../ui/dom.js';
import { t } from '../i18n/strings.js';
import { uid, newSheet } from '../state/model.js';
import { pdfjs, inspectPdfPage, renderPdfRegion, pdfTextItems, decodeImageFile, canvasToBlob, downscale, putBlob, MAX_STORED_RASTER_PX, MAX_DISPLAY_LONG_EDGE } from '../drawings/loader.js';
import { dpiForTarget } from '../drawings/tiling.js';
import { extractPdfImage, canDecodeBilevel, decodePdfImageToBilevel, tiffToBilevel } from '../drawings/bilevel.js';
import { sheetLabel } from '../ai/jobs.js';
import { ManualProvider } from '../ai/provider.js';

// Import files into the project: one sheet per page, rasters in IndexedDB.
export async function importFiles(ctx, files) {
  const { store } = ctx;
  for (const file of files) {
    const drawingId = uid('dr');
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) {
      await putBlob(`src:${drawingId}`, file);
      const lib = await pdfjs();
      const rawBytes = new Uint8Array(await file.arrayBuffer());
      const doc = await lib.getDocument({ data: rawBytes.slice() }).promise;
      store.update((p) => p.drawings.push({ id: drawingId, fileName: file.name, kind: 'pdf', pages: doc.numPages }), { undoable: false });
      for (let i = 0; i < doc.numPages; i++) {
        toast(`${file.name} ${i + 1}/${doc.numPages}`);
        const info = await inspectPdfPage(doc, i, rawBytes);
        const cfg = store.project.config.ai;
        const stamp = info.scaleStamp || 100;
        let renderDpi;
        let raster;
        let nominalMmPerPx = null;
        if (info.isScan) {
          renderDpi = info.nativeDpi; // scans are never enlarged beyond native resolution
          raster = 'stored';
          nominalMmPerPx = (25.4 / renderDpi) * stamp;
        } else {
          renderDpi = dpiForTarget(cfg.targetMmPerPx, stamp);
          nominalMmPerPx = cfg.targetMmPerPx;
          const px = (info.widthPt * renderDpi) / 72 * ((info.heightPt * renderDpi) / 72);
          raster = px > MAX_STORED_RASTER_PX ? 'pdf-on-demand' : 'stored';
        }
        const widthPx = Math.round((info.widthPt * renderDpi) / 72);
        const heightPx = Math.round((info.heightPt * renderDpi) / 72);
        const sheet = newSheet(drawingId, i, { widthPx, heightPx, renderDpi, raster, nominalMmPerPx, scaleStamp: info.scaleStamp, isScan: info.isScan, nativeDpi: info.nativeDpi, thicknessLessPrecise: info.isScan && nominalMmPerPx > cfg.targetMmPerPx });
        // display raster (always) and full raster when stored
        const dispFactor = Math.min(1, MAX_DISPLAY_LONG_EDGE / Math.max(widthPx, heightPx));
        const scanImg = info.isScan && doc.numPages === 1 ? extractPdfImage(rawBytes) : null;
        if (scanImg && canDecodeBilevel(scanImg)) {
          // bilevel scan: decode once to packed bits (sheet px = image px)
          const bl = await decodePdfImageToBilevel(scanImg);
          sheet.raster = 'bilevel';
          sheet.widthPx = bl.width;
          sheet.heightPx = bl.height;
          sheet.renderDpi = Math.round(bl.width / info.widthIn);
          sheet.nativeDpi = sheet.renderDpi;
          sheet.nominalMmPerPx = (25.4 / sheet.renderDpi) * stamp;
          sheet.bitsKey = `bits:${sheet.id}`;
          await putBlob(sheet.bitsKey, new Blob([bl.bits], { type: 'application/octet-stream' }));
          const df = Math.min(1, MAX_DISPLAY_LONG_EDGE / Math.max(bl.width, bl.height));
          const disp = bl.toCanvas({ x: 0, y: 0, w: bl.width, h: bl.height }, df);
          sheet.overviewKey = `ov:${sheet.id}`;
          sheet.overviewFactor = disp.width / bl.width;
          await putBlob(sheet.overviewKey, await canvasToBlob(disp));
        } else if (raster === 'stored') {
          const canvas = await renderPdfRegion(info.page, renderDpi);
          sheet.imageKey = `img:${sheet.id}`;
          await putBlob(sheet.imageKey, await canvasToBlob(canvas));
          const { canvas: disp } = downscale(canvas, MAX_DISPLAY_LONG_EDGE);
          sheet.overviewKey = `ov:${sheet.id}`;
          sheet.overviewFactor = disp.width / canvas.width;
          await putBlob(sheet.overviewKey, await canvasToBlob(disp));
          canvas.width = 1;
          canvas.height = 1;
        } else {
          const disp = await renderPdfRegion(info.page, renderDpi * dispFactor);
          sheet.overviewKey = `ov:${sheet.id}`;
          sheet.overviewFactor = dispFactor;
          await putBlob(sheet.overviewKey, await canvasToBlob(disp));
        }
        if (!info.isScan) sheet.textItems = await pdfTextItems(info.page, renderDpi);
        store.update((p) => p.sheets.push(sheet), { undoable: false });
      }
    } else {
      const img = await decodeImageFile(file);
      store.update((p) => p.drawings.push({ id: drawingId, fileName: file.name, kind: 'image', pages: img.pages.length }), { undoable: false });
      for (let i = 0; i < img.pages.length; i++) {
        const pg = img.pages[i];
        const sheet = newSheet(drawingId, i, { widthPx: pg.width, heightPx: pg.height, renderDpi: pg.dpi, raster: 'stored', isScan: true, nativeDpi: pg.dpi, nominalMmPerPx: pg.dpi ? (25.4 / pg.dpi) * 100 : null });
        if (pg.bilevel) {
          sheet.raster = 'bilevel';
          sheet.bitsKey = `bits:${sheet.id}`;
          await putBlob(sheet.bitsKey, new Blob([pg.bilevel.bits], { type: 'application/octet-stream' }));
          const df = Math.min(1, MAX_DISPLAY_LONG_EDGE / Math.max(pg.width, pg.height));
          const disp = pg.bilevel.toCanvas({ x: 0, y: 0, w: pg.width, h: pg.height }, df);
          sheet.overviewKey = `ov:${sheet.id}`;
          sheet.overviewFactor = disp.width / pg.width;
          await putBlob(sheet.overviewKey, await canvasToBlob(disp));
        } else {
          sheet.imageKey = `img:${sheet.id}`;
          await putBlob(sheet.imageKey, await canvasToBlob(pg.canvas));
          const { canvas: disp } = downscale(pg.canvas, MAX_DISPLAY_LONG_EDGE);
          sheet.overviewKey = `ov:${sheet.id}`;
          sheet.overviewFactor = disp.width / pg.canvas.width;
          await putBlob(sheet.overviewKey, await canvasToBlob(disp));
        }
        store.update((p) => p.sheets.push(sheet), { undoable: false });
      }
    }
  }
  toast(t('status.saved'));
}

export function render(root, ctx) {
  const { store } = ctx;
  const p = store.project;
  clear(root);
  const set = (fn) => store.update(fn, { label: 'drawings' });
  const manual = ctx.manualProvider;
  const progress = ctx.runner.progress.jobs;
  const drop = h('div', { class: 'drop', onClick: async () => { const files = await pickFiles({ accept: '.pdf,.tif,.tiff,.png,.jpg,.jpeg', multiple: true }); if (files.length) { await importFiles(ctx, files); ctx.rerender(); } } }, t('drawings.dropHere'));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => { e.preventDefault(); drop.classList.remove('over'); await importFiles(ctx, [...e.dataTransfer.files]); ctx.rerender(); });
  const sheetRows = p.sheets.map((s) => {
    const jobs = Object.values(progress).filter((j) => j.sheetId === s.id);
    const status = s.readStatus === 'unread' ? t('drawings.unread') : s.readStatus;
    const c = s.classification;
    return {
      cells: [
        h('span', {}, sheetLabel(p, s), h('div', { class: 'muted small' }, `${s.widthPx}×${s.heightPx} px${s.isScan ? ` · scan ${s.nativeDpi} dpi` : ` · ${Math.round(s.renderDpi)} dpi`}${s.scaleStamp ? ` · 1:${s.scaleStamp}` : ''}${s.thicknessLessPrecise ? ' · thickness less precise (coarse scan)' : ''}${s.textItems && s.textItems.length ? ` · ${t('drawings.textLayer')} ${s.textItems.length}` : ''}`)),
        c ? h('span', {}, `${c.type}/${c.discipline}`, h('div', { class: 'muted small' }, c.reasoning)) : '–',
        select([['plan', t('drawings.plan')], ['vertical', t('drawings.vertical')], ['other', 'other']], s.type, (v) => set((pr) => (pr.sheets.find((x) => x.id === s.id).type = v))),
        select([[null, '–'], ...[...p.levels].sort((a, b) => a.level - b.level).map((l) => [l.level, `${l.level}: ${l.name}`])], s.level, (v) => set((pr) => (pr.sheets.find((x) => x.id === s.id).level = v == null ? null : Number(v)))),
        h('span', {}, select(['base', 'scale-reference', 'change-patch', 'cross-check', 'ignore'].map((r) => [r, t(`drawings.roles.${r}`)]), s.role, (v) => set((pr) => { const x = pr.sheets.find((y) => y.id === s.id); x.role = v; x.roleOrigin = 'user'; })), s.roleReasoning ? h('div', { class: 'muted small', title: s.roleReasoning }, `AI: ${s.roleReasoning.slice(0, 80)}${s.roleReasoning.length > 80 ? '…' : ''}`) : null),
        h('span', {}, status, s.tiles ? ` · ${s.tiles.filter((x) => x.status === 'done').length}/${s.tiles.length} ${t('drawings.tiles')}` : '', jobs.some((j) => j.status === 'failed') ? h('div', { class: 'warn small' }, jobs.filter((j) => j.status === 'failed').map((j) => j.error).join('; ')) : null),
        button(t('drawings.remove'), () => set((pr) => { pr.sheets = pr.sheets.filter((x) => x.id !== s.id); })),
      ],
    };
  });
  const pendingRows = manual ? manual.listPending().map((r) => ({ cells: [r.id, r.jobType, r.model, r.zipBlob ? button(t('drawings.downloadRequest'), () => download(r.zipBlob, `${r.id}.zip`)) : '(exchange folder)'] })) : [];
  const readsRows = [...p.reads].reverse().slice(0, 40).map((r) => ({ cells: [r.id, r.jobType, r.model, r.mode, r.promptVersion, r.status, r.error || (r.objectsTouched ? `${r.objectsTouched.length} objects touched` : ''), r.usage ? `${r.usage.input_tokens}/${r.usage.output_tokens}` : ''] }));
  root.append(
    section(t('drawings.title'), drop,
      h('div', { class: 'row' },
        button(t('drawings.readAll'), async () => { if (!p.sheets.length) return; try { ctx.setBusy(t('drawings.reading')); await ctx.runner.fullRead(); toast(t('drawings.readDone')); } catch (e) { toast(String(e.message || e), 'error'); } finally { ctx.setBusy(null); ctx.rerender(); } }, { class: 'btn primary', disabled: !p.sheets.length }),
        button(t('drawings.readUnread'), async () => { if (!p.sheets.length) return; try { ctx.setBusy(t('drawings.reading')); await ctx.runner.fullRead(null, { onlyUnread: true }); toast(t('drawings.readDone')); } catch (e) { toast(String(e.message || e), 'error'); } finally { ctx.setBusy(null); ctx.rerender(); } }, { class: 'btn', disabled: !p.sheets.some((s) => !s.readStatus || s.readStatus === 'unread' || s.readStatus === 'overview') }),
        h('span', { class: 'muted' }, `${Object.values(progress).filter((j) => j.status === 'done').length}/${Object.keys(progress).length} ${t('drawings.requests')}`)
      ),
      p.sheets.length ? table([t('drawings.files'), t('drawings.classification'), '', t('floors.level'), t('drawings.role'), 'status', ''], sheetRows) : h('p', { class: 'muted' }, t('drawings.noSheets'))
    ),
    p.config.ai.manualMode ? section(`${t('manualMode')} — ${t('drawings.requests')}`, h('p', { class: 'help' }, t('drawings.exchangeFolderHelp')),
      h('div', { class: 'row' },
        ManualProvider.supportsFolder() ? button(t('drawings.exchangeFolder'), async () => { try { const name = await manual.chooseFolder(); toast(name); ctx.rerender(); } catch (e) { toast(String(e.message || e), 'error'); } }) : h('span', { class: 'muted' }, 'File System Access API not available: download/upload'),
        manual && manual.dirHandle ? h('span', {}, `📁 ${manual.dirHandle.name}`) : null,
        button(t('drawings.uploadResponse'), async () => { const files = await pickFiles({ accept: '.json', multiple: true }); for (const f of files) { const r = await manual.acceptResponseFile(f); if (!r.ok) toast(`${t('drawings.invalidResponse')}: ${JSON.stringify(r.error).slice(0, 300)}`, 'error'); } ctx.rerender(); })
      ),
      table(['id', 'job', t('drawings.model'), ''], pendingRows)) : null,
    section(t('drawings.requests'), table(['id', 'job', t('drawings.model'), t('drawings.origin'), t('drawings.prompts'), 'status', '', 'tokens'], readsRows))
  );
}
