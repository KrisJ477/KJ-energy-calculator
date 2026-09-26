// E2E driver: persistent headless Chromium, OPFS as the manual-mode exchange folder.
// usage: node drive.cjs <cmd> [args]
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright') // npm i playwright in this folder (browsers: PLAYWRIGHT_BROWSERS_PATH or executablePath below);
const ROOT = __dirname;
const EX = path.join(ROOT, 'exchange');
const URL = 'http://127.0.0.1:8123/index.html';

async function open() {
  const context = await chromium.launchPersistentContext(path.join(ROOT, 'profile'), { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--enable-unsafe-swiftshader'], viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  const page = context.pages()[0] || (await context.newPage());
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', (e) => logs.push('pageerror ' + e.message));
  await page.addInitScript(() => { window.showDirectoryPicker = () => navigator.storage.getDirectory(); });
  await page.goto(URL);
  await page.waitForFunction(() => window.__kj && window.__kj.store, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  return { context, page, logs };
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);

const cmds = {
  async init({ page }, [briefFile, name, age, tout, tin, vent]) {
    const brief = fs.readFileSync(briefFile, 'utf8');
    await ev(page, ({ brief, name, age, tout, tin, vent }) => {
      const { store, ctx } = window.__kj;
      store.update((p) => { p.meta.name = name; p.brief = brief; p.config.ageCategory = age; p.config.outdoorTemp = Number(tout); p.config.indoorSetpoint = Number(tin); p.config.ventilationSystem = vent; p.config.ai.manualMode = true; }, { label: 'init' });
      ctx.refreshMode();
    }, { brief, name, age, tout, tin, vent });
    await ev(page, async () => { await window.__kj.ctx.manualProvider.chooseFolder(); });
    console.log('initialised');
  },
  async upload({ page }, files) {
    await ev(page, () => window.__kj.ctx.navigate('drawings'));
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.drop')]);
    await chooser.setFiles(files);
    await page.waitForFunction((n) => window.__kj.store.project.sheets.length >= n, files.length, { timeout: 600000 });
    await page.waitForTimeout(2000);
    console.log(JSON.stringify(await ev(page, () => window.__kj.store.project.sheets.map((s) => ({ id: s.id, w: s.widthPx, h: s.heightPx, scan: s.isScan, dpi: s.renderDpi, raster: s.raster, stamp: s.scaleStamp, text: s.textItems.length })))));
  },
  async read({ page }, [levelsCsv]) {
    // start the full read; it will block on manual responses. Run detached: poll in later commands.
    await ev(page, () => { window.__kj.ctx.runner.fullRead().then(() => (window.__readDone = true)).catch((e) => (window.__readError = String(e.message || e))); });
    await page.waitForTimeout(5000);
    await cmds.pull({ page });
  },
  async pull({ page }) {
    // copy OPFS requests/ to disk (only new ones), and push any responses on disk into OPFS.
    const list = await ev(page, async () => {
      const root = await navigator.storage.getDirectory();
      const req = await root.getDirectoryHandle('requests', { create: true });
      const out = [];
      for await (const [name, h] of req.entries()) {
        if (h.kind !== 'directory') continue;
        const files = [];
        for await (const [fn, fh] of h.entries()) { const f = await fh.getFile(); files.push({ name: fn, size: f.size }); }
        out.push({ id: name, files });
      }
      return out;
    });
    let n = 0;
    for (const r of list) {
      const dir = path.join(EX, 'requests', r.id);
      if (fs.existsSync(path.join(dir, 'request.json'))) continue;
      fs.mkdirSync(dir, { recursive: true });
      for (const f of r.files) {
        const b64 = await ev(page, async ({ id, name }) => {
          const root = await navigator.storage.getDirectory();
          const d = await (await root.getDirectoryHandle('requests')).getDirectoryHandle(id);
          const file = await (await d.getFileHandle(name)).getFile();
          const buf = new Uint8Array(await file.arrayBuffer());
          let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
          return btoa(s);
        }, { id: r.id, name: f.name });
        fs.writeFileSync(path.join(dir, f.name), Buffer.from(b64, 'base64'));
      }
      n++;
    }
    const pending = await ev(page, () => window.__kj.ctx.manualProvider.listPending().map((x) => x.id));
    console.log(`pulled ${n} new requests; pending ${pending.length}: ${pending.join(' ')}`);
  },
  async push({ page }) {
    const dir = path.join(EX, 'responses');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const pending = await ev(page, () => window.__kj.ctx.manualProvider.listPending().map((x) => x.id));
    let n = 0;
    for (const f of files) {
      const id = f.replace(/\.json$/, '');
      if (!pending.includes(id)) continue;
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const res = await ev(page, async ({ id, text }) => {
        const root = await navigator.storage.getDirectory();
        const d = await root.getDirectoryHandle('responses', { create: true });
        const fh = await d.getFileHandle(`${id}.json`, { create: true });
        const w = await fh.createWritable(); await w.write(text); await w.close();
        return window.__kj.ctx.manualProvider.acceptResponse(id, text);
      }, { id, text });
      console.log(id, JSON.stringify(res).slice(0, 300));
      n++;
    }
    await page.waitForTimeout(3000);
    console.log(`pushed ${n}`);
    await cmds.pull({ page });
  },
  async eval({ page }, [code]) {
    const r = await page.evaluate(`(async () => { const { store, ctx } = window.__kj; ${code} })()`);
    console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1));
  },
  async shot({ page }, [view, file]) {
    if (view) await ev(page, (v) => window.__kj.ctx.navigate(v), view);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: file || path.join(ROOT, `shot_${view || 'x'}.png`) });
    console.log('shot', file);
  },
  async status({ page }) {
    console.log(JSON.stringify(await ev(page, () => { const p = window.__kj.store.project; return { done: window.__readDone, err: window.__readError, sheets: p.sheets.map((s) => ({ id: s.id, lvl: s.level, type: s.type, role: s.role, status: s.readStatus, tiles: s.tiles ? s.tiles.map((t) => t.status).join(',') : '' })), reads: p.reads.map((r) => `${r.jobType}:${r.status}`).join(' '), levels: p.levels.map((l) => [l.level, l.name, l.heightMm]), walls: p.walls.length, rooms: p.rooms.length, pending: window.__kj.ctx.manualProvider.listPending().map((x) => x.id) }; }), null, 1));
  },
};

