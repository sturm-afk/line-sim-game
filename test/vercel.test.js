const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { handle } = require('../api/vercel/[...path].js');
const vercelConfig = require('../vercel.json');

const origin = 'https://line-sim.example';
const env = {
  SUPABASE_URL: 'https://database.example',
  SUPABASE_SERVICE_ROLE_KEY: 'server-only-key'
};

test('Vercel serves the player page and rewrites the scoreboard route', () => {
  assert.equal(existsSync(path.join(__dirname, '../public/index.html')), true);
  assert.equal(existsSync(path.join(__dirname, '../public/scoreboard.html')), true);
  assert.deepEqual(vercelConfig.rewrites, [
    { source: '/scoreboard', destination: '/scoreboard.html' }
  ]);
  assert.equal(vercelConfig.framework, null);
});

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

test('facilitator actions require a same-origin request but no login', async () => {
  let called = false;
  const fetch = async () => {
    called = true;
    return Response.json({ httpStatus: 200, ok: true });
  };
  const allowed = await handle(request('game/reset', {
    method: 'POST', body: {}, headers: { origin }
  }), { env, fetch });
  assert.equal(allowed.status, 200);
  assert.equal(called, true);

  called = false;
  const crossOrigin = await handle(request('game/reset', {
    method: 'POST', body: {}, headers: { origin: 'https://attacker.example' }
  }), { env, fetch });
  assert.equal(crossOrigin.status, 403);
  assert.equal(called, false);

  const authRoute = await handle(request('auth', {
    method: 'POST', body: { action: 'login' }, headers: { origin }
  }), { env });
  assert.equal(authRoute.status, 404);
  const sessionRoute = await handle(request('session'), { env });
  assert.equal(sessionRoute.status, 404);
});

test('invalid timer duration and database failure have understandable responses', async () => {
  const invalid = await handle(request('timer/start', {
    method: 'POST',
    body: { durationSeconds: 86401 },
    headers: { origin }
  }), { env });
  assert.equal(invalid.status, 400);

  const badDuration = await handle(request('timer/start', {
    method: 'POST',
    body: { durationSeconds: '30' },
    headers: { origin }
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
