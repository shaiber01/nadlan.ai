-- seed.change_log was created with LIKE ... INCLUDING DEFAULTS, which does not copy the identity
-- property of `id`; snapshot_project_seed therefore failed with a null id. Make it an identity column.
alter table seed.change_log alter column id add generated always as identity;
