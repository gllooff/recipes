// Command migrate builds the SQLite database from a Supabase export.
//
// Expected input (default ./migrate-data, override with -export):
//
//	recipes.json  — rows from public.recipes
//	media.json    — rows from public.media
//	tags.json     — rows from public.tags
//	users.json    — [{email, password_hash, role}] with bcrypt hashes
//	media/        — files downloaded from the recipe-media storage bucket
//
// Usage (from the repo root):
//
//	go run ./cmd/migrate -export ./migrate-data -db ./data/recipes.db -media ./data/media
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"recipes/internal/db"
)

type recipeRow struct {
	ID        string          `json:"id"`
	Title     string          `json:"title"`
	Notes     *string         `json:"notes"`
	MetaInfo  json.RawMessage `json:"meta_info"`
	CreatedAt string          `json:"created_at"`
	DeletedAt *string         `json:"deleted_at"`
}

type mediaRow struct {
	ID        string  `json:"id"`
	RecipeID  string  `json:"recipe_id"`
	Type      string  `json:"type"`
	Path      string  `json:"path"`
	Alt       *string `json:"alt"`
	SortOrder int     `json:"sort_order"`
}

type tagRow struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
}

type userRow struct {
	Email        string `json:"email"`
	PasswordHash string `json:"password_hash"`
	Role         string `json:"role"`
}

func main() {
	exportDir := flag.String("export", "./migrate-data", "directory with the Supabase export")
	dbPath := flag.String("db", "./data/recipes.db", "SQLite database path")
	mediaDir := flag.String("media", "./data/media", "media files directory")
	flag.Parse()

	log.SetFlags(log.LstdFlags)
	d, err := db.Connect(*dbPath)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer d.Close()
	if err := d.Migrate(); err != nil {
		log.Fatalf("migrate schema: %v", err)
	}

	users := []userRow{}
	if err := readJSON(filepath.Join(*exportDir, "users.json"), &users); err != nil {
		log.Fatalf("read users.json: %v", err)
	}
	for _, u := range users {
		if _, err := d.Exec(`INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)
			ON CONFLICT(email) DO NOTHING`, u.Email, u.PasswordHash, u.Role); err != nil {
			log.Fatalf("insert user %s: %v", u.Email, err)
		}
	}
	log.Printf("users: %d", len(users))

	tags := []tagRow{}
	if err := readJSON(filepath.Join(*exportDir, "tags.json"), &tags); err != nil {
		log.Fatalf("read tags.json: %v", err)
	}
	for _, t := range tags {
		if _, err := d.Exec(`INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)
			ON CONFLICT(name) DO NOTHING`, t.ID, t.Name, normTime(t.CreatedAt)); err != nil {
			log.Fatalf("insert tag %s: %v", t.Name, err)
		}
	}
	log.Printf("tags: %d", len(tags))

	recipes := []recipeRow{}
	if err := readJSON(filepath.Join(*exportDir, "recipes.json"), &recipes); err != nil {
		log.Fatalf("read recipes.json: %v", err)
	}
	for _, rc := range recipes {
		meta := normalizeMeta(rc.MetaInfo)
		if _, err := d.Exec(`INSERT INTO recipes (id, title, notes, meta_info, created_at, deleted_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO NOTHING`,
			rc.ID, rc.Title, rc.Notes, meta, normTime(rc.CreatedAt), normTimePtr(rc.DeletedAt)); err != nil {
			log.Fatalf("insert recipe %s: %v", rc.ID, err)
		}
	}
	log.Printf("recipes: %d", len(recipes))

	media := []mediaRow{}
	if err := readJSON(filepath.Join(*exportDir, "media.json"), &media); err != nil {
		log.Fatalf("read media.json: %v", err)
	}
	for _, m := range media {
		if _, err := d.Exec(`INSERT INTO media (id, recipe_id, type, path, alt, sort_order)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO NOTHING`,
			m.ID, m.RecipeID, m.Type, m.Path, m.Alt, m.SortOrder); err != nil {
			log.Fatalf("insert media %s: %v", m.ID, err)
		}
	}
	log.Printf("media rows: %d", len(media))

	// Copy media files that are not present yet.
	srcMedia := filepath.Join(*exportDir, "media")
	entries, err := os.ReadDir(srcMedia)
	if err != nil {
		log.Fatalf("read media dir: %v", err)
	}
	copied, skipped := 0, 0
	if err := os.MkdirAll(*mediaDir, 0o755); err != nil {
		log.Fatalf("create media dir: %v", err)
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		dst := filepath.Join(*mediaDir, e.Name())
		if _, err := os.Stat(dst); err == nil {
			skipped++
			continue
		}
		data, err := os.ReadFile(filepath.Join(srcMedia, e.Name()))
		if err != nil {
			log.Fatalf("read media file %s: %v", e.Name(), err)
		}
		if err := os.WriteFile(dst, data, 0o644); err != nil {
			log.Fatalf("write media file %s: %v", e.Name(), err)
		}
		copied++
	}
	log.Printf("media files: %d copied, %d already present", copied, skipped)

	// Sanity checks: every media row must have a file; report orphans.
	var missing int
	rows, err := d.Query(`SELECT DISTINCT path FROM media`)
	if err != nil {
		log.Fatalf("query media paths: %v", err)
	}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			rows.Close()
			log.Fatal(err)
		}
		if _, err := os.Stat(filepath.Join(*mediaDir, p)); err != nil {
			log.Printf("MISSING file for media row: %s", p)
			missing++
		}
	}
	rows.Close()

	var counts int
	if err := d.QueryRow(`SELECT
		(SELECT count(*) FROM recipes) ||
		(SELECT count(*) FROM tags) ||
		(SELECT count(*) FROM media) ||
		(SELECT count(*) FROM users)`).Scan(&counts); err != nil {
		log.Fatal(err)
	}
	_ = counts
	fmt.Println("migration complete")
	if missing > 0 {
		os.Exit(1)
	}
}

// normalizeMeta re-serializes meta_info, coercing tag ids to strings.
func normalizeMeta(raw json.RawMessage) string {
	meta := map[string]any{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &meta); err != nil {
			log.Fatalf("bad meta_info %s: %v", raw, err)
		}
	}
	if tags, ok := meta["tags"].([]any); ok {
		strs := make([]any, 0, len(tags))
		for _, t := range tags {
			switch v := t.(type) {
			case string:
				strs = append(strs, v)
			case float64:
				strs = append(strs, fmt.Sprintf("%v", v))
			default:
				b, _ := json.Marshal(v)
				strs = append(strs, string(b))
			}
		}
		meta["tags"] = strs
	}
	b, err := json.Marshal(meta)
	if err != nil {
		log.Fatalf("marshal meta: %v", err)
	}
	return string(b)
}

// normTime converts Supabase timestamps (e.g. "2026-08-03T21:54:34.80225+00:00")
// to RFC3339 UTC strings with millisecond precision (e.g. "2026-08-03T21:54:34.802Z").
func normTime(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return s
	}
	layouts := []string{
		"2006-01-02T15:04:05.999999999-07:00",
		"2006-01-02T15:04:05.999999999Z07:00",
		"2006-01-02T15:04:05-07:00",
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02T15:04:05.999999999",
		"2006-01-02T15:04:05",
		"2006-01-02",
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC().Format("2006-01-02T15:04:05.000Z")
		}
	}
	log.Printf("WARNING: unparsable timestamp %q, using as-is", s)
	return s
}

func normTimePtr(s *string) *string {
	if s == nil {
		return nil
	}
	t := normTime(*s)
	return &t
}

func readJSON(path string, v any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, v)
}
