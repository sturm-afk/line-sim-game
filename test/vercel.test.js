const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { handle } = require('../api/vercel/[...path].js');

const origin = 'https://line-sim.example';
const env = {
  SUPABASE_URL: 'https://database.example',
  SUPABASE_SERVICE_ROLE_KEY: 'server-only-key',
  FACILITATOR_PASSWORD: 'correct horse battery staple',
  FACILITATOR_SESSION_SECRET: 'a secret used only to sign facilitator sessions'
};

function request(path, { method = 'GET', body, headers = {} } = {}) {
  return new Request(`${origin}/api/vercel/${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function facilitatorCookie() {
  const expires = String(Date.now() + 60000);
  const signature = createHmac('sha256', env.FACILITATOR_SESSION_SECRET)
    .update(expires).digest('base64url');
  return `__Host-vercel_facilitator=${expires}.${signature}`;
}

test('Vercel station API is isolated and does not require the database', async () => {
  const response = await handle(request('stations'), {
    env: {},
    fetch: () => { throw new Error('database must not be used'); }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).length, 8);
});

test('Vercel team listing preserves the array response contract', async () => {
  const response = await handle(request('teams'), {
    env,
    fetch: async () => Response.json({
      httpStatus: 200,
      teams: [{ id: 'team-id', name: 'Team A' }]
    })
  });
  assert.deepEqual(await response.json(), [{ id: 'team-id', name: 'Team A' }]);
});

test('Vercel player APIs use the managed database RPC with parameterized JSON input', async () => {
  let call;
  const response = await handle(request('teams', {
    method: 'POST',
    body: { name: "Team'); DROP TABLE teams; --" }
  }), {
    env,
    fetch: async (url, options) => {
      call = { url, options };
      return Response.json({ httpStatus: 200, id: 'team-id', name: "Team'); DROP TABLE teams; --" });
    }
  });
  assert.equal(response.status, 200);
  assert.equal(call.url, `${env.SUPABASE_URL}/rest/v1/rpc/vercel_api`);
  assert.equal(call.options.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
  assert.deepEqual(JSON.parse(call.options.body), {
    p_action: 'team-create',
    p_payload: { name: "Team'); DROP TABLE teams; --" }
  });
  assert.deepEqual(await response.json(), { id: 'team-id', name: "Team'); DROP TABLE teams; --" });
});

test('facilitator-only actions reject unauthenticated and cross-origin requests', async () => {
  let called = false;
  const fetch = async () => {
    called = true;
    return Response.json({ httpStatus: 200, ok: true });
  };
  const unauthorized = await handle(request('game/reset', { method: 'POST', body: {} }), { env, fetch });
  assert.equal(unauthorized.status, 401);
  assert.equal(called, false);

  const crossOrigin = await handle(request('game/reset', {
    method: 'POST', body: {}, headers: {
      origin: 'https://attacker.example', cookie: facilitatorCookie()
    }
  }), { env, fetch });
  assert.equal(crossOrigin.status, 403);
  assert.equal(called, false);
});

test('facilitator login issues a signed session required for protected controls', async () => {
  const login = await handle(request('auth', {
    method: 'POST',
    body: { action: 'login', password: env.FACILITATOR_PASSWORD },
    headers: { origin }
  }), { env });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);

  let rpcBody;
  const started = await handle(request('timer/start', {
    method: 'POST',
    body: { durationSeconds: 30 },
    headers: { origin, cookie: cookie.split(';')[0] }
  }), {
    env,
    fetch: async (_url, options) => {
      rpcBody = JSON.parse(options.body);
      return Response.json({ httpStatus: 200, ok: true });
    }
  });
  assert.equal(started.status, 200);
  assert.deepEqual(rpcBody, { p_action: 'timer-start', p_payload: { durationSeconds: 30 } });
});

test('invalid timer duration and database failure have understandable responses', async () => {
  const invalid = await handle(request('timer/start', {
    method: 'POST',
    body: { durationSeconds: 86401 },
    headers: { origin, cookie: facilitatorCookie() }
  }), { env });
  assert.equal(invalid.status, 400);

  const badDuration = await handle(request('timer/start', {
    method: 'POST',
    body: { durationSeconds: '30' },
    headers: { origin, cookie: facilitatorCookie() }
  }), { env });
  assert.equal(badDuration.status, 400);

  const originalError = console.error;
  console.error = () => {};
  let databaseError;
  try {
    databaseError = await handle(request('scoreboard'), {
      env,
      fetch: async () => new Response('unavailable', { status: 500 })
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(databaseError.status, 503);
  assert.match((await databaseError.json()).error, /database.*retry/i);
});
