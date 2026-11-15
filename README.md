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

The station screen supports all listed stations. A player can choose a team and station; these selections and a player ID are saved on the device. Standard completions are recorded for that player. At either QC station, players record a pass or fail and see the team's separate totals for that station. The scoreboard shows a shared countdown and live team totals; it does not enforce the timer or determine winners.

## Run the station

Install Node.js 22.13 or newer, then run `npm start`. Open `http://localhost:3000` in a browser, choose or enter a team name, select a station, and record each station task. At either QC station, tap **Pass** or **Fail**. A confirmation means the event was recorded; if saving cannot be confirmed, retry the same action before continuing. Team names are shared and case-insensitive.

For players on iPhones, run the server on a computer reachable on the same network and open `http://<computer-address>:3000` on each phone. Join the same team by name or share the team-specific page address (for example via a QR code). The server must remain running. SQLite data is stored in `data/` by default; set `DATA_DIR` to use another persistent directory and `PORT` to change the port. This standalone server is not yet a Vercel deployment; its database must reside on persistent storage.

## Scoreboard

Open `http://<computer-address>:3000/scoreboard` on a shared screen. Enter a duration in seconds and select **Start / restart** to start a shared countdown; stations accept completions only while the timer is running and above zero. **Reset timer** stops the game and returns the countdown to its last duration. **Reset game** deletes all teams and completions, restores the timer to 15 minutes, and leaves the game inactive; this action requires confirmation. The timer survives a server restart. Every team and station is shown, including zero totals. QC cells show the total inspections and separate pass/fail counts. Team creation, completions, station resets, timer changes, and full-game resets update connected scoreboards live.

## Event integration

`GET /api/stations` lists the station types; `POST /api/teams` with `{"name":"Team A"}` creates or joins a team, and `GET /api/teams` lists teams. `POST /api/events` records a completion with `{"id":"<UUID v4>","playerId":"<player UUID v4>","teamId":"<team id>","stationId":"cut-blister"}`. Completions are rejected unless the shared timer is running and above zero. QC station events must also include `"result":"pass"` or `"result":"fail"`. Reusing the same event ID and completion details returns the existing event instead of counting it twice. `GET /api/completions?playerId=<player UUID v4>&stationId=<station id>` returns that player's completion count for the station across teams. `GET /api/qc-counts?teamId=<team id>&stationId=<QC station id>` returns the team's pass and fail totals for that station. `GET /api/events?teamId=<team id>` returns a team's recorded events, including player IDs and QC results. `GET /api/scoreboard` returns all teams, stations, aggregate counts and the shared timer. Start the timer with `POST /api/timer` and `{"durationSeconds":900}`, reset it with `POST /api/timer/reset`, or clear the entire game with `POST /api/game/reset`. `GET /api/events/stream` publishes server-sent `completion`, `reset`, and `game-reset` events; optionally filter with `?teamId=<team id>`. Unfiltered streams also receive `team` and `timer` events. The stream delivers new events only, so use the snapshot or events endpoint for history. There is no authentication or access control yet; use only on a trusted network.

Run the focused checks with `npm test`.