async function serve() {
  const http = require('http');
  const b = await open();
  await b.page.evaluate(async () => { if (window.__kj.store.project.config.ai.manualMode) await window.__kj.ctx.manualProvider.chooseFolder(); });
  console.log('browser up; exchange folder chosen');
  http.createServer(async (req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const { cmd, args } = JSON.parse(body || '{}');
      const out = [];
      const orig = console.log;
      console.log = (...a) => out.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
      try {
        if (cmd === 'reload') { await b.page.reload(); await b.page.waitForFunction(() => window.__kj && window.__kj.store, null, { timeout: 30000 }); await b.page.waitForTimeout(800); await b.page.evaluate(async () => { if (window.__kj.store.project.config.ai.manualMode) await window.__kj.ctx.manualProvider.chooseFolder(); }); out.push('reloaded'); }
        else await cmds[cmd](b, args || []);
      } catch (e) { out.push('ERR ' + (e.stack || e)); }
      console.log = orig;
      if (b.logs.length) { out.push('console: ' + b.logs.splice(0).filter((l) => !l.includes('404')).slice(0, 5).join(' | ')); }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(out.join('\n'));
    });
  }).listen(8124, '127.0.0.1');
}

(async () => {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'serve') return serve();
  const b = await open();
  try {
    await cmds[cmd](b, args);
  } catch (e) {
    console.error('ERR', e);
  }
  if (b.logs.length) console.log('console errors:', b.logs.slice(0, 10).join('\n'));
  // let autosave flush
  await b.page.waitForTimeout(2500);
  await b.context.close();
})();
