-- psql -X -v ON_ERROR_STOP=1 -f deploy/postgres/import-perf-network.sql < networks.csv
-- Input is UTF-8 CSV with header prefix,country,region,city,isp.
BEGIN;
CREATE TEMP TABLE staging_network (LIKE perf_network INCLUDING ALL) ON COMMIT DROP;
\copy staging_network FROM PSTDIN WITH (FORMAT csv, HEADER true)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM staging_network) THEN
    RAISE EXCEPTION 'Empty telemetry network catalog';
  END IF;
END $$;
DELETE FROM perf_network;
INSERT INTO perf_network SELECT * FROM staging_network;
ANALYZE perf_network;
COMMIT;
