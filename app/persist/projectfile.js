// Project file: "Save" downloads the whole project as one file, "Open" loads it back (SPEC 2).
// Format: JSON { format, project, images: { key: dataURL } }.
import { getBlob, putBlob } from './autosave.js';

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
async function dataUrlToBlob(url) {
  const res = await fetch(url);
  return res.blob();
}

export async function exportProject(project) {
  const images = {};
  for (const sheet of project.sheets) {
    for (const key of [sheet.imageKey, sheet.overviewKey, sheet.bitsKey, `src:${sheet.drawingId}`].filter(Boolean)) {
      if (images[key]) continue;
      const blob = await getBlob(key);
      if (blob) images[key] = await blobToDataUrl(blob);
    }
  }
  const payload = { format: 'kj-energy-calculator-project', version: 1, savedAt: new Date().toISOString(), project, images };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const name = `${(project.meta.name || 'projekt').replace(/[^\w\-åäöÅÄÖ ]+/g, '_')}.kjproj.json`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export async function importProject(file) {
  const text = await file.text();
  const payload = JSON.parse(text);
  if (payload.format !== 'kj-energy-calculator-project') throw new Error('not a project file');
  for (const [key, url] of Object.entries(payload.images || {})) {
    await putBlob(key, await dataUrlToBlob(url));
  }
  return payload.project;
}
