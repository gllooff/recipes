-- Recycle bin: recipes are soft-deleted by setting deleted_at, then restored
-- (deleted_at -> null) or permanently pruned (row delete, which cascades to
-- ingredients, steps, cookware and media).

alter table public.recipes add column if not exists deleted_at timestamptz;

create index if not exists recipes_deleted_at_idx on public.recipes (deleted_at);

-- Exclude deleted recipes from tag counts so a trashed recipe's tags stop
-- counting until it is restored.
drop view if exists public.tag_stats;
create view public.tag_stats
  with (security_invoker = true) as
select
  t.id,
  t.name,
  count(r.id)::integer as recipe_count
from public.tags t
left join public.recipes r on (r.meta_info -> 'tags') ? t.id::text
  and r.deleted_at is null
group by t.id, t.name;

grant select on public.tag_stats to authenticated;
