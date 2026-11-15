const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
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
    const event = { id: randomUUID(), teamId: team.id, stationId: 'cut-blister' };
    const responses = await Promise.all([
      post(base, '/api/events', event), post(base, '/api/events', event)
    ]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 201]);
    assert.equal((await post(base, '/api/events', { ...event, teamId: otherTeam.id })).status, 409);
    assert.equal((await post(base, '/api/events', { ...event, id: randomUUID(), stationId: 'invalid' })).status, 400);
    assert.equal((await post(base, '/api/events', { ...event, id: randomUUID(), teamId: randomUUID() })).status, 404);
    assert.equal((await (await fetch(`${base}/api/events?teamId=${otherTeam.id}`)).json()).length, 0);
    await close();
    base = await start();
    const events = await (await fetch(`${base}/api/events?teamId=${team.id}`)).json();
    assert.equal(events.length, 1);
    assert.equal(events[0].id, event.id);
    assert.equal(events[0].stationId, 'cut-blister');
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
    await post('/api/events', { id: randomUUID(), teamId: other.id, stationId: 'cut-blister' });
    const id = randomUUID();
    await post('/api/events', { id, teamId: team.id, stationId: 'cut-blister' });
    const message = new TextDecoder().decode((await reader.read()).value);
    assert.match(message, /event: completion/);
    assert.equal(JSON.parse(message.split('data: ')[1]).id, id);
    await reader.cancel();
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
