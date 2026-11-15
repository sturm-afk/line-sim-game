const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
const { mkdirSync, readFileSync } = require('node:fs');
const path = require('node:path');

const stations = [
  { id: 'cut-blister', name: 'Cut blister pack' },
  { id: 'affix-pills', name: 'Affix pills onto blister pack' },
  { id: 'cut-box', name: 'Cut product box' },
  { id: 'inspect-blister', name: 'Inspect/QC blister pack (in-process)' },
  { id: 'insert-blister', name: 'Insert blister pack into product box' },
  { id: 'seal-box', name: 'Seal product box and affix batch number' },
  { id: 'inspect-box', name: 'Inspect/QC product box (post process ready to ship)' },
  { id: 'ship-box', name: 'Ship product box' }
];
const qcStationIds = new Set(['inspect-blister', 'inspect-box']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createApp(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'line-sim.sqlite'));
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id),
      player_id TEXT, station_id TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_team ON events(team_id);
  `);
  if (!db.prepare('PRAGMA table_info(events)').all().some(column => column.name === 'player_id')) {
    db.exec('ALTER TABLE events ADD COLUMN player_id TEXT');
  }
  if (!db.prepare('PRAGMA table_info(events)').all().some(column => column.name === 'result')) {
    db.exec('ALTER TABLE events ADD COLUMN result TEXT');
  }
  const subscribers = new Set();
  const page = readFileSync(path.join(__dirname, 'public', 'index.html'));

  function json(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  }

  async function body(req) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
      throw new Error('Invalid content type');
    }
    let data = '';
    for await (const chunk of req) {
      data += chunk;
      if (data.length > 4096) throw new Error('Request too large');
    }
    return JSON.parse(data);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(page);
      }
      if (req.method === 'GET' && url.pathname === '/api/stations') return json(res, 200, stations);
      if (req.method === 'GET' && url.pathname === '/api/teams') {
        return json(res, 200, db.prepare('SELECT id, name FROM teams ORDER BY name').all());
      }
      if (req.method === 'GET' && url.pathname === '/api/completions') {
        const playerId = url.searchParams.get('playerId');
        const stationId = url.searchParams.get('stationId');
        if (!playerId || !uuid.test(playerId) || !stations.some(station => station.id === stationId)) {
          return json(res, 400, { error: 'A valid player and station are required.' });
        }
        const { count } = db.prepare(
          'SELECT COUNT(*) AS count FROM events WHERE player_id = ? AND station_id = ?'
        ).get(playerId, stationId);
        return json(res, 200, { count });
      }
      if (req.method === 'GET' && url.pathname === '/api/qc-counts') {
        const teamId = url.searchParams.get('teamId');
        const stationId = url.searchParams.get('stationId');
        if (!teamId || !db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId)) {
          return json(res, 404, { error: 'Team not found.' });
        }
        if (!qcStationIds.has(stationId)) {
          return json(res, 400, { error: 'A QC station is required.' });
        }
        const counts = db.prepare(
          'SELECT result, COUNT(*) AS count FROM events WHERE team_id = ? AND station_id = ? GROUP BY result'
        ).all(teamId, stationId);
        return json(res, 200, {
          pass: counts.find(item => item.result === 'pass')?.count || 0,
          fail: counts.find(item => item.result === 'fail')?.count || 0
        });
      }
      if (req.method === 'POST' && url.pathname === '/api/teams') {
        const input = await body(req);
        const name = typeof input?.name === 'string' ? input.name.trim() : '';
        if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) {
          return json(res, 400, { error: 'Enter a team name of 1–80 characters.' });
        }
        db.prepare('INSERT OR IGNORE INTO teams (id, name) VALUES (?, ?)').run(randomUUID(), name);
        return json(res, 200, db.prepare('SELECT id, name FROM teams WHERE name = ? COLLATE NOCASE').get(name));
      }
      if (req.method === 'GET' && url.pathname === '/api/events/stream') {
        const teamId = url.searchParams.get('teamId');
        if (teamId && !db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId)) {
          return json(res, 404, { error: 'Team not found.' });
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        res.write(': connected\n\n');
        const subscriber = { res, teamId };
        subscribers.add(subscriber);
        req.on('close', () => subscribers.delete(subscriber));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        const teamId = url.searchParams.get('teamId');
        if (!teamId || !db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId)) {
          return json(res, 404, { error: 'Team not found.' });
        }
        return json(res, 200, db.prepare(
          'SELECT id, team_id AS teamId, player_id AS playerId, station_id AS stationId, result, created_at AS createdAt FROM events WHERE team_id = ? ORDER BY rowid'
        ).all(teamId));
      }
      if (req.method === 'POST' && url.pathname === '/api/events') {
        const input = await body(req);
        if (!input || typeof input.id !== 'string' || !uuid.test(input.id) ||
            typeof input.teamId !== 'string' || typeof input.playerId !== 'string' || !uuid.test(input.playerId) ||
            !stations.some(station => station.id === input.stationId)) {
          return json(res, 400, { error: 'A valid event ID, player, team and station are required.' });
        }
        if ((qcStationIds.has(input.stationId) && !['pass', 'fail'].includes(input.result)) ||
            (!qcStationIds.has(input.stationId) && input.result !== undefined)) {
          return json(res, 400, { error: 'QC events require a pass or fail result.' });
        }
        if (!db.prepare('SELECT id FROM teams WHERE id = ?').get(input.teamId)) {
          return json(res, 404, { error: 'Team not found.' });
        }
        const existing = db.prepare(
          'SELECT id, team_id AS teamId, player_id AS playerId, station_id AS stationId, result, created_at AS createdAt FROM events WHERE id = ?'
        ).get(input.id);
        if (existing) {
          if (existing.teamId !== input.teamId || existing.playerId !== input.playerId ||
              existing.stationId !== input.stationId || existing.result !== (input.result || null)) {
            return json(res, 409, { error: 'Event ID already belongs to another completion.' });
          }
          return json(res, 200, existing);
        }
        const event = {
          id: input.id, teamId: input.teamId, playerId: input.playerId,
          stationId: input.stationId, result: input.result || null, createdAt: new Date().toISOString()
        };
        db.prepare('INSERT INTO events (id, team_id, player_id, station_id, result, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(event.id, event.teamId, event.playerId, event.stationId, event.result, event.createdAt);
        for (const subscriber of subscribers) {
          if (!subscriber.teamId || subscriber.teamId === event.teamId) {
            subscriber.res.write(`event: completion\ndata: ${JSON.stringify(event)}\n\n`);
          }
        }
        return json(res, 201, event);
      }
      json(res, 404, { error: 'Not found.' });
    } catch (error) {
      if (error instanceof SyntaxError || error.message === 'Request too large' || error.message === 'Invalid content type') {
        return json(res, 400, { error: 'Invalid request body.' });
      }
      console.error(error);
      if (!res.headersSent) json(res, 500, { error: 'Unable to process request.' });
      else res.end();
    }
  });
  server.on('close', () => db.close());
  return server;
}

if (require.main === module) {
  const server = createApp(process.env.DATA_DIR || path.join(__dirname, 'data'));
  server.listen(process.env.PORT || 3000, '0.0.0.0', () => {
    console.log(`Line Sim Game listening on port ${server.address().port}`);
  });
}

module.exports = { createApp };
