-- Give some users read-only access. Run this in Supabase: SQL Editor -> New query -> Run.
--
-- Roles come from each user's app_metadata -> 'app_role':
--   editor  -> full read/write (set on the existing account below)
--   viewer  -> read-only (new reader account below)
-- Reads stay open to any signed-in user; inserts/updates/deletes require editor.
-- After changing a user's app_role, they must sign out and sign in again.

-- Helper: is the current user an editor?
create or replace function public.is_editor()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'app_role', '') = 'editor'
$$;

-- Give the existing account editor access.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"app_role":"editor"}'::jsonb
where email = 'joseph.jeye@gmail.com';

-- Create the read-only account (password hash is bcrypt of the password).
-- Token columns must be empty strings (not NULL), or GoTrue fails to scan the
-- row during login ("converting NULL to string is unsupported").
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at,
  confirmation_token, recovery_token,
  email_change_token_new, email_change_token_current,
  phone_change_token, reauthentication_token, phone_change,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated', 'authenticated', 'reader@example.com',
  '$2b$10$Ch6TcLqhGQ3IFTMWSnvs.ecFcANc16Ncp8CJtcWqcpOnkDJ18Wjs6',
  now(),
  '', '', '', '', '', '', '',
  '{"provider":"email","providers":["email"],"app_role":"viewer"}'::jsonb,
  '{"name":"reader"}'::jsonb,
  now(), now()
);

-- recipes: writes editor-only.
drop policy if exists "authenticated can insert recipes" on public.recipes;
drop policy if exists "authenticated can update recipes" on public.recipes;
drop policy if exists "authenticated can delete recipes" on public.recipes;
create policy "editors can insert recipes" on public.recipes
  for insert to authenticated with check (public.is_editor());
create policy "editors can update recipes" on public.recipes
  for update to authenticated using (public.is_editor()) with check (public.is_editor());
create policy "editors can delete recipes" on public.recipes
  for delete to authenticated using (public.is_editor());

-- ingredients: writes editor-only.
drop policy if exists "authenticated can insert ingredients" on public.ingredients;
drop policy if exists "authenticated can delete ingredients" on public.ingredients;
create policy "editors can insert ingredients" on public.ingredients
  for insert to authenticated with check (public.is_editor());
create policy "editors can delete ingredients" on public.ingredients
  for delete to authenticated using (public.is_editor());

-- steps: writes editor-only.
drop policy if exists "authenticated can insert steps" on public.steps;
drop policy if exists "authenticated can delete steps" on public.steps;
create policy "editors can insert steps" on public.steps
  for insert to authenticated with check (public.is_editor());
create policy "editors can delete steps" on public.steps
  for delete to authenticated using (public.is_editor());

-- cookware: writes editor-only.
drop policy if exists "authenticated can insert cookware" on public.cookware;
drop policy if exists "authenticated can delete cookware" on public.cookware;
create policy "editors can insert cookware" on public.cookware
  for insert to authenticated with check (public.is_editor());
create policy "editors can delete cookware" on public.cookware
  for delete to authenticated using (public.is_editor());

-- media: writes editor-only.
drop policy if exists "authenticated can insert media" on public.media;
drop policy if exists "authenticated can delete media" on public.media;
create policy "editors can insert media" on public.media
  for insert to authenticated with check (public.is_editor());
create policy "editors can delete media" on public.media
  for delete to authenticated using (public.is_editor());

-- tags: reads stay open, writes editor-only.
drop policy if exists "authenticated can insert tags" on public.tags;
drop policy if exists "authenticated can update tags" on public.tags;
drop policy if exists "authenticated can delete tags" on public.tags;
create policy "editors can insert tags" on public.tags
  for insert to authenticated with check (public.is_editor());
create policy "editors can update tags" on public.tags
  for update to authenticated using (public.is_editor()) with check (public.is_editor());
create policy "editors can delete tags" on public.tags
  for delete to authenticated using (public.is_editor());

-- storage: readers may still download files through signed URLs, but only
-- editors can upload or delete them.
drop policy if exists "authenticated can upload media files" on storage.objects;
drop policy if exists "authenticated can delete media files" on storage.objects;
create policy "editors can upload media files" on storage.objects
  for insert to authenticated with check (bucket_id = 'recipe-media' and public.is_editor());
create policy "editors can delete media files" on storage.objects
  for delete to authenticated using (bucket_id = 'recipe-media' and public.is_editor());
