# Recipe Book

A small personal cookbook hosted on GitHub Pages. A static frontend stores
recipes in a Supabase (Postgres) database that the browser talks to directly.

## Local development

Serve the folder over HTTP (the Supabase client requires `http(s)://`, so
opening `index.html` directly from the filesystem will not work):

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Setup

1. Create a free account at https://supabase.com and start a new project.
2. In the Supabase dashboard, open **SQL Editor** and run the contents of
   `sql/schema.sql`. This creates six tables — `recipes`, `ingredients`,
   `steps`, `cookware`, `media`, and `tags`. Ingredients, steps, and cookware
   are ordered, optionally grouped into sections, and can each hold their own
   photos/videos via the `media` table. Tags are stored on each recipe in its
   `meta_info` JSON column as tag ids, with a `tags` registry table (and
   `tag_stats` view showing each tag's recipe count) for browsing and
   filtering. Storing ids means a tag can be renamed without touching recipes.
   Deleting a recipe only sets its `deleted_at` column, moving it to the
   recycle bin where it can be restored or permanently pruned. It also creates
   a private `recipe-media` Storage bucket for the files (served through signed
   URLs).
   > If the project was set up with the older, open `anon` policies, run
   > `sql/migrate_auth.sql` instead — it removes the anonymous access.
   > If the project predates tags, run `sql/tags.sql` to add them.
   > If tags already exist in the older name-based format, run
   > `sql/migrate_tags_to_ids.sql` once to convert them to ids.
   > If the project predates the recycle bin, run `sql/recycle_bin.sql` to add
   > the soft-delete column and exclude trashed recipes from tag counts.
3. Open **Project Settings -> API** and copy the **Project URL** and the
   **anon public key**.
4. Put both values into `config.js`:
   ```js
   window.SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
   window.SUPABASE_ANON_KEY = "your-anon-key";
   ```

> The anon key is meant to be public — it is only usable against the policies
> you define. Row-level security is what keeps the data safe, so do not weaken
> the policies in `schema.sql`.

## Authentication

The site is private. Nobody can read or write anything without signing in.

1. In the Supabase dashboard go to **Authentication -> Providers -> Email**
   and turn **off** "Allow new users to sign up" (so nobody can create their
   own account).
2. Under **Authentication -> Users** click **Add user** and create your own
   account (email + password). You may also want to turn off "Confirm email"
   in **Providers -> Email** so you can sign in immediately.
3. Open the site and sign in with those credentials. The session persists
   until you sign out.

## Deploying

The GitHub Actions workflow (`.github/workflows/pages.yml`) publishes the
`main` branch to GitHub Pages automatically. It also runs when you trigger it
manually from the **Actions** tab.

1. Push this folder to your new repo on GitHub.
2. In the repo, go to **Settings -> Pages** and set the source to
   **GitHub Actions**.
3. The site is served from `https://<user>.github.io/<repo-name>/`.

Until `config.js` is filled in, the page shows a banner instead of connecting.
