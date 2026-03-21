-- Fix sequences for tables that may have lost their DEFAULT nextval after schema migration
DO $$
DECLARE
  seq_val integer;
BEGIN
  -- payments
  SELECT COALESCE(MAX(id), 0) + 1 INTO seq_val FROM payments;
  PERFORM setval(pg_get_serial_sequence('payments', 'id'), seq_val);

  -- orders
  SELECT COALESCE(MAX(id), 0) + 1 INTO seq_val FROM orders;
  PERFORM setval(pg_get_serial_sequence('orders', 'id'), seq_val);

  -- order_items
  SELECT COALESCE(MAX(id), 0) + 1 INTO seq_val FROM order_items;
  PERFORM setval(pg_get_serial_sequence('order_items', 'id'), seq_val);

  -- kitchen_tickets
  SELECT COALESCE(MAX(id), 0) + 1 INTO seq_val FROM kitchen_tickets;
  PERFORM setval(pg_get_serial_sequence('kitchen_tickets', 'id'), seq_val);

  -- kitchen_ticket_items
  SELECT COALESCE(MAX(id), 0) + 1 INTO seq_val FROM kitchen_ticket_items;
  PERFORM setval(pg_get_serial_sequence('kitchen_ticket_items', 'id'), seq_val);

  -- order_item_taxes
  SELECT COALESCE(MAX(id), 0) + 1 INTO seq_val FROM order_item_taxes;
  PERFORM setval(pg_get_serial_sequence('order_item_taxes', 'id'), seq_val);

  -- sales_ledger_items
  SELECT COALESCE(MAX(id), 0) + 1 INTO seq_val FROM sales_ledger_items;
  PERFORM setval(pg_get_serial_sequence('sales_ledger_items', 'id'), seq_val);

  -- service_charge_ledger
  SELECT COALESCE(MAX(id), 0) + 1 INTO seq_val FROM service_charge_ledger;
  PERFORM setval(pg_get_serial_sequence('service_charge_ledger', 'id'), seq_val);

EXCEPTION WHEN OTHERS THEN
  -- Si alguna secuencia no existe, continúa sin error
  NULL;
END $$;
