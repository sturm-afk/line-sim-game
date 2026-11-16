# Vercel deployment

The Vercel-specific player and scoreboard use `/api/vercel/...` serverless functions and Supabase Postgres. Vercel uses the `other` framework preset to serve `public/index.html` at `/` and rewrites `/scoreboard` to `public/scoreboard.html`. The standalone SQLite server lives in `standalone/app.cjs` and serves `public/original_index.html` and `public/original_scoreboard.html` locally.

## Import and configure

1. Create a Supabase project and a Vercel account.
2. In Vercel, select **Add New → Project**, import this GitHub repository, and keep the repository root as the project root. Vercel detects `vercel.json`, the static `public/` files, and the function in `api/vercel/[...path].js`.
3. In the Supabase SQL Editor, run the complete `migrations/001_vercel.sql` file once. It is repeatable and creates the Vercel-only tables, indexes, access controls, initial 15-minute timer, and RPC used by the functions. No local SQLite file or data migration is needed; the standalone app has its own independent database.
4. In Vercel project **Settings → Environment Variables**, set the following for the environments where the deployment will be used:

   | Variable | Value |
   | --- | --- |
   | `SUPABASE_URL` | Supabase project URL, such as `https://<project-ref>.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase server-side `service_role` secret key; never expose it in a `NEXT_PUBLIC_*` or `VITE_*` variable |

4. Redeploy after setting environment variables. Open `/` and `/scoreboard` on the deployment to verify the pages and configured database. These steps describe deployment setup; they do not imply that a deployment has been run or verified.

The Supabase service-role key is used only by the serverless function. Keep it out of source control and browser-visible environment variables. The SQL migration enables row-level security and grants table access only to the backend role; the exposed RPC is likewise executable only by `service_role`. Scoreboard facilitator controls currently have no authentication; anyone who can access the deployment can use them. Deploy only in a trusted environment. Authentication may be added in a future release. The player page has no destructive controls.

## Vercel API and behavior

The Vercel pages call only `/api/vercel/...`; they do not call the standalone API or depend on a persistent Node process. The scoreboard refreshes through bounded polling (3 seconds, backing off to 30 seconds after failures) and displays connection/retry state. Teams, completions, QC outcomes, and timer state are stored in Supabase across function invocations.

The database RPC validates team names, UUIDs, station IDs, QC results, timer durations, and undo requests. It uses unique constraints and transactions for case-insensitive team joins and idempotent event IDs; new completions require a running, unexpired timer. Undo remains available after the timer stops. Station reset removes only that team's events at the selected station; a round reset clears events but keeps teams and the timer; a game reset deletes events and teams and restores a stopped 15-minute timer. API, validation, and database errors are returned to the pages as readable status messages.

To apply a future schema change, add an ordered SQL file under `migrations/` and run it against the same Supabase project before deploying code that depends on it. Do not copy the Vercel tables into the standalone SQLite database.
