-- Run this in Supabase: SQL Editor -> New query -> Run.
-- Converts recipes.meta_info -> 'tags' from an array of tag names to an array
-- of tag ids. Run this once when upgrading from the name-based format. Any tag
-- name already attached to a recipe is backfilled into the registry, then
-- every recipe's tags array is rewritten to reference the registry ids.

-- 1. Backfill the registry with any tag names already attached to recipes.
insert into public.tags (name)
select distinct elem as name
from public.recipes r
cross join lateral jsonb_array_elements_text(r.meta_info -> 'tags') as elem
where jsonb_typeof(r.meta_info -> 'tags') = 'array'
on conflict (name) do nothing;

-- 2. Rewrite each recipe's meta_info -> 'tags' to registry ids. Already-converted
--    ids are left untouched, so this script is safe to run more than once.
update public.recipes r
set meta_info = jsonb_set(
  r.meta_info,
  '{tags}',
  (
    select coalesce(jsonb_agg(elem), '[]'::jsonb)
    from (
      select case
        when t.id is not null then t.id::text
        else elem
      end as elem
      from jsonb_array_elements_text(r.meta_info -> 'tags') as elem
      left join public.tags t on t.name = elem or t.id::text = elem
    ) s
  )
)
where jsonb_typeof(r.meta_info -> 'tags') = 'array';
