// Cloudflare Worker (SPEC 2): holds the Anthropic API key, checks the app password and forwards
// Messages API requests. Secrets: ANTHROPIC_API_KEY, APP_PASSWORD (wrangler secret put ...).
const ANTHROPIC = 'https://api.anthropic.com/v1/messages';

function cors(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-app-password',
    'access-control-max-age': '86400',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin');
    const allowed = env.ALLOWED_ORIGIN ? env.ALLOWED_ORIGIN : origin;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(allowed) });
    const url = new URL(request.url);
    if (request.method !== 'POST' || !url.pathname.endsWith('/v1/messages')) return new Response('not found', { status: 404, headers: cors(allowed) });
    const pw = request.headers.get('x-app-password') || '';
    if (!env.APP_PASSWORD || pw !== env.APP_PASSWORD) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...cors(allowed), 'content-type': 'application/json' } });
    const body = await request.text();
    const upstream = await fetch(ANTHROPIC, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body,
    });
    const text = await upstream.text();
    return new Response(text, { status: upstream.status, headers: { ...cors(allowed), 'content-type': upstream.headers.get('content-type') || 'application/json' } });
  },
};
