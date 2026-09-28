// Pop-out windows (SPEC 2): any view in its own browser window, live-synced through the store's channel.
export async function openPopout(view, { screenIndex = null } = {}) {
  const url = new URL(window.location.href);
  url.searchParams.set('view', view);
  url.searchParams.set('popout', '1');
  let features = 'popup,width=1200,height=800';
  if (screenIndex != null && 'getScreenDetails' in window) {
    try {
      const details = await window.getScreenDetails();
      const s = details.screens[screenIndex];
      if (s) features = `popup,left=${s.availLeft},top=${s.availTop},width=${s.availWidth},height=${s.availHeight}`;
    } catch (e) {
      console.warn('screen placement not permitted', e);
    }
  }
  const w = window.open(url.toString(), '_blank', features);
  if (w && screenIndex != null) setTimeout(() => { try { w.moveTo(0, 0); } catch {} }, 500);
  return w;
}
// Screens for placement. Asks the browser only when window-management permission is already granted:
// the permission prompt would otherwise block the pop-out from opening at all, and a browser that never
// answers (or one without the API) simply gets a plain pop-out. Never waits more than 1.5 s.
export async function listScreens() {
  if (!('getScreenDetails' in window)) return null;
  try {
    if (navigator.permissions && navigator.permissions.query) {
      let state = 'prompt';
      for (const name of ['window-management', 'window-placement']) {
        try { state = (await navigator.permissions.query({ name })).state; break; } catch { /* name unknown in this browser */ }
      }
      if (state !== 'granted') return null;
    }
    const details = await Promise.race([window.getScreenDetails(), new Promise((_, reject) => setTimeout(() => reject(new Error('screen details timeout')), 1500))]);
    return details.screens.map((s, i) => ({ index: i, label: s.label || `Screen ${i + 1}`, width: s.availWidth, height: s.availHeight, primary: s.isPrimary }));
  } catch {
    return null;
  }
}
