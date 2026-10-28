-- Every table in public has row level security on. New tables must come with RLS and policies
-- (.claude/rules/db.md); this keeps it so.
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);

select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity $$,
  'every public table has row level security enabled'
);

select * from finish();
rollback;
