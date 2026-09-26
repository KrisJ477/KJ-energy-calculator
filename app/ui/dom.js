// Small DOM helpers (no framework; static files per SPEC 2).
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value' && (tag === 'input' || tag === 'select' || tag === 'textarea')) el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'readOnly' || k === 'multiple') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}
export function fmt(n, digits = 0) {
  if (n == null || Number.isNaN(n)) return '–';
  return Number(n).toLocaleString(document.documentElement.lang === 'en' ? 'en-GB' : 'sv-SE', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
export function numberInput(value, onChange, { step = 'any', min, max, width = '6em', placeholder } = {}) {
  return h('input', {
    type: 'number',
    step,
    min,
    max,
    placeholder,
    value: value == null ? '' : value,
    style: { width },
    onChange: (e) => onChange(e.target.value === '' ? null : Number(e.target.value)),
  });
}
export function textInput(value, onChange, opts = {}) {
  return h('input', { type: 'text', value: value ?? '', style: { width: opts.width || '12em' }, placeholder: opts.placeholder, onChange: (e) => onChange(e.target.value) });
}
export function select(options, value, onChange, opts = {}) {
  const sel = h('select', { onChange: (e) => onChange(e.target.value === '__null' ? null : e.target.value), style: opts.style || {} });
  for (const o of options) {
    const [v, label] = Array.isArray(o) ? o : [o, o];
    sel.append(h('option', { value: v == null ? '__null' : v, selected: v === value || (v == null && value == null) }, label));
  }
  return sel;
}
export function checkbox(checked, onChange, label) {
  const id = `cb_${Math.random().toString(36).slice(2, 8)}`;
  return h('label', { class: 'cb' }, h('input', { type: 'checkbox', id, checked: !!checked, onChange: (e) => onChange(e.target.checked) }), label ? ` ${label}` : '');
}
export function button(label, onClick, opts = {}) {
  return h('button', { class: opts.class || 'btn', onClick, title: opts.title, disabled: opts.disabled }, label);
}
export function modal(title, body, { buttons = [], onClose } = {}) {
  const overlay = h('div', { class: 'modal-overlay' });
  const box = h('div', { class: 'modal' }, h('div', { class: 'modal-title' }, title), h('div', { class: 'modal-body' }, body));
  const footer = h('div', { class: 'modal-footer' });
  const close = () => {
    overlay.remove();
    if (onClose) onClose();
  };
  for (const b of buttons) footer.append(button(b.label, () => { const r = b.onClick ? b.onClick() : true; if (r !== false) close(); }, { class: b.primary ? 'btn primary' : 'btn' }));
  box.append(footer);
  overlay.append(box);
  document.body.append(overlay);
  return { close, box };
}
export function table(headers, rows, opts = {}) {
  const t = h('table', { class: `tbl ${opts.class || ''}` });
  if (headers) t.append(h('thead', {}, h('tr', {}, headers.map((x) => h('th', {}, x)))));
  const tb = h('tbody');
  for (const r of rows) tb.append(h('tr', r.attrs || {}, r.cells.map((c) => h('td', {}, c))));
  t.append(tb);
  return t;
}
export function section(title, ...children) {
  return h('section', { class: 'card' }, title ? h('h3', {}, title) : null, ...children);
}
export function toast(msg, kind = 'info') {
  const el = h('div', { class: `toast ${kind}` }, msg);
  document.body.append(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  }, 4000);
}
export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
export function pickFiles({ accept, multiple = false } = {}) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    inp.addEventListener('change', () => resolve([...inp.files]));
    document.body.append(inp);
    inp.click();
    setTimeout(() => inp.remove(), 60000);
  });
}
