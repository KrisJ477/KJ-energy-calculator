// Central store: one project state, undo/redo, subscriptions and live sync between windows (SPEC 2).
// The main window owns the state; pop-out windows dispatch actions to it and receive state snapshots.
import { newProject } from './model.js';

const CHANNEL = 'kj-energy-calculator';

export class Store {
  constructor({ isMain = true } = {}) {
    this.isMain = isMain;
    this.state = { project: newProject(), selection: { ids: [], level: null }, session: { language: 'sv', view: 'wizard', manualBadge: false, readQueue: [] } };
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    this.version = 0;
    this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
    if (this.channel) this.channel.onmessage = (ev) => this.onMessage(ev.data);
    this.pendingActions = new Map();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  notify(meta = {}) {
    for (const fn of this.listeners) {
      try {
        fn(this.state, meta);
      } catch (e) {
        console.error(e);
      }
    }
  }

  get project() {
    return this.state.project;
  }

  // Apply a mutation. fn(project, state) mutates in place. undoable: record a snapshot.
  // In a pop-out window the mutation is applied locally and committed to the main window, which owns
  // the single undo history and broadcasts the resulting state to every window.
  update(fn, { undoable = true, label = '', meta = {} } = {}) {
    if (!this.isMain) {
      fn(this.state.project, this.state);
      this.notify({ ...meta, label, local: true });
      this.send({ type: 'commit', project: this.state.project, selection: this.state.selection, label, undoable });
      return;
    }
    if (undoable) {
      this.undoStack.push({ label, project: structuredClone(this.state.project), selection: structuredClone(this.state.selection) });
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack.length = 0;
    }
    fn(this.state.project, this.state);
    this.state.project.meta.modifiedAt = new Date().toISOString();
    this.version++;
    this.notify({ ...meta, label });
    this.broadcastState();
  }
  commit({ project, selection, label, undoable }) {
    if (undoable) {
      this.undoStack.push({ label, project: structuredClone(this.state.project), selection: structuredClone(this.state.selection) });
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack.length = 0;
    }
    this.state.project = project;
    this.state.selection = selection;
    this.version++;
    this.notify({ label, committed: true });
    this.broadcastState();
  }

  // Non-undoable change of UI/session state (selection, language, view) synced to all windows.
  setSelection(sel) {
    this.state.selection = { ...this.state.selection, ...sel };
    if (!this.isMain) {
      this.notify({ selection: true, local: true });
      return this.send({ type: 'selection', selection: this.state.selection });
    }
    this.notify({ selection: true });
    this.broadcastState();
  }
  setSession(patch) {
    this.state.session = { ...this.state.session, ...patch };
    this.notify({ session: true });
    if (this.isMain) this.broadcastState();
  }

  replaceProject(project, { resetHistory = true } = {}) {
    if (!this.isMain) return;
    this.state.project = project;
    if (resetHistory) {
      this.undoStack.length = 0;
      this.redoStack.length = 0;
    }
    this.version++;
    this.notify({ replaced: true });
    this.broadcastState();
  }

  undo() {
    if (!this.isMain) return this.send({ type: 'undo' });
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push({ label: s.label, project: structuredClone(this.state.project), selection: structuredClone(this.state.selection) });
    this.state.project = s.project;
    this.state.selection = s.selection;
    this.version++;
    this.notify({ undo: true });
    this.broadcastState();
  }
  redo() {
    if (!this.isMain) return this.send({ type: 'redo' });
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push({ label: s.label, project: structuredClone(this.state.project), selection: structuredClone(this.state.selection) });
    this.state.project = s.project;
    this.state.selection = s.selection;
    this.version++;
    this.notify({ redo: true });
    this.broadcastState();
  }

  // ---- multi-window sync ----
  send(msg) {
    if (this.channel) this.channel.postMessage(msg);
  }
  broadcastState() {
    if (!this.channel) return;
    this.send({ type: 'state', version: this.version, project: this.state.project, selection: this.state.selection, session: this.state.session });
  }
  onMessage(msg) {
    if (!msg) return;
    if (this.isMain) {
      if (msg.type === 'commit') this.commit(msg);
      else if (msg.type === 'selection') this.setSelection(msg.selection);
      else if (msg.type === 'undo') this.undo();
      else if (msg.type === 'redo') this.redo();
      else if (msg.type === 'hello') this.broadcastState();
      else if (msg.type === 'session') this.setSession(msg.patch);
    } else if (msg.type === 'state') {
      this.state.project = msg.project;
      this.state.selection = msg.selection;
      this.state.session = { ...this.state.session, ...msg.session, view: this.state.session.view };
      this.version = msg.version;
      this.notify({ remote: true });
    } else if (msg.type === 'close') {
      window.close();
    }
  }
  hello() {
    this.send({ type: 'hello' });
  }
}
