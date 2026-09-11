-- BOQ lines carry a unit price (₪ per unit before VAT), so the priced bill of quantities can be read
-- against the lump-sum contracts and the budget. Null = a quantity-only line. The seed snapshot table
-- mirrors the public one column for column (snapshot/reset copy with `select *`), so both get the column.
alter table public.boq_lines add column if not exists unit_price integer;
alter table seed.boq_lines add column if not exists unit_price integer;
