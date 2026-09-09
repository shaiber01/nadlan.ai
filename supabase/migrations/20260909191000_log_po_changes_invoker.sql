-- The order-change trigger function was recreated as SECURITY DEFINER (security advisor warning: callable by anon
-- through /rest/v1/rpc); like the invoice trigger it needs no elevated rights.
alter function public.log_po_changes() security invoker;
