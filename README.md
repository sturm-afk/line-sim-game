# Line Sim Game

A team-building game that simulates a pharmaceutical manufacturing line using simple physical props. Teams race against a clock to make and package products, pass quality checks, and release as many shippable units as possible.

## Gameplay overview

Each player opens the app on their iPhone by scanning a QR code assigned to their team and station. Players complete the hands-on work in order, then tap the app to record each step:

1. Make the product from pill stickers.
2. Affix the pills to an index-card insert.
3. Make an envelope package.
4. Put the in-process-QC-passed insert into the envelope.
5. Seal the package and label it with the batch number.
6. Submit the finished package for final QC release.

The app tracks progress through the line and counts products that successfully pass final QC. When the timed competition ends, teams compare their released-product totals.

All manufacturing activity is simulated with game props; the game does not make or handle real pharmaceutical products.

## Proposed milestones

Build and validate one user-facing slice at a time. The milestones below are a roadmap, not a description of functionality already implemented.

1. **Gameplay rules and roles** — Confirm station responsibilities, batch and product rules, QC pass/fail criteria, timing, and how the winning team is determined.
2. **Mobile entry and game setup** — Define the iPhone-first experience for scanning a team-and-station QR code, joining the correct game, and showing the player's role. Establish how a facilitator creates and starts a competition.
3. **Game and station status** — Give players a clear view of the timer, team, station, current work, and recorded progress, including useful waiting and error states.
4. **Production-line interactions** — Add the station-by-station taps that track product creation, insert preparation, packaging, and handoffs without losing the order of work.
5. **Batching and quality control** — Track batch labels and submit completed packages for final QC; apply the agreed release rules and count only released products as shippable.
6. **Competition results** — Show team totals and the final standings when a competition ends, using the agreed scoring and tie-break rules.
7. **Operational readiness** — Test the full game on phones and with multiple teams, address connectivity and recovery needs, and prepare the app for deployment on Vercel.

## Status

The station screen supports all listed stations. A player can choose a team and station; these selections and a player ID are saved on the device. Completions are recorded for that player, and the screen shows their completion count for the selected team. Game timing, QC rules, and scoring are not implemented yet.

## Run the station

Install Node.js 22.13 or newer, then run `npm start`. Open `http://localhost:3000` in a browser, choose or enter a team name, select a station, and tap **Complete** after each station task. A confirmation means the event was recorded; if saving cannot be confirmed, tap **Retry** before continuing. Team names are shared and case-insensitive.

For players on iPhones, run the server on a computer reachable on the same network and open `http://<computer-address>:3000` on each phone. Join the same team by name or share the team-specific page address (for example via a QR code). The server must remain running. SQLite data is stored in `data/` by default; set `DATA_DIR` to use another persistent directory and `PORT` to change the port. This standalone server is not yet a Vercel deployment; its database must reside on persistent storage.

## Event integration

`GET /api/stations` lists the station types; `POST /api/teams` with `{"name":"Team A"}` creates or joins a team, and `GET /api/teams` lists teams. `POST /api/events` records a completion with `{"id":"<UUID v4>","playerId":"<player UUID v4>","teamId":"<team id>","stationId":"cut-blister"}`. Reusing the same event ID for the same player, team, and station returns the existing event instead of counting it twice. `GET /api/events?teamId=<team id>` returns a team's recorded events, including player IDs. `GET /api/events/stream` publishes new completions as server-sent `completion` events; optionally filter with `?teamId=<team id>`. The stream delivers new events only, so use the events endpoint for history. There is no authentication or access control yet; use only on a trusted network.

Run the focused checks with `npm test`.
