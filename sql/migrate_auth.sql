-- Protect the recipe book with a password.
-- Run this in Supabase: SQL Editor -> New query -> Run.
--
-- Requires Supabase Auth (enabled by default). After running this:
--   1. Turn OFF "Allow new users to sign up" under
--      Authentication -> Providers -> Email.
--   2. Add your own account under Authentication -> Users -> Add user.

-- Remove the old fully-open anon policies.
drop policy if exists "anon can read recipes" on public.recipes;
drop policy if exists "anon can insert recipes" on public.recipes;
drop policy if exists "anon can update recipes" on public.recipes;
drop policy if exists "anon can delete recipes" on public.recipes;
drop policy if exists "anon can read ingredients" on public.ingredients;
drop policy if exists "anon can insert ingredients" on public.ingredients;
drop policy if exists "anon can delete ingredients" on public.ingredients;
drop policy if exists "anon can read steps" on public.steps;
drop policy if exists "anon can insert steps" on public.steps;
drop policy if exists "anon can delete steps" on public.steps;
drop policy if exists "anon can read cookware" on public.cookware;
drop policy if exists "anon can insert cookware" on public.cookware;
drop policy if exists "anon can delete cookware" on public.cookware;
drop policy if exists "anon can read media" on public.media;
drop policy if exists "anon can insert media" on public.media;
drop policy if exists "anon can delete media" on public.media;
drop policy if exists "anon can read media files" on storage.objects;
drop policy if exists "anon can upload media files" on storage.objects;
drop policy if exists "anon can delete media files" on storage.objects;

-- Drop any existing authenticated policies so this script can be re-run.
drop policy if exists "authenticated can read recipes" on public.recipes;
drop policy if exists "authenticated can insert recipes" on public.recipes;
drop policy if exists "authenticated can update recipes" on public.recipes;
drop policy if exists "authenticated can delete recipes" on public.recipes;
drop policy if exists "authenticated can read ingredients" on public.ingredients;
drop policy if exists "authenticated can insert ingredients" on public.ingredients;
drop policy if exists "authenticated can delete ingredients" on public.ingredients;
drop policy if exists "authenticated can read steps" on public.steps;
drop policy if exists "authenticated can insert steps" on public.steps;
drop policy if exists "authenticated can delete steps" on public.steps;
drop policy if exists "authenticated can read cookware" on public.cookware;
drop policy if exists "authenticated can insert cookware" on public.cookware;
drop policy if exists "authenticated can delete cookware" on public.cookware;
drop policy if exists "authenticated can read media" on public.media;
drop policy if exists "authenticated can insert media" on public.media;
drop policy if exists "authenticated can delete media" on public.media;
drop policy if exists "authenticated can read media files" on storage.objects;
drop policy if exists "authenticated can upload media files" on storage.objects;
drop policy if exists "authenticated can delete media files" on storage.objects;

-- Only signed-in users can access the data now.
create policy "authenticated can read recipes" on public.recipes
  for select to authenticated using (true);
create policy "authenticated can insert recipes" on public.recipes
  for insert to authenticated with check (true);
create policy "authenticated can update recipes" on public.recipes
  for update to authenticated using (true) with check (true);
create policy "authenticated can delete recipes" on public.recipes
  for delete to authenticated using (true);

create policy "authenticated can read ingredients" on public.ingredients
  for select to authenticated using (true);
create policy "authenticated can insert ingredients" on public.ingredients
  for insert to authenticated with check (true);
create policy "authenticated can delete ingredients" on public.ingredients
  for delete to authenticated using (true);

create policy "authenticated can read steps" on public.steps
  for select to authenticated using (true);
create policy "authenticated can insert steps" on public.steps
  for insert to authenticated with check (true);
create policy "authenticated can delete steps" on public.steps
  for delete to authenticated using (true);

create policy "authenticated can read cookware" on public.cookware
  for select to authenticated using (true);
create policy "authenticated can insert cookware" on public.cookware
  for insert to authenticated with check (true);
create policy "authenticated can delete cookware" on public.cookware
  for delete to authenticated using (true);

create policy "authenticated can read media" on public.media
  for select to authenticated using (true);
create policy "authenticated can insert media" on public.media
  for insert to authenticated with check (true);
create policy "authenticated can delete media" on public.media
  for delete to authenticated using (true);

-- Make the media bucket private; files are served through signed URLs.
update storage.buckets set public = false where id = 'recipe-media';

create policy "authenticated can read media files" on storage.objects
  for select to authenticated using (bucket_id = 'recipe-media');
create policy "authenticated can upload media files" on storage.objects
  for insert to authenticated with check (bucket_id = 'recipe-media');
create policy "authenticated can delete media files" on storage.objects
  for delete to authenticated using (bucket_id = 'recipe-media');
