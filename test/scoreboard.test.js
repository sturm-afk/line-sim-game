const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createApp } = require('../server');

test('scoreboard snapshots and live updates include all teams, stations and the shared timer', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'line-sim-scoreboard-'));
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
  const post = (base, route, data) => fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
  try {
    let base = await start();
    assert.equal((await fetch(base + '/scoreboard')).status, 200);
    const stream = await fetch(base + '/api/events/stream');
    const reader = stream.body.getReader();
    await reader.read();
    const next = async type => {
      const message = new TextDecoder().decode((await reader.read()).value);
      assert.match(message, new RegExp(`event: ${type}`));
      return JSON.parse(message.split('data: ')[1]);
    };
    const team = await (await post(base, '/api/teams', { name: 'Team A' })).json();
    assert.equal((await next('team')).id, team.id);
    const other = await (await post(base, '/api/teams', { name: 'Team B' })).json();
    await next('team');
    const event = { id: randomUUID(), playerId: randomUUID(), teamId: team.id, stationId: 'inspect-box', result: 'pass' };
    assert.equal((await post(base, '/api/events', event)).status, 409);
    assert.equal((await post(base, '/api/timer', { durationSeconds: 900 })).status, 200);
    await next('timer');
    assert.equal((await post(base, '/api/events', event)).status, 201);
    await next('completion');
    await post(base, '/api/events', event);
    await post(base, '/api/events', { ...event, id: randomUUID(), result: 'fail' });
    await next('completion');
    await post(base, '/api/events', { ...event, id: randomUUID(), stationId: 'cut-box', result: undefined });
    await next('completion');
    let snapshot = await (await fetch(base + '/api/scoreboard')).json();
    assert.equal(snapshot.stations.length, 8);
    assert.deepEqual(snapshot.teams.map(item => item.id), [team.id, other.id]);
    assert.deepEqual(snapshot.counts.find(item => item.stationId === 'inspect-box'), {
      teamId: team.id, stationId: 'inspect-box', count: 2, pass: 1, fail: 1
    });
    assert.equal(snapshot.counts.find(item => item.stationId === 'cut-box').count, 1);
    assert.equal(snapshot.counts.some(item => item.teamId === other.id), false);
    assert.equal(snapshot.timer.durationSeconds, 900);
    assert.ok(snapshot.timer.endsAt > snapshot.serverTime);
    for (const durationSeconds of [0, -1, 86401, 1.5, '5']) {
      assert.equal((await post(base, '/api/timer', { durationSeconds })).status, 400);
    }
    assert.equal((await post(base, '/api/timer', { durationSeconds: 60 })).status, 200);
    await next('timer');
    snapshot = await (await fetch(base + '/api/scoreboard')).json();
    assert.equal(snapshot.timer.durationSeconds, 60);
    assert.ok(snapshot.timer.endsAt > snapshot.serverTime);
    const endsAt = snapshot.timer.endsAt;
    await post(base, '/api/station-reset', { teamId: team.id, stationId: 'inspect-box' });
    await next('reset');
    snapshot = await (await fetch(base + '/api/scoreboard')).json();
    assert.equal(snapshot.counts.some(item => item.stationId === 'inspect-box'), false);
    await reader.cancel();
    await close();
    base = await start();
    snapshot = await (await fetch(base + '/api/scoreboard')).json();
    assert.equal(snapshot.timer.endsAt, endsAt);
    assert.equal(snapshot.counts[0].count, 1);
    assert.equal((await post(base, '/api/timer/reset', {})).status, 200);
    snapshot = await (await fetch(base + '/api/scoreboard')).json();
    assert.deepEqual(snapshot.timer, { durationSeconds: 60, endsAt: null, remainingSeconds: null });
  } finally {
    if (server?.listening) await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reset game deletes teams and completions, stops the timer and notifies connected screens', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'line-sim-game-reset-'));
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
  const post = (base, route, data = {}) => fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
  try {
    const base = await start();
    const stream = await fetch(base + '/api/events/stream');
    const reader = stream.body.getReader();
    await reader.read();
    const next = async type => {
      const message = new TextDecoder().decode((await reader.read()).value);
      assert.match(message, new RegExp(`event: ${type}`));
      return JSON.parse(message.split('data: ')[1]);
    };
    const team = await (await post(base, '/api/teams', { name: 'Reset me' })).json();
    await next('team');
    await post(base, '/api/timer', { durationSeconds: 60 });
    await next('timer');
    await post(base, '/api/events', {
      id: randomUUID(), playerId: randomUUID(), teamId: team.id, stationId: 'cut-blister'
    });
    await next('completion');

    assert.equal((await post(base, '/api/game/reset')).status, 200);
    await next('game-reset');
    const snapshot = await (await fetch(base + '/api/scoreboard')).json();
    assert.deepEqual(snapshot.teams, []);
    assert.deepEqual(snapshot.counts, []);
    assert.deepEqual(snapshot.timer, { durationSeconds: 900, endsAt: null, remainingSeconds: null });
    assert.equal((await fetch(`${base}/api/events?teamId=${team.id}`)).status, 404);
    await reader.cancel();
  } finally {
    if (server?.listening) await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('timer stops and resumes, and a new round clears counts without deleting teams', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'line-sim-new-round-'));
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
  const post = (base, route, data = {}) => fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
  try {
    const base = await start();
    const team = await (await post(base, '/api/teams', { name: 'Keep this team' })).json();
    await post(base, '/api/timer', { durationSeconds: 60 });
    const stream = await fetch(base + '/api/events/stream');
    const reader = stream.body.getReader();
    await reader.read();
    const event = { id: randomUUID(), playerId: randomUUID(), teamId: team.id, stationId: 'cut-blister' };
    assert.equal((await post(base, '/api/events', event)).status, 201);

    assert.equal((await post(base, '/api/timer/stop')).status, 200);
    let snapshot = await (await fetch(base + '/api/scoreboard')).json();
    assert.equal(snapshot.timer.endsAt, null);
    assert.ok(snapshot.timer.remainingSeconds > 0 && snapshot.timer.remainingSeconds <= 60);
    assert.equal((await post(base, '/api/events', {
      ...event, id: randomUUID()
    })).status, 409);

    assert.equal((await post(base, '/api/timer/resume')).status, 200);
    snapshot = await (await fetch(base + '/api/scoreboard')).json();
    assert.ok(snapshot.timer.endsAt > snapshot.serverTime);
    assert.equal(snapshot.timer.remainingSeconds, null);

    assert.equal((await post(base, '/api/round/reset')).status, 200);
    let notification = '';
    while (!notification.includes('event: round-reset')) {
      notification += new TextDecoder().decode((await reader.read()).value);
    }
    assert.match(notification, /event: round-reset/);
    snapshot = await (await fetch(base + '/api/scoreboard')).json();
    assert.deepEqual(snapshot.teams.map(item => item.id), [team.id]);
    assert.deepEqual(snapshot.counts, []);
    assert.ok(snapshot.timer.endsAt > snapshot.serverTime);
    await reader.cancel();
  } finally {
    if (server?.listening) await close();
    rmSync(dir, { recursive: true, force: true });
  }
});
