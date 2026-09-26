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
export async function listScreens() {
  if (!('getScreenDetails' in window)) return null;
  try {
    const details = await window.getScreenDetails();
    return details.screens.map((s, i) => ({ index: i, label: s.label || `Screen ${i + 1}`, width: s.availWidth, height: s.availHeight, primary: s.isPrimary }));
  } catch {
    return null;
  }
}
