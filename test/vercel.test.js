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
  const playerPage = path.join(__dirname, '../public/index.html');
  const scoreboardPage = path.join(__dirname, '../public/scoreboard.html');
  assert.equal(existsSync(playerPage), true);
  assert.equal(existsSync(scoreboardPage), true);
  assert.doesNotMatch(readFileSync(playerPage, 'utf8'), /href=["']\/scoreboard["']/);
  assert.doesNotMatch(readFileSync(playerPage, 'utf8'), /Choose your team and station\./);
  assert.doesNotMatch(readFileSync(scoreboardPage, 'utf8'), /href=["']\/["']/);
  assert.deepEqual(vercelConfig.rewrites, [
    { source: '/scoreboard', destination: '/scoreboard.html' }
  ]);
  assert.equal(vercelConfig.framework, null);
});

test('player page puts prominent actions before timer and collapsed settings', () => {
  const page = readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const markup = page.split('<script>')[0];
  const setupForm = markup.match(/<form id="team-form">([\s\S]*?)<\/form>/)[1];
  assert.match(setupForm, /id="team-choice"[\s\S]*id="setup-station"[\s\S]*id="join"/);
  assert.match(markup, /class="team-row"[\s\S]*id="team-label"[\s\S]*id="count"/);
  assert.doesNotMatch(markup, /Your recorded completions here:/);
  assert.match(markup, /id="undo"[^>]*>Oops! -1<\/button>/);
  assert.match(markup, /id="done"[^>]*>Done! \+1<\/button>/);
  assert.match(markup, /id="done"[\s\S]*id="timer"[\s\S]*id="status"[\s\S]*<details>[\s\S]*id="change-team"[\s\S]*id="station"/);
  assert.match(page, /textContent = 'Oops! -1'/);
  assert.match(page, /: 'Done! \+1'/);
  assert.match(page, /\$\('count'\)\.hidden = selectedQc\(\)/);
});

test('player setup uses the selected station when joining a team', async () => {
  const page = readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const script = page.match(/<script>([\s\S]*?)<\/script>/i)[1];
  const elements = {};
  function element(id) {
    return elements[id] ||= {
      value: '', textContent: '', hidden: false, disabled: false, listeners: {},
      addEventListener(type, listener) { this.listeners[type] = listener; },
      dispatchEvent(event) { this.listeners[event.type]?.(event); },
      add(option) {
        if (['station', 'setup-station'].includes(id) && !this.value) this.value = option.value;
      }
    };
  }
  const requests = [];
  vm.runInNewContext(script, {
    document: { getElementById: element },
    localStorage: { getItem: () => null, setItem() {} },
    crypto: { randomUUID: () => 'player-id' },
    Option: function (name, value) { this.value = value; },
    Event: function (type) { this.type = type; },
    setInterval() {},
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.endsWith('/stations')) return Response.json([
        { id: 'cut-box', name: 'Cut box' },
        { id: 'inspect-box', name: 'Inspect box' }
      ]);
      if (url.endsWith('/teams') && options.method === 'POST') {
        return Response.json({ id: 'team-1', name: 'Team A' });
      }
      if (url.endsWith('/teams')) return Response.json([]);
      if (url.endsWith('/scoreboard')) return Response.json({ timer: {}, serverTime: 0 });
      if (url.includes('/completions?')) return Response.json({ count: 0, lastEventId: null });
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  elements['setup-station'].value = 'inspect-box';
  elements['setup-station'].listeners.change();
  elements['team-name'].value = 'Team A';
  await elements['team-form'].listeners.submit({ preventDefault() {} });
  const completionsRequest = requests.find(({ url }) => url.includes('/completions?'));
  assert.match(completionsRequest.url, /stationId=inspect-box/);
  assert.equal(elements.station.value, 'inspect-box');
  assert.equal(elements['team-form'].hidden, true);
  assert.equal(elements.player.hidden, false);
});

test('player page heading follows the initially selected station and station changes', async () => {
  const page = readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const script = page.match(/<script>([\s\S]*?)<\/script>/i)[1];
  const elements = {};
  function element(id) {
    return elements[id] ||= {
      value: '', textContent: '', hidden: false, disabled: false, listeners: {},
      addEventListener(type, listener) { this.listeners[type] = listener; },
      dispatchEvent(event) { this.listeners[event.type]?.(event); },
      add(option) { if (id === 'station' && !this.value) this.value = option.value; }
    };
  }
  vm.runInNewContext(script, {
    document: { getElementById: element },
    localStorage: {
      getItem: key => key.endsWith('station-id') ? 'cut-box' : null,
      setItem() {}
    },
    crypto: { randomUUID: () => 'player-id' },
    Option: function (name, value) { this.value = value; },
    Event: function (type) { this.type = type; },
    setInterval() {},
    fetch: async url => {
      if (url.endsWith('/stations')) return Response.json([
        { id: 'cut-blister', name: 'Cut blister' },
        { id: 'cut-box', name: 'Cut box' },
        { id: 'inspect-box', name: 'Inspect box' }
      ]);
      if (url.endsWith('/teams')) return Response.json([]);
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.station.value, 'cut-box');
  assert.equal(elements['page-title'].textContent, 'Cut box');
  elements.station.value = 'inspect-box';
  elements.station.listeners.change();
  assert.equal(elements['page-title'].textContent, 'Inspect box');
  assert.equal(elements['setup-station'].value, 'inspect-box');
});

test('player can retry a failed standard completion with the same event id', async () => {
  const page = readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const script = page.match(/<script>([\s\S]*?)<\/script>/i)[1];
  const elements = {};
  function element(id) {
    return elements[id] ||= {
      value: '', textContent: '', hidden: false, disabled: false, listeners: {},
      addEventListener(type, listener) { this.listeners[type] = listener; },
      dispatchEvent(event) { this.listeners[event.type]?.(event); },
      add(option) { if (id === 'station' && !this.value) this.value = option.value; }
    };
  }
  const eventIds = [];
  vm.runInNewContext(script, {
    document: { getElementById: element },
    localStorage: {
      getItem: key => key.endsWith('team-id') ? 'team-1' : null,
      setItem() {}
    },
    crypto: { randomUUID: () => 'event-id' },
    Option: function (name, value) { this.value = value; },
    Event: function (type) { this.type = type; },
    setInterval() {},
    fetch: async (url, options = {}) => {
      if (url.endsWith('/stations')) return Response.json([{ id: 'pack', name: 'Pack' }]);
      if (url.endsWith('/teams')) return Response.json([{ id: 'team-1', name: 'Team A' }]);
      if (url.endsWith('/scoreboard')) return Response.json({ timer: {}, serverTime: 0 });
      if (url.includes('/completions?')) return Response.json({ count: 0, lastEventId: null });
      if (url.endsWith('/events')) {
        eventIds.push(JSON.parse(options.body).id);
        return eventIds.length === 1
          ? Response.json({ error: 'Try again' }, { status: 500 })
          : Response.json({});
      }
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  await elements.done.listeners.click();
  assert.equal(elements.done.disabled, false);
  assert.equal(elements.done.textContent, 'Retry completion');
  assert.equal(elements.station.disabled, true);
  await elements.done.listeners.click();
  assert.deepEqual(eventIds, ['event-id', 'event-id']);
  assert.equal(elements.done.textContent, 'Done! +1');
  assert.equal(elements.station.disabled, false);
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

test('scoreboard dashboard aggregates shipped counts and toggles the timer', async () => {
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
  let snapshot = {
    stations: [
      { id: 'cut-box', name: 'Cut box' },
      { id: 'ship-box', name: 'Ship box' }
    ],
    teams: [{ id: 'team', name: 'Team' }, { id: 'other-team', name: 'Other team' }],
    counts: [
      { teamId: 'team', stationId: 'cut-box', count: 2 },
      { teamId: 'team', stationId: 'ship-box', count: 4 },
      { teamId: 'other-team', stationId: 'ship-box', count: 7 }
    ],
    timer: { durationSeconds: 60, endsAt: null, remainingSeconds: null },
    serverTime: Date.now()
  };
  const calls = [];
  let badResponse = false;
  const html = readFileSync(path.join(__dirname, '../public/scoreboard.html'), 'utf8');
  const markup = html.split('<script>')[0];
  assert.match(markup, /class="timer-clock"[\s\S]*id="countdown"[\s\S]*id="start"[^>]*>Start/);
  assert.match(markup, /id="duration"[^>]*>[\s\S]*<label for="duration">seconds<\/label>/);
  assert.match(markup, /<tbody id="teams"><\/tbody>[\s\S]*<\/table>[\s\S]*id="connection"[\s\S]*id="status"/);
  assert.doesNotMatch(markup, /New Run|Reset Game|round-reset|game-reset/);
  assert.doesNotMatch(html, /id="(?:stop|resume|timer-reset)"/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script, {
    document, confirm: () => true, setInterval() {}, setTimeout() {}, clearTimeout() {},
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (badResponse && options.method === 'POST') return new Response('Not found', { status: 404 });
      if (options.method === 'POST' && url.endsWith('/timer-start')) {
        const { durationSeconds } = JSON.parse(options.body);
        snapshot.timer = { durationSeconds, endsAt: Date.now() + durationSeconds * 1000, remainingSeconds: null };
      }
      if (options.method === 'POST' && url.endsWith('/timer-stop')) {
        snapshot.timer = { ...snapshot.timer, endsAt: null, remainingSeconds: 30 };
      }
      return Response.json(options.method === 'POST' ? { ok: true } : snapshot);
    }
  });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  const cell = elements.get('teams').children[0].children[1];
  assert.equal(cell.textContent, '2');
  assert.deepEqual(cell.children, []);
  assert.equal(elements.get('total-shipped').textContent, 11);
  assert.equal(elements.get('start').textContent, 'Start');
  elements.get('timer-form').listeners.submit({ preventDefault() {} });
  await flush();
  assert.equal(calls.filter(call => call.options.method === 'POST').at(-1).url, '/api/vercel/timer-start');
  assert.equal(elements.get('start').textContent, 'Stop');
  elements.get('timer-form').listeners.submit({ preventDefault() {} });
  await flush();
  assert.equal(calls.filter(call => call.options.method === 'POST').at(-1).url, '/api/vercel/timer-stop');
  assert.equal(elements.get('start').textContent, 'Start');
  snapshot.timer.endsAt = Date.now() - 1;
  elements.get('timer-form').listeners.submit({ preventDefault() {} });
  await flush();
  assert.equal(calls.filter(call => call.options.method === 'POST').at(-1).url, '/api/vercel/timer-start');
  assert.deepEqual(JSON.parse(calls.filter(call => call.url.endsWith('/timer-start'))[0].options.body), {
    durationSeconds: 60
  });
  badResponse = true;
  snapshot.timer.endsAt = Date.now() + 30000;
  elements.get('timer-form').listeners.submit({ preventDefault() {} });
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
