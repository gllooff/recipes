-- Run this in Supabase: SQL Editor -> New query -> Run.
-- Adds tag support to an existing project (recipes that already exist have
-- no tags until you edit and save them).

-- Tags registry. The authoritative per-recipe assignment lives in
-- recipes.meta_info -> 'tags' (an array of tag ids); this table is the
-- registry used to browse, search and count tags without scanning every
-- recipe. Storing ids means renaming a tag only touches this table.
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists tags_name_idx on public.tags (name);

-- Fast recipe lookups by tag via jsonb containment on meta_info.
create index if not exists recipes_meta_info_gin on public.recipes
  using gin (meta_info jsonb_path_ops);

alter table public.tags enable row level security;

drop policy if exists "authenticated can read tags" on public.tags;
drop policy if exists "authenticated can insert tags" on public.tags;
drop policy if exists "authenticated can update tags" on public.tags;
drop policy if exists "authenticated can delete tags" on public.tags;

create policy "authenticated can read tags" on public.tags
  for select to authenticated using (true);
create policy "authenticated can insert tags" on public.tags
  for insert to authenticated with check (true);
create policy "authenticated can update tags" on public.tags
  for update to authenticated using (true) with check (true);
create policy "authenticated can delete tags" on public.tags
  for delete to authenticated using (true);

grant select, insert, update, delete on public.tags to authenticated;

-- Each tag with the number of recipes it is attached to. Runs as the calling
-- user so RLS on the underlying tables still applies.
drop view if exists public.tag_stats;
create view public.tag_stats
  with (security_invoker = true) as
select
  t.id,
  t.name,
  count(r.id)::integer as recipe_count
from public.tags t
left join public.recipes r on (r.meta_info -> 'tags') ? t.id::text
group by t.id, t.name;

grant select on public.tag_stats to authenticated;
