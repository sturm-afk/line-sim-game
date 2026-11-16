const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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

test('flat and legacy facilitator routes forward the same actions and enforce origin checks', async () => {
  for (const [route, legacy, action, body] of [
    ['timer-start', 'timer/start', 'timer-start', { durationSeconds: 60 }],
    ['timer-stop', 'timer/stop', 'timer-stop', {}],
    ['timer-resume', 'timer/resume', 'timer-resume', {}],
    ['timer-reset', 'timer/reset', 'timer-reset', {}],
    ['round-reset', 'round/reset', 'round-reset', {}],
    ['game-reset', 'game/reset', 'game-reset', {}]
  ]) {
    for (const path of [route, legacy]) {
      let call;
      const options = {
        env,
        fetch: async (url, options) => {
          call = JSON.parse(options.body);
          return Response.json({ httpStatus: 200, ok: true });
        }
      };
      const forbidden = await handle(request(path, {
        method: 'POST', body, headers: { origin: 'https://attacker.example' }
      }), options);
      assert.equal(forbidden.status, 403);
      assert.equal(call, undefined);
      const response = await handle(request(path, {
        method: 'POST', body, headers: { origin }
      }), options);
      assert.equal(response.status, 200);
      assert.deepEqual(call, { p_action: action, p_payload: body });
    }
  }
});

test('scoreboard controls use flat routes and render counts without per-cell resets', async () => {
  const elements = new Map();
  function element() {
    return {
      children: [], listeners: {},
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      addEventListener(type, listener) { this.listeners[type] = listener; }
    };
  }
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: element
  };
  const snapshot = {
    stations: [{ id: 'cut-box', name: 'Cut box' }],
    teams: [{ id: 'team', name: 'Team' }],
    counts: [{ teamId: 'team', stationId: 'cut-box', count: 2 }],
    timer: { durationSeconds: 60, endsAt: null, remainingSeconds: null },
    serverTime: Date.now()
  };
  const calls = [];
  let badResponse = false;
  const html = readFileSync(path.join(__dirname, '../public/scoreboard.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script, {
    document, confirm: () => true, setInterval() {}, setTimeout() {}, clearTimeout() {},
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (badResponse && options.method === 'POST') return new Response('Not found', { status: 404 });
      return Response.json(options.method === 'POST' ? { ok: true } : snapshot);
    }
  });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  const cell = elements.get('teams').children[0].children[1];
  assert.equal(cell.textContent, '2');
  assert.deepEqual(cell.children, []);
  for (const [id, type, route] of [
    ['timer-form', 'submit', 'timer-start'],
    ['stop', 'click', 'timer-stop'],
    ['resume', 'click', 'timer-resume'],
    ['timer-reset', 'click', 'timer-reset'],
    ['round-reset', 'click', 'round-reset'],
    ['game-reset', 'click', 'game-reset']
  ]) {
    elements.get(id).listeners[type]({ preventDefault() {} });
    await flush();
    assert.equal(calls.filter(call => call.options.method === 'POST').at(-1).url, `/api/vercel/${route}`);
  }
  assert.deepEqual(JSON.parse(calls.find(call => call.url.endsWith('/timer-start')).options.body), {
    durationSeconds: 60
  });
  badResponse = true;
  elements.get('stop').listeners.click();
  await flush();
  assert.equal(elements.get('status').textContent, 'Unexpected server response (404). Please retry.');
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
