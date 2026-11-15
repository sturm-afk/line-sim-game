CREATE TABLE IF NOT EXISTS public.vercel_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_key text GENERATED ALWAYS AS (lower(name)) STORED UNIQUE
);

CREATE TABLE IF NOT EXISTS public.vercel_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  id uuid PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES public.vercel_teams(id) ON DELETE CASCADE,
  player_id uuid,
  station_id text NOT NULL,
  result text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS vercel_events_team ON public.vercel_events(team_id);
CREATE INDEX IF NOT EXISTS vercel_events_player_station
  ON public.vercel_events(player_id, station_id, team_id);

CREATE TABLE IF NOT EXISTS public.vercel_timer (
  id smallint PRIMARY KEY CHECK (id = 1),
  duration_seconds integer NOT NULL,
  ends_at bigint,
  remaining_seconds integer
);
INSERT INTO public.vercel_timer (id, duration_seconds, ends_at, remaining_seconds)
VALUES (1, 900, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.vercel_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vercel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vercel_timer ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vercel_teams, public.vercel_events, public.vercel_timer FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.vercel_teams, public.vercel_events, public.vercel_timer TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.vercel_events_sequence_seq TO service_role;

CREATE OR REPLACE FUNCTION public.vercel_api(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_result jsonb;
  v_name text;
  v_team_id uuid;
  v_player_id uuid;
  v_event_id uuid;
  v_station text;
  v_result_value text;
  v_existing public.vercel_events%ROWTYPE;
  v_timer public.vercel_timer%ROWTYPE;
  v_count integer;
  v_ends_at bigint;
  v_remaining integer;
  v_deleted integer;
  v_now bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  v_stations jsonb := '[
    {"id":"cut-blister","name":"Cut blister pack"},
    {"id":"affix-pills","name":"Attach pills to blister"},
    {"id":"cut-box","name":"Cut product box"},
    {"id":"inspect-blister","name":"Inspect blister pack"},
    {"id":"insert-blister","name":"Insert blister into box"},
    {"id":"seal-box","name":"Seal and label box"},
    {"id":"inspect-box","name":"Inspect box for shipping"},
    {"id":"ship-box","name":"Ship box"}
  ]'::jsonb;
BEGIN
  IF p_action = 'teams' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name), '[]'::jsonb)
      INTO v_result FROM public.vercel_teams;
    RETURN jsonb_build_object('httpStatus', 200, 'teams', v_result);
  ELSIF p_action = 'team-create' THEN
    v_name := btrim(p_payload->>'name');
    IF v_name IS NULL OR v_name = '' OR length(v_name) > 80 OR v_name ~ '[[:cntrl:]]' THEN
      RETURN jsonb_build_object('httpStatus', 400, 'error', 'Enter a team name of 1–80 characters.');
    END IF;
    INSERT INTO public.vercel_teams (name) VALUES (v_name) ON CONFLICT (name_key) DO NOTHING;
    SELECT id, name INTO v_team_id, v_name FROM public.vercel_teams WHERE name_key = lower(v_name);
    RETURN jsonb_build_object('httpStatus', 200, 'id', v_team_id, 'name', v_name);
  ELSIF p_action = 'scoreboard' THEN
    SELECT * INTO v_timer FROM public.vercel_timer WHERE id = 1;
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name), '[]'::jsonb)
      INTO v_result FROM public.vercel_teams;
    RETURN jsonb_build_object(
      'httpStatus', 200,
      'stations', v_stations,
      'teams', v_result,
      'counts', coalesce((
        SELECT jsonb_agg(count_row)
        FROM (
          SELECT jsonb_build_object(
            'teamId', team_id, 'stationId', station_id, 'count', count(*),
            'pass', count(*) FILTER (WHERE result = 'pass'),
            'fail', count(*) FILTER (WHERE result = 'fail')
          ) AS count_row
          FROM public.vercel_events GROUP BY team_id, station_id ORDER BY team_id, station_id
        ) counts_by_team
      ), '[]'::jsonb),
      'timer', jsonb_build_object(
        'durationSeconds', v_timer.duration_seconds,
        'endsAt', v_timer.ends_at,
        'remainingSeconds', v_timer.remaining_seconds
      ),
      'serverTime', v_now
    );
  ELSIF p_action = 'completions' THEN
    IF coalesce(p_payload->>'playerId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_stations) s WHERE s->>'id' = p_payload->>'stationId') THEN
      RETURN jsonb_build_object('httpStatus', 400, 'error', 'A valid player and station are required.');
    END IF;
    v_player_id := (p_payload->>'playerId')::uuid;
    v_station := p_payload->>'stationId';
    IF p_payload ? 'teamId' THEN
      IF coalesce(p_payload->>'teamId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR NOT EXISTS (SELECT 1 FROM public.vercel_teams WHERE id = (p_payload->>'teamId')::uuid) THEN
        RETURN jsonb_build_object('httpStatus', 404, 'error', 'Team not found.');
      END IF;
      v_team_id := (p_payload->>'teamId')::uuid;
      SELECT count(*), (array_agg(id ORDER BY sequence DESC))[1]
        INTO v_count, v_event_id FROM public.vercel_events
        WHERE player_id = v_player_id AND station_id = v_station AND team_id = v_team_id;
      RETURN jsonb_build_object('httpStatus', 200, 'count', v_count, 'lastEventId', v_event_id);
    END IF;
    SELECT count(*) INTO v_count FROM public.vercel_events
      WHERE player_id = v_player_id AND station_id = v_station;
    RETURN jsonb_build_object('httpStatus', 200, 'count', v_count);
  ELSIF p_action = 'qc-counts' THEN
    IF coalesce(p_payload->>'teamId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR NOT EXISTS (SELECT 1 FROM public.vercel_teams WHERE id = (p_payload->>'teamId')::uuid) THEN
      RETURN jsonb_build_object('httpStatus', 404, 'error', 'Team not found.');
    END IF;
    IF p_payload->>'stationId' NOT IN ('inspect-blister', 'inspect-box') THEN
      RETURN jsonb_build_object('httpStatus', 400, 'error', 'A QC station is required.');
    END IF;
    SELECT count(*) FILTER (WHERE result = 'pass'), count(*) FILTER (WHERE result = 'fail')
      INTO v_count, v_deleted FROM public.vercel_events
      WHERE team_id = (p_payload->>'teamId')::uuid AND station_id = p_payload->>'stationId';
    RETURN jsonb_build_object('httpStatus', 200, 'pass', v_count, 'fail', v_deleted);
  ELSIF p_action = 'events' THEN
    IF coalesce(p_payload->>'teamId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR NOT EXISTS (SELECT 1 FROM public.vercel_teams WHERE id = (p_payload->>'teamId')::uuid) THEN
      RETURN jsonb_build_object('httpStatus', 404, 'error', 'Team not found.');
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'teamId', team_id, 'playerId', player_id, 'stationId', station_id,
      'result', result, 'createdAt', created_at
    ) ORDER BY sequence), '[]'::jsonb)
      INTO v_result FROM public.vercel_events WHERE team_id = (p_payload->>'teamId')::uuid;
    RETURN jsonb_build_object('httpStatus', 200, 'events', v_result);
  ELSIF p_action = 'event-create' THEN
    IF coalesce(p_payload->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR coalesce(p_payload->>'playerId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR coalesce(p_payload->>'teamId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_stations) s WHERE s->>'id' = p_payload->>'stationId') THEN
      RETURN jsonb_build_object('httpStatus', 400, 'error', 'A valid event ID, player, team and station are required.');
    END IF;
    v_event_id := (p_payload->>'id')::uuid;
    v_team_id := (p_payload->>'teamId')::uuid;
    v_player_id := (p_payload->>'playerId')::uuid;
    v_station := p_payload->>'stationId';
    v_result_value := p_payload->>'result';
    IF (v_station IN ('inspect-blister', 'inspect-box') AND
        (v_result_value IS NULL OR v_result_value NOT IN ('pass', 'fail')))
      OR (v_station NOT IN ('inspect-blister', 'inspect-box') AND p_payload ? 'result') THEN
      RETURN jsonb_build_object('httpStatus', 400, 'error', 'QC events require a pass or fail result.');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.vercel_teams WHERE id = v_team_id) THEN
      RETURN jsonb_build_object('httpStatus', 404, 'error', 'Team not found.');
    END IF;
    SELECT * INTO v_existing FROM public.vercel_events WHERE id = v_event_id;
    IF FOUND THEN
      IF v_existing.team_id <> v_team_id OR v_existing.player_id IS DISTINCT FROM v_player_id
        OR v_existing.station_id <> v_station OR v_existing.result IS DISTINCT FROM v_result_value THEN
        RETURN jsonb_build_object('httpStatus', 409, 'error', 'Event ID already belongs to another completion.');
      END IF;
      RETURN jsonb_build_object('httpStatus', 200, 'id', v_existing.id, 'teamId', v_existing.team_id,
        'playerId', v_existing.player_id, 'stationId', v_existing.station_id, 'result', v_existing.result,
        'createdAt', v_existing.created_at);
    END IF;
    SELECT * INTO v_timer FROM public.vercel_timer WHERE id = 1 FOR UPDATE;
    IF v_timer.ends_at IS NULL OR v_timer.ends_at <= v_now THEN
      RETURN jsonb_build_object('httpStatus', 409, 'error', 'The game is not active.');
    END IF;
    INSERT INTO public.vercel_events (id, team_id, player_id, station_id, result)
      VALUES (v_event_id, v_team_id, v_player_id, v_station, v_result_value)
      ON CONFLICT (id) DO NOTHING;
    IF NOT FOUND THEN
      SELECT * INTO v_existing FROM public.vercel_events WHERE id = v_event_id;
      IF v_existing.team_id <> v_team_id OR v_existing.player_id IS DISTINCT FROM v_player_id
        OR v_existing.station_id <> v_station OR v_existing.result IS DISTINCT FROM v_result_value THEN
        RETURN jsonb_build_object('httpStatus', 409, 'error', 'Event ID already belongs to another completion.');
      END IF;
      RETURN jsonb_build_object('httpStatus', 200, 'id', v_existing.id, 'teamId', v_existing.team_id,
        'playerId', v_existing.player_id, 'stationId', v_existing.station_id, 'result', v_existing.result,
        'createdAt', v_existing.created_at);
    END IF;
    SELECT * INTO v_existing FROM public.vercel_events WHERE id = v_event_id;
    RETURN jsonb_build_object('httpStatus', 201, 'id', v_existing.id, 'teamId', v_existing.team_id,
      'playerId', v_existing.player_id, 'stationId', v_existing.station_id, 'result', v_existing.result,
      'createdAt', v_existing.created_at);
  ELSIF p_action = 'completion-undo' THEN
    IF coalesce(p_payload->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR coalesce(p_payload->>'playerId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR coalesce(p_payload->>'teamId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_stations) s WHERE s->>'id' = p_payload->>'stationId')
      OR p_payload->>'stationId' IN ('inspect-blister', 'inspect-box') THEN
      RETURN jsonb_build_object('httpStatus', 400, 'error', 'A valid completion, player, team and standard station are required.');
    END IF;
    SELECT * INTO v_existing FROM public.vercel_events WHERE id = (p_payload->>'id')::uuid;
    IF FOUND AND (v_existing.team_id <> (p_payload->>'teamId')::uuid
      OR v_existing.player_id <> (p_payload->>'playerId')::uuid
      OR v_existing.station_id <> p_payload->>'stationId') THEN
      RETURN jsonb_build_object('httpStatus', 409, 'error', 'Completion does not match the player, team and station.');
    END IF;
    IF FOUND THEN
      DELETE FROM public.vercel_events WHERE id = v_existing.id;
    END IF;
    RETURN jsonb_build_object('httpStatus', 200, 'ok', true);
  ELSIF p_action = 'station-reset' THEN
    IF coalesce(p_payload->>'teamId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR NOT EXISTS (SELECT 1 FROM public.vercel_teams WHERE id = (p_payload->>'teamId')::uuid) THEN
      RETURN jsonb_build_object('httpStatus', 404, 'error', 'Team not found.');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_stations) s WHERE s->>'id' = p_payload->>'stationId') THEN
      RETURN jsonb_build_object('httpStatus', 400, 'error', 'A valid station is required.');
    END IF;
    DELETE FROM public.vercel_events WHERE team_id = (p_payload->>'teamId')::uuid AND station_id = p_payload->>'stationId';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN jsonb_build_object('httpStatus', 200, 'deleted', v_deleted);
  ELSIF p_action = 'timer-start' THEN
    IF coalesce(jsonb_typeof(p_payload->'durationSeconds') <> 'number', true)
      OR coalesce((p_payload->>'durationSeconds') !~ '^[0-9]{1,5}$', true)
      OR (p_payload->>'durationSeconds')::integer NOT BETWEEN 1 AND 86400 THEN
      RETURN jsonb_build_object('httpStatus', 400, 'error', 'Duration must be between 1 and 86400 seconds.');
    END IF;
    UPDATE public.vercel_timer SET duration_seconds = (p_payload->>'durationSeconds')::integer,
      ends_at = v_now + (p_payload->>'durationSeconds')::integer * 1000, remaining_seconds = NULL WHERE id = 1;
    RETURN jsonb_build_object('httpStatus', 200, 'ok', true);
  ELSIF p_action = 'timer-stop' THEN
    SELECT * INTO v_timer FROM public.vercel_timer WHERE id = 1 FOR UPDATE;
    v_remaining := CASE WHEN v_timer.ends_at IS NULL THEN NULL
      ELSE greatest(0, ceil((v_timer.ends_at - v_now)::numeric / 1000)::integer) END;
    UPDATE public.vercel_timer SET ends_at = NULL, remaining_seconds = v_remaining WHERE id = 1;
    RETURN jsonb_build_object('httpStatus', 200, 'ok', true);
  ELSIF p_action = 'timer-resume' THEN
    SELECT * INTO v_timer FROM public.vercel_timer WHERE id = 1 FOR UPDATE;
    IF v_timer.remaining_seconds IS NULL OR v_timer.remaining_seconds < 1 THEN
      RETURN jsonb_build_object('httpStatus', 409, 'error', 'There is no stopped timer to resume.');
    END IF;
    UPDATE public.vercel_timer SET ends_at = v_now + remaining_seconds * 1000,
      remaining_seconds = NULL WHERE id = 1;
    RETURN jsonb_build_object('httpStatus', 200, 'ok', true);
  ELSIF p_action = 'timer-reset' THEN
    UPDATE public.vercel_timer SET ends_at = NULL, remaining_seconds = NULL WHERE id = 1;
    RETURN jsonb_build_object('httpStatus', 200, 'ok', true);
  ELSIF p_action = 'round-reset' THEN
    DELETE FROM public.vercel_events;
    RETURN jsonb_build_object('httpStatus', 200, 'ok', true);
  ELSIF p_action = 'game-reset' THEN
    DELETE FROM public.vercel_events;
    DELETE FROM public.vercel_teams;
    UPDATE public.vercel_timer SET duration_seconds = 900, ends_at = NULL, remaining_seconds = NULL WHERE id = 1;
    RETURN jsonb_build_object('httpStatus', 200, 'ok', true);
  END IF;
  RETURN jsonb_build_object('httpStatus', 404, 'error', 'Not found.');
END;
$$;

REVOKE ALL ON FUNCTION public.vercel_api(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vercel_api(text, jsonb) TO service_role;
