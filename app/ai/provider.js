// AI provider layer (SPEC 2): one interface, two interchangeable modes. The rest of the app does not know
// which mode answered. A job: { id, type, model, system, user, images: [{ name, blob }], schema, promptVersion,
// brief, meta }. Result: { data, model, mode, usage }.
import { validate } from './validate.js';
import { zipStore, unzip } from '../drawings/zip.js';

const encoder = new TextEncoder();

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) s += String.fromCharCode.apply(null, buf.subarray(i, i + chunk));
  return btoa(s);
}

function maxTokensFor(type) {
  return type === 'overview' ? 16000 : type === 'command' ? 8000 : 32000;
}

// ---------------- API mode: through the Cloudflare Worker ----------------
export class ApiProvider {
  constructor({ workerUrl, getPassword }) {
    this.workerUrl = workerUrl;
    this.getPassword = getPassword;
    this.mode = 'api';
  }
  async run(job, { signal } = {}) {
    const content = [];
    for (const img of job.images || []) {
      content.push({ type: 'text', text: `Image: ${img.name}` });
      content.push({ type: 'image', source: { type: 'base64', media_type: img.blob.type || 'image/png', data: await blobToBase64(img.blob) } });
    }
    content.push({ type: 'text', text: job.user });
    const body = {
      model: job.model,
      max_tokens: maxTokensFor(job.type),
      system: [{ type: 'text', text: job.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
      output_config: { format: { type: 'json_schema', schema: job.schema } },
    };
    const res = await fetch(`${this.workerUrl.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-app-password': this.getPassword() || '' },
      body: JSON.stringify(body),
      signal,
    });
    if (res.status === 401 || res.status === 403) throw new Error('password rejected by the Worker');
    if (!res.ok) throw new Error(`API error ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const msg = await res.json();
    if (msg.stop_reason === 'refusal') throw new Error('model refused the request');
    if (msg.stop_reason === 'max_tokens') throw new Error('response truncated (max_tokens)');
    const text = (msg.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('response is not JSON');
    }
    const v = validate(data, job.schema);
    if (!v.ok) throw new Error(`response fails schema: ${v.errors.slice(0, 5).join('; ')}`);
    return { data, model: msg.model || job.model, mode: 'api', usage: msg.usage || null };
  }
}

// ---------------- Manual mode: exchange folder or download/upload ----------------
// Layout in the exchange folder: requests/<id>/request.json + images; responses/<id>.json.
export class ManualProvider {
  constructor({ onStatus } = {}) {
    this.mode = 'manual';
    this.dirHandle = null;
    this.pending = new Map(); // id → { job, resolve, reject, bundleUrl }
    this.onStatus = onStatus || (() => {});
    this.pollTimer = null;
    this.pollIntervalMs = 2000;
  }
  static supportsFolder() {
    return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  }
  async chooseFolder() {
    this.dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await this.dirHandle.getDirectoryHandle('requests', { create: true });
    await this.dirHandle.getDirectoryHandle('responses', { create: true });
    this.startPolling();
    return this.dirHandle.name;
  }
  bundleFor(job) {
    return {
      requestId: job.id,
      jobType: job.type,
      model: job.model,
      promptVersion: job.promptVersion,
      schema: job.schema,
      projectBrief: job.brief || '',
      system: job.system,
      user: job.user,
      images: (job.images || []).map((i) => i.name),
      meta: job.meta || null,
      createdAt: new Date().toISOString(),
    };
  }
  async run(job) {
    const bundle = this.bundleFor(job);
    const entry = { job, bundle };
    const promise = new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });
    this.pending.set(job.id, entry);
    if (this.dirHandle) {
      await this.writeBundle(job, bundle);
      this.startPolling();
    } else {
      entry.zipBlob = await this.zipBundle(job, bundle);
    }
    this.onStatus({ type: 'pending', id: job.id, jobType: job.type });
    return promise;
  }
  async writeBundle(job, bundle) {
    const reqDir = await this.dirHandle.getDirectoryHandle('requests', { create: true });
    const dir = await reqDir.getDirectoryHandle(job.id, { create: true });
    for (const img of job.images || []) {
      const fh = await dir.getFileHandle(img.name, { create: true });
      const w = await fh.createWritable();
      await w.write(img.blob);
      await w.close();
    }
    const fh = await dir.getFileHandle('request.json', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(bundle, null, 1));
    await w.close();
  }
  async zipBundle(job, bundle) {
    const files = [{ name: `${job.id}/request.json`, data: encoder.encode(JSON.stringify(bundle, null, 1)) }];
    for (const img of job.images || []) files.push({ name: `${job.id}/${img.name}`, data: new Uint8Array(await img.blob.arrayBuffer()) });
    return new Blob([zipStore(files)], { type: 'application/zip' });
  }
  listPending() {
    return [...this.pending.values()].map((e) => ({ id: e.job.id, jobType: e.job.type, model: e.job.model, zipBlob: e.zipBlob || null }));
  }
  // Load a response file (from upload or the exchange folder). Validated exactly like an API response;
  // an invalid response is reported as an error and the request stays pending.
  acceptResponse(id, text) {
    const entry = this.pending.get(id);
    if (!entry) return { ok: false, error: `no pending request ${id}` };
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      this.onStatus({ type: 'error', id, error: 'response is not JSON' });
      return { ok: false, error: 'response is not JSON' };
    }
    if (data && data.requestId && data.response !== undefined) data = data.response;
    const v = validate(data, entry.job.schema);
    if (!v.ok) {
      this.onStatus({ type: 'error', id, error: `schema: ${v.errors.slice(0, 5).join('; ')}` });
      return { ok: false, error: v.errors };
    }
    this.pending.delete(id);
    this.onStatus({ type: 'done', id });
    entry.resolve({ data, model: 'manual', mode: 'manual', usage: null });
    return { ok: true };
  }
  async acceptResponseFile(file) {
    const text = await file.text();
    let id = null;
    try {
      const parsed = JSON.parse(text);
      id = parsed.requestId || null;
    } catch {}
    if (!id) id = (file.name || '').replace(/\.json$/i, '');
    return this.acceptResponse(id, text);
  }
  startPolling() {
    if (this.pollTimer || !this.dirHandle) return;
    this.pollTimer = setInterval(() => this.poll().catch((e) => console.warn('poll', e)), this.pollIntervalMs);
  }
  stopPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }
  async poll() {
    if (!this.dirHandle || this.pending.size === 0) return;
    const resDir = await this.dirHandle.getDirectoryHandle('responses', { create: true });
    for (const [id] of this.pending) {
      let fh;
      try {
        fh = await resDir.getFileHandle(`${id}.json`);
      } catch {
        continue;
      }
      const file = await fh.getFile();
      if (this.lastTried && this.lastTried[id] === file.lastModified) continue;
      this.lastTried = this.lastTried || {};
      this.lastTried[id] = file.lastModified;
      const text = await file.text();
      this.acceptResponse(id, text);
    }
  }
  cancel(id) {
    const e = this.pending.get(id);
    if (e) {
      this.pending.delete(id);
      e.reject(new Error('cancelled'));
    }
  }
}

export { unzip };
