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
   `sql/schema.sql`. This creates five tables — `recipes`, `ingredients`,
   `steps`, `cookware`, and `media` — with row-level security that lets the
   public site read, add, edit, and delete rows. Ingredients, steps, and
   cookware are ordered, optionally grouped into sections, and can each hold
   their own photos/videos via the `media` table. It also creates a public
   `recipe-media` Storage bucket where the image and video files are uploaded
   (with matching RLS policies for it).
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

## Deploying

The GitHub Actions workflow (`.github/workflows/pages.yml`) publishes the
`main` branch to GitHub Pages automatically. It also runs when you trigger it
manually from the **Actions** tab.

1. Push this folder to your new repo on GitHub.
2. In the repo, go to **Settings -> Pages** and set the source to
   **GitHub Actions**.
3. The site is served from `https://<user>.github.io/<repo-name>/`.

Until `config.js` is filled in, the page shows a banner instead of connecting.
