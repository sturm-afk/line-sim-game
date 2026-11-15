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

This repository is at the planning stage. No gameplay UI or simulator behavior has been built yet.
