-- Covering indexes for the composite foreign keys the performance advisor flagged (unindexed_foreign_keys).
create index if not exists boq_lines_covered_by_idx on public.boq_lines (project_id, covered_by_contract_id);
create index if not exists boq_lines_section_idx on public.boq_lines (project_id, section_id);
create index if not exists contracts_document_idx on public.contracts (project_id, document_id);
create index if not exists contracts_section_idx on public.contracts (project_id, section_id);
create index if not exists contracts_supplier_idx on public.contracts (project_id, supplier_id);
create index if not exists documents_supplier_idx on public.documents (project_id, supplier_id);
create index if not exists forecast_adjustments_section_idx on public.forecast_adjustments (project_id, section_id);
create index if not exists forecast_lines_section_idx on public.forecast_lines (project_id, control_date, section_id);
create index if not exists forecast_sections_section_idx on public.forecast_sections (project_id, section_id);
create index if not exists invoices_attachment_idx on public.invoices (project_id, attachment_id);
create index if not exists invoices_po_idx on public.invoices (project_id, po_id);
create index if not exists open_issues_owner_idx on public.open_issues (project_id, owner_id);
create index if not exists open_issues_section_idx on public.open_issues (project_id, section_id);
create index if not exists purchase_orders_attachment_idx on public.purchase_orders (project_id, attachment_id);
create index if not exists purchase_orders_contract_idx on public.purchase_orders (project_id, contract_id);
create index if not exists purchase_orders_section_idx on public.purchase_orders (project_id, section_id);
create index if not exists purchase_orders_supplier_idx on public.purchase_orders (project_id, supplier_id);
