-- 0008_rename_qc_stage.sql
--
-- Rename the 'qc' stage to 'ready_for_install'. Shop operators don't think
-- in "quality control" — between fabrication and installation the real
-- stage is "Ready for Installation": pieces cut, polished, wrapped, staged
-- for pickup or loaded on the truck.
--
-- Implementation note: our stages are a Postgres ENUM (see 0001_init.sql),
-- not a CHECK constraint on text. ALTER TYPE … RENAME VALUE is supported
-- since PG 10 and is the correct surgical operation — it keeps every
-- existing orders.stage and order_stage_history.{from,to}_stage row in
-- place; the stored values simply read as the new name afterwards.

BEGIN;

ALTER TYPE order_stage RENAME VALUE 'qc' TO 'ready_for_install';

COMMIT;
