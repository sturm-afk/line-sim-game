const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createApp } = require('../server');

test('teams and completion events persist, stay isolated, and are idempotent', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'line-sim-'));
  let server;
  async function start() {
    server = createApp(dir);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  }
  async function close() {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  async function post(base, route, data) {
    return fetch(base + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
  }
  try {
    let base = await start();
    assert.equal((await fetch(base + '/api/teams', {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"name":"Invalid"}'
    })).status, 400);
    const stations = await (await fetch(base + '/api/stations')).json();
    assert.equal(stations.length, 8);
    const team = await (await post(base, '/api/teams', { name: 'Team A' })).json();
    const sameTeam = await (await post(base, '/api/teams', { name: ' team a ' })).json();
    const otherTeam = await (await post(base, '/api/teams', { name: 'Team B' })).json();
    assert.equal(team.id, sameTeam.id);
    const playerId = randomUUID();
    const event = { id: randomUUID(), playerId, teamId: team.id, stationId: 'affix-pills' };
    const responses = await Promise.all([
      post(base, '/api/events', event), post(base, '/api/events', event)
    ]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 201]);
    assert.equal((await post(base, '/api/events', { ...event, teamId: otherTeam.id })).status, 409);
    assert.equal((await post(base, '/api/events', { ...event, playerId: randomUUID() })).status, 409);
    assert.equal((await post(base, '/api/events', { ...event, id: randomUUID(), stationId: 'invalid' })).status, 400);
    assert.equal((await post(base, '/api/events', { ...event, id: randomUUID(), playerId: 'invalid' })).status, 400);
    assert.equal((await post(base, '/api/events', { ...event, id: randomUUID(), teamId: randomUUID() })).status, 404);
    await post(base, '/api/events', {
      id: randomUUID(), playerId, teamId: otherTeam.id, stationId: 'affix-pills'
    });
    await post(base, '/api/events', {
      id: randomUUID(), playerId, teamId: otherTeam.id, stationId: 'cut-blister'
    });
    const playerStationCount = await (await fetch(
      `${base}/api/completions?playerId=${playerId}&stationId=affix-pills`
    )).json();
    const otherStationCount = await (await fetch(
      `${base}/api/completions?playerId=${playerId}&stationId=cut-blister`
    )).json();
    const otherPlayerCount = await (await fetch(
      `${base}/api/completions?playerId=${randomUUID()}&stationId=affix-pills`
    )).json();
    assert.equal(playerStationCount.count, 2);
    assert.equal(otherStationCount.count, 1);
    assert.equal(otherPlayerCount.count, 0);
    assert.equal((await fetch(`${base}/api/completions?playerId=invalid&stationId=affix-pills`)).status, 400);
    assert.equal((await fetch(`${base}/api/completions?playerId=${playerId}&stationId=invalid`)).status, 400);
    assert.equal((await (await fetch(`${base}/api/events?teamId=${otherTeam.id}`)).json()).length, 2);
    await close();
    base = await start();
    const events = await (await fetch(`${base}/api/events?teamId=${team.id}`)).json();
    assert.equal(events.length, 1);
    assert.equal(events[0].id, event.id);
    assert.equal(events[0].stationId, 'affix-pills');
    assert.equal(events[0].playerId, playerId);
    assert.ok(!Number.isNaN(Date.parse(events[0].createdAt)));
  } finally {
    if (server?.listening) await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('completion subscriptions deliver only matching team events', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'line-sim-'));
  const server = createApp(dir);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, data) => fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });

  try {
    const team = await (await post('/api/teams', { name: 'A' })).json();
    const other = await (await post('/api/teams', { name: 'B' })).json();
    const stream = await fetch(`${base}/api/events/stream?teamId=${team.id}`);
    const reader = stream.body.getReader();
    await reader.read();
    await post('/api/events', { id: randomUUID(), playerId: randomUUID(), teamId: other.id, stationId: 'cut-blister' });
    const id = randomUUID();
    const playerId = randomUUID();
    await post('/api/events', { id, playerId, teamId: team.id, stationId: 'cut-blister' });
    const message = new TextDecoder().decode((await reader.read()).value);
    assert.match(message, /event: completion/);
    assert.equal(JSON.parse(message.split('data: ')[1]).id, id);
    assert.equal(JSON.parse(message.split('data: ')[1]).playerId, playerId);
    await post('/api/station-reset', { teamId: team.id, stationId: 'cut-blister' });
    const resetMessage = new TextDecoder().decode((await reader.read()).value);
    assert.match(resetMessage, /event: reset/);
    assert.deepEqual(JSON.parse(resetMessage.split('data: ')[1]), {
      teamId: team.id, stationId: 'cut-blister'
    });
    await reader.cancel();
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('existing event databases gain player tracking without losing prior completions', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'line-sim-'));
  const teamId = randomUUID();
  const oldEventId = randomUUID();
  const database = new DatabaseSync(path.join(dir, 'line-sim.sqlite'));
  database.exec(`
    CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
    CREATE TABLE events (
      id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id),
      station_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  database.prepare('INSERT INTO teams (id, name) VALUES (?, ?)').run(teamId, 'Legacy team');
  database.prepare('INSERT INTO events (id, team_id, station_id, created_at) VALUES (?, ?, ?, ?)')
    .run(oldEventId, teamId, 'cut-blister', new Date().toISOString());
  database.close();

  const server = createApp(dir);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const events = await (await fetch(`${base}/api/events?teamId=${teamId}`)).json();
    assert.equal(events.length, 1);
    assert.equal(events[0].id, oldEventId);
    assert.equal(events[0].playerId, null);
    assert.equal(events[0].result, null);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QC pass and fail results are counted by team and station', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'line-sim-'));
  const server = createApp(dir);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, data) => fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });

  try {
    const team = await (await post('/api/teams', { name: 'QC team' })).json();
    const otherTeam = await (await post('/api/teams', { name: 'Other team' })).json();
    const playerId = randomUUID();
    const qcEvent = (teamId, stationId, result) => ({
      id: randomUUID(), playerId, teamId, stationId, result
    });

    assert.equal((await post('/api/events', qcEvent(team.id, 'inspect-blister'))).status, 400);
    assert.equal((await post('/api/events', qcEvent(team.id, 'inspect-blister', 'hold'))).status, 400);
    assert.equal((await post('/api/events', qcEvent(team.id, 'cut-blister', 'pass'))).status, 400);

    const pass = qcEvent(team.id, 'inspect-blister', 'pass');
    assert.equal((await post('/api/events', pass)).status, 201);
    assert.equal((await post('/api/events', pass)).status, 200);
    assert.equal((await post('/api/events', { ...pass, result: 'fail' })).status, 409);
    assert.equal((await post('/api/events', qcEvent(team.id, 'inspect-blister', 'fail'))).status, 201);
    assert.equal((await post('/api/events', qcEvent(team.id, 'inspect-box', 'pass'))).status, 201);
    assert.equal((await post('/api/events', qcEvent(otherTeam.id, 'inspect-blister', 'fail'))).status, 201);

    assert.deepEqual(await (await fetch(
      `${base}/api/qc-counts?teamId=${team.id}&stationId=inspect-blister`
    )).json(), { pass: 1, fail: 1 });
    assert.deepEqual(await (await fetch(
      `${base}/api/qc-counts?teamId=${team.id}&stationId=inspect-box`
    )).json(), { pass: 1, fail: 0 });
    assert.deepEqual(await (await fetch(
      `${base}/api/qc-counts?teamId=${otherTeam.id}&stationId=inspect-blister`
    )).json(), { pass: 0, fail: 1 });
    assert.equal((await fetch(
      `${base}/api/qc-counts?teamId=${team.id}&stationId=cut-blister`
    )).status, 400);
    const events = await (await fetch(`${base}/api/events?teamId=${team.id}`)).json();
    assert.equal(events[0].result, 'pass');
    assert.equal(events[1].result, 'fail');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('station reset deletes only the selected team and station completions', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'line-sim-'));
  const server = createApp(dir);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, data) => fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });

  try {
    const team = await (await post('/api/teams', { name: 'Reset team' })).json();
    const otherTeam = await (await post('/api/teams', { name: 'Other reset team' })).json();
    const playerId = randomUUID();
    const addCompletion = (teamId, stationId) => post('/api/events', {
      id: randomUUID(), playerId, teamId, stationId
    });
    await addCompletion(team.id, 'cut-blister');
    await addCompletion(team.id, 'cut-blister');
    await addCompletion(team.id, 'cut-box');
    await addCompletion(otherTeam.id, 'cut-blister');

    const resetResponse = await post('/api/station-reset', {
      teamId: team.id, stationId: 'cut-blister'
    });
    assert.equal(resetResponse.status, 200);
    assert.deepEqual(await resetResponse.json(), { deleted: 2 });
    const remaining = await (await fetch(
      `${base}/api/completions?playerId=${playerId}&stationId=cut-blister`
    )).json();
    assert.equal(remaining.count, 1);
    assert.deepEqual((await (await fetch(`${base}/api/events?teamId=${team.id}`)).json())
      .map(event => event.stationId), ['cut-box']);
    assert.equal((await (await fetch(`${base}/api/events?teamId=${otherTeam.id}`)).json()).length, 1);
    assert.equal((await post('/api/station-reset', {
      teamId: team.id, stationId: 'invalid'
    })).status, 400);
    assert.equal((await post('/api/station-reset', {
      teamId: randomUUID(), stationId: 'cut-blister'
    })).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
