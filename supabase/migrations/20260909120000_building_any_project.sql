-- Building tags are a project's own building ids (projects.buildings) or the shared tag; the app validates
-- them against the project, so the fixed A/B check goes.
alter table public.invoices drop constraint if exists invoices_building_check;
alter table seed.invoices drop constraint if exists invoices_building_check;
