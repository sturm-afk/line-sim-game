const { createHmac, timingSafeEqual } = require('node:crypto');

const stations = [
  { id: 'cut-blister', name: 'Cut blister pack' },
  { id: 'affix-pills', name: 'Attach pills to blister' },
  { id: 'cut-box', name: 'Cut product box' },
  { id: 'inspect-blister', name: 'Inspect blister pack' },
  { id: 'insert-blister', name: 'Insert blister into box' },
  { id: 'seal-box', name: 'Seal and label box' },
  { id: 'inspect-box', name: 'Inspect box for shipping' },
  { id: 'ship-box', name: 'Ship box' }
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const facilitatorActions = new Set([
  'timer-start', 'timer-stop', 'timer-resume', 'timer-reset',
  'station-reset', 'round-reset', 'game-reset'
]);
const cookieName = '__Host-vercel_facilitator';

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}

function tokenSignature(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function validSession(request, secret) {
  const cookie = request.headers.get('cookie') || '';
  const token = cookie.split(';').map(value => value.trim())
    .find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token || !secret || Buffer.byteLength(secret) < 32) return false;
  const [expires, signature] = token.split('.');
  if (!/^\d+$/.test(expires || '') || Number(expires) <= Date.now() || !signature) return false;
  const expected = tokenSignature(expires, secret);
  const supplied = Buffer.from(signature);
  const calculated = Buffer.from(expected);
  return supplied.length === calculated.length && timingSafeEqual(supplied, calculated);
}

function cookieHeader(secret, clear = false) {
  if (clear) return `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
  const expires = String(Date.now() + 12 * 60 * 60 * 1000);
  return `${cookieName}=${expires}.${tokenSignature(expires, secret)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`;
}

async function databaseRequest(action, payload, env, fetchImpl) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Database configuration is missing.');
  }
  const url = `${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/vercel_api`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ p_action: action, p_payload: payload })
  });
  if (!response.ok) throw new Error(`Database request failed (${response.status}).`);
  return response.json();
}

function originAllowed(request) {
  const origin = request.headers.get('origin');
  try {
    return Boolean(origin) && new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function stationsResponse() {
  return json(200, stations);
}

async function handle(request, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetch || globalThis.fetch;
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/vercel\/?/, '');
  const method = request.method.toUpperCase();
  const sessionSecret = env.FACILITATOR_SESSION_SECRET;
  const authenticated = validSession(request, sessionSecret);

  if (route === 'stations' && method === 'GET') return stationsResponse();
  if (route === 'session' && method === 'GET') return json(200, { authenticated });

  if (route === 'auth' && method === 'POST') {
    if (!originAllowed(request)) return json(403, { error: 'Request origin could not be verified.' });
    if (Number(request.headers.get('content-length')) > 4096) {
      return json(413, { error: 'Request body is too large.' });
    }
    let input;
    try {
      const text = await request.text();
      if (text.length > 4096) return json(413, { error: 'Request body is too large.' });
      input = JSON.parse(text);
    } catch {
      return json(400, { error: 'Invalid request body.' });
    }
    if (input?.action === 'logout') {
      return json(200, { authenticated: false }, { 'Set-Cookie': cookieHeader('', true) });
    }
    if (input?.action !== 'login' || !env.FACILITATOR_PASSWORD ||
        Buffer.byteLength(env.FACILITATOR_PASSWORD) < 12 || !sessionSecret || Buffer.byteLength(sessionSecret) < 32) {
      return json(503, { error: 'Facilitator authentication is not configured.' });
    }
    const supplied = Buffer.from(String(input.password || ''));
    const configured = Buffer.from(env.FACILITATOR_PASSWORD);
    const matches = createHmac('sha256', 'line-sim-password-check').update(supplied).digest();
    const expected = createHmac('sha256', 'line-sim-password-check').update(configured).digest();
    if (!timingSafeEqual(matches, expected)) return json(401, { error: 'Incorrect facilitator password.' });
    return json(200, { authenticated: true }, { 'Set-Cookie': cookieHeader(sessionSecret) });
  }

  const getActions = {
    teams: 'teams',
    scoreboard: 'scoreboard',
    events: 'events',
    completions: 'completions',
    'qc-counts': 'qc-counts'
  };
  const postActions = {
    teams: 'team-create',
    events: 'event-create',
    'completion-undo': 'completion-undo',
    'station-reset': 'station-reset',
    'timer/start': 'timer-start',
    'timer/stop': 'timer-stop',
    'timer/resume': 'timer-resume',
    'timer/reset': 'timer-reset',
    'round/reset': 'round-reset',
    'game/reset': 'game-reset'
  };
  let action;
  let payload = {};
  if (method === 'GET' && getActions[route]) {
    action = getActions[route];
    payload = Object.fromEntries(url.searchParams);
  } else if (method === 'POST' && postActions[route]) {
    if (facilitatorActions.has(postActions[route])) {
      if (!authenticated) return json(401, { error: 'Facilitator login is required for this action.' });
      if (!originAllowed(request)) return json(403, { error: 'Request origin could not be verified.' });
    }
    if (Number(request.headers.get('content-length')) > 4096) {
      return json(413, { error: 'Request body is too large.' });
    }
    try {
      const text = await request.text();
      if (text.length > 4096) return json(413, { error: 'Request body is too large.' });
      payload = text ? JSON.parse(text) : {};
    } catch {
      return json(400, { error: 'Invalid request body.' });
    }
    action = postActions[route];
    if (action === 'timer-start' && (!Number.isInteger(payload.durationSeconds) ||
      payload.durationSeconds < 1 || payload.durationSeconds > 86400)) {
      return json(400, { error: 'Duration must be between 1 and 86400 seconds.' });
    }
  } else {
    return json(404, { error: 'Not found.' });
  }

  try {
    if (action === 'teams' || action === 'team-create' || action === 'scoreboard' ||
        action === 'event-create' || action === 'events' || action === 'completions' ||
        action === 'qc-counts' || action === 'completion-undo' || facilitatorActions.has(action)) {
      const result = await databaseRequest(action, payload, env, fetchImpl);
      const status = Number(result?.httpStatus) || 200;
      const body = { ...result };
      delete body.httpStatus;
      if (status < 400 && action === 'teams') return json(status, body.teams || []);
      if (status < 400 && action === 'events') return json(status, body.events || []);
      return json(status, body);
    }
  } catch (error) {
    console.error('Vercel API request failed:', error.message);
    return json(503, { error: 'Unable to reach the game database. Please retry.' });
  }
  return json(404, { error: 'Not found.' });
}

module.exports = async function handler(req, res) {
  const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  let body;
  let tooLarge = false;
  if (!['GET', 'HEAD'].includes(req.method)) {
    body = await new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > 4096) {
          tooLarge = true;
          chunks.length = 0;
        } else if (!tooLarge) {
          chunks.push(chunk);
        }
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
  let response;
  if (tooLarge) {
    response = json(413, { error: 'Request body is too large.' });
  } else {
    try {
      response = await handle(new Request(new URL(req.url, origin), {
        method: req.method,
        headers,
        body
      }));
    } catch {
      response = json(400, { error: 'Invalid request body.' });
    }
  }
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(await response.text());
};

module.exports.handle = handle;
