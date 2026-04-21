-- 0004_balance_trigger.sql — Keep orders.balance_due consistent
--
-- Runs on every INSERT and on UPDATE when quote_amount or deposit_received
-- changes. This makes balance_due a derived column; callers should treat it
-- as read-only.

CREATE OR REPLACE FUNCTION tg_compute_balance_due()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.balance_due := COALESCE(NEW.quote_amount, 0) - COALESCE(NEW.deposit_received, 0);
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_compute_balance_insert
BEFORE INSERT ON orders
FOR EACH ROW EXECUTE FUNCTION tg_compute_balance_due();

CREATE TRIGGER orders_compute_balance_update
BEFORE UPDATE OF quote_amount, deposit_received ON orders
FOR EACH ROW EXECUTE FUNCTION tg_compute_balance_due();
