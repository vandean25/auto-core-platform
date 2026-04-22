\set ON_ERROR_STOP on

-- Basic PostgreSQL connection pressure checks
SHOW max_connections;

SELECT
  datname,
  state,
  count(*) AS connection_count
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY datname, state
ORDER BY state;

SELECT
  wait_event_type,
  wait_event,
  count(*) AS waiting_sessions
FROM pg_stat_activity
WHERE datname = current_database()
  AND wait_event IS NOT NULL
GROUP BY wait_event_type, wait_event
ORDER BY waiting_sessions DESC;

-- Long-running active queries (potential queueing symptom)
SELECT
  pid,
  usename,
  application_name,
  state,
  now() - query_start AS runtime,
  left(query, 160) AS query_preview
FROM pg_stat_activity
WHERE datname = current_database()
  AND state = 'active'
  AND now() - query_start > interval '15 seconds'
ORDER BY runtime DESC;

-- Optional (run against PgBouncer admin database, not PostgreSQL):
-- SHOW CONFIG;
-- SHOW POOLS;
-- SHOW STATS;
