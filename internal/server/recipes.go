package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

// uuidPattern matches the legacy Supabase ids that were carried over.
var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// ---------- Payload / output types ----------

type MediaRef struct {
	Type string     `json:"type"`
	Path string     `json:"path"`
	Alt  *string    `json:"alt"`
}

type IngredientIn struct {
	Section *string    `json:"section"`
	Amount  string     `json:"amount"`
	Name    string     `json:"name"`
	Note    *string    `json:"note"`
	Media   []MediaRef `json:"media"`
}

type StepIn struct {
	Section     *string    `json:"section"`
	Text        string     `json:"text"`
	DurationMin *int       `json:"duration_min"`
	Note        *string    `json:"note"`
	Media       []MediaRef `json:"media"`
}

type CookwareIn struct {
	Name  string     `json:"name"`
	Note  *string    `json:"note"`
	Media []MediaRef `json:"media"`
}

type RecipePayload struct {
	Title       string         `json:"title"`
	Notes       *string        `json:"notes"`
	Tags        []string       `json:"tags"`
	Media       []MediaRef     `json:"media"`
	Ingredients []IngredientIn `json:"ingredients"`
	Steps       []StepIn       `json:"steps"`
	Cookware    []CookwareIn   `json:"cookware"`
}

type MediaOut struct {
	ID        string  `json:"id"`
	RecipeID  string  `json:"recipe_id"`
	Type      string  `json:"type"`
	Path      string  `json:"path"`
	Alt       *string `json:"alt"`
	SortOrder int     `json:"sort_order"`
	URL       string  `json:"url"`
}

type IngredientOut struct {
	ID       string     `json:"id"`
	RecipeID string     `json:"recipe_id"`
	Position int        `json:"position"`
	Section  *string    `json:"section"`
	Amount   string     `json:"amount"`
	Name     string     `json:"name"`
	Note     *string    `json:"note"`
	Media    []MediaOut `json:"media"`
}

type StepOut struct {
	ID          string     `json:"id"`
	RecipeID    string     `json:"recipe_id"`
	Position    int        `json:"position"`
	Section     *string    `json:"section"`
	Text        string     `json:"text"`
	DurationMin *int       `json:"duration_min"`
	Note        *string    `json:"note"`
	Media       []MediaOut `json:"media"`
}

type CookwareOut struct {
	ID       string     `json:"id"`
	RecipeID string     `json:"recipe_id"`
	Position int        `json:"position"`
	Name     string     `json:"name"`
	Note     *string    `json:"note"`
	Media    []MediaOut `json:"media"`
}

type RecipeOut struct {
	ID          string          `json:"id"`
	Title       string          `json:"title"`
	Notes       *string         `json:"notes"`
	MetaInfo    json.RawMessage `json:"meta_info"`
	CreatedAt   string          `json:"created_at"`
	DeletedAt   *string         `json:"deleted_at"`
	Media       []MediaOut      `json:"media"`
	Ingredients []IngredientOut `json:"ingredients"`
	Steps       []StepOut       `json:"steps"`
	Cookware    []CookwareOut   `json:"cookware"`
}

func (r *RecipeOut) emptyChildren() {
	r.Media = []MediaOut{}
	r.Ingredients = []IngredientOut{}
	r.Steps = []StepOut{}
	r.Cookware = []CookwareOut{}
}

// validMediaName accepts only the file names this app generates (uuid.ext),
// so a stored path can never escape the media dir.
var validMediaName = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|gif|mp4|mov|webm|m4v)$`)

func validMediaPath(path string) bool { return validMediaName.MatchString(path) }

func validMediaType(t string) bool { return t == "image" || t == "video" }

func jsonDecodeBody(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}

// ---------- Recipe list / read ----------

func (s *Server) handleListRecipes(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	sort := r.URL.Query().Get("sort")
	dir := r.URL.Query().Get("dir")
	page := queryInt(r, "page", 1)
	pageSize := queryInt(r, "page_size", 5)
	tags := splitCSV(r.URL.Query().Get("tags"))

	if sort != "title" {
		sort = "created_at"
	}
	if dir != "asc" {
		dir = "desc"
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 0 {
		pageSize = 5
	}
	for _, t := range tags {
		if !uuidPattern.MatchString(t) {
			writeError(w, http.StatusBadRequest, "invalid tag id")
			return
		}
	}

	where, args := buildRecipeWhere(q, tags)

	var total int
	if err := s.db.QueryRowContext(r.Context(),
		`SELECT count(*) FROM recipes r `+where, args...).Scan(&total); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	query := `SELECT id, title, notes, meta_info, created_at, deleted_at FROM recipes r ` + where +
		` ORDER BY r.` + sort + ` ` + dir
	if pageSize > 0 {
		query += fmt.Sprintf(` LIMIT %d OFFSET %d`, pageSize, (page-1)*pageSize)
	}
	rows, err := s.db.QueryContext(r.Context(), query, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	out := []*RecipeOut{}
	byID := map[string]*RecipeOut{}
	for rows.Next() {
		rc := &RecipeOut{}
		rc.emptyChildren()
		var meta string
		if err := rows.Scan(&rc.ID, &rc.Title, &rc.Notes, &meta, &rc.CreatedAt, &rc.DeletedAt); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		rc.MetaInfo = json.RawMessage(meta)
		out = append(out, rc)
		byID[rc.ID] = rc
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if err := s.attachChildren(r.Context(), byID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
		"recipes":  out,
	})
}

func (s *Server) handleGetRecipe(w http.ResponseWriter, r *http.Request) {
	if rc, ok := s.recipeOut(w, r, r.PathValue("id")); ok {
		writeJSON(w, http.StatusOK, rc)
	}
}

func (s *Server) recipeOut(w http.ResponseWriter, r *http.Request, id string) (*RecipeOut, bool) {
	rc := &RecipeOut{}
	rc.emptyChildren()
	var meta string
	err := s.db.QueryRowContext(r.Context(), `
		SELECT id, title, notes, meta_info, created_at, deleted_at
		FROM recipes WHERE id = $1`, id).
		Scan(&rc.ID, &rc.Title, &rc.Notes, &meta, &rc.CreatedAt, &rc.DeletedAt)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "recipe not found")
		return nil, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return nil, false
	}
	rc.MetaInfo = json.RawMessage(meta)
	if err := s.attachChildren(r.Context(), map[string]*RecipeOut{id: rc}); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return nil, false
	}
	return rc, true
}

func buildRecipeWhere(q string, tags []string) (string, []any) {
	clauses := []string{"r.deleted_at IS NULL"}
	var args []any
	if q != "" {
		clauses = append(clauses, `(r.title LIKE ? ESCAPE '\' OR (r.notes IS NOT NULL AND r.notes LIKE ? ESCAPE '\'))`)
		pat := "%" + escapeLike(q) + "%"
		args = append(args, pat, pat)
	}
	if len(tags) > 0 {
		// jsonb-containment parity: ALL selected tags must be present in
		// meta_info -> 'tags'.
		ph := inPlaceholders(len(tags))
		clauses = append(clauses, fmt.Sprintf(
			`(SELECT count(DISTINCT je.value) FROM json_each(r.meta_info, '$.tags') je WHERE je.value IN (%s)) = %d`,
			ph, len(tags)))
		for _, t := range tags {
			args = append(args, t)
		}
	}
	return "WHERE " + strings.Join(clauses, " AND "), args
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

// attachChildren loads ingredients, steps, cookware and media for the given
// recipes and groups them onto each RecipeOut.
func (s *Server) attachChildren(ctx context.Context, byID map[string]*RecipeOut) error {
	if len(byID) == 0 {
		return nil
	}
	ids := make([]string, 0, len(byID))
	for id := range byID {
		ids = append(ids, id)
	}
	ph := inPlaceholders(len(ids))
	args := anyIDs(ids)

	ingRows, err := s.db.QueryContext(ctx, `
		SELECT id, recipe_id, position, section, amount, name, note
		FROM ingredients WHERE recipe_id IN (`+ph+`) ORDER BY position`, args...)
	if err != nil {
		return err
	}
	for ingRows.Next() {
		in := IngredientOut{}
		if err := ingRows.Scan(&in.ID, &in.RecipeID, &in.Position, &in.Section, &in.Amount, &in.Name, &in.Note); err != nil {
			ingRows.Close()
			return err
		}
		in.Media = []MediaOut{}
		if rc, ok := byID[in.RecipeID]; ok {
			rc.Ingredients = append(rc.Ingredients, in)
		}
	}
	ingRows.Close()
	if err := ingRows.Err(); err != nil {
		return err
	}

	stepRows, err := s.db.QueryContext(ctx, `
		SELECT id, recipe_id, position, section, text, duration_min, notes
		FROM steps WHERE recipe_id IN (`+ph+`) ORDER BY position`, args...)
	if err != nil {
		return err
	}
	for stepRows.Next() {
		st := StepOut{}
		if err := stepRows.Scan(&st.ID, &st.RecipeID, &st.Position, &st.Section, &st.Text, &st.DurationMin, &st.Note); err != nil {
			stepRows.Close()
			return err
		}
		st.Media = []MediaOut{}
		if rc, ok := byID[st.RecipeID]; ok {
			rc.Steps = append(rc.Steps, st)
		}
	}
	stepRows.Close()
	if err := stepRows.Err(); err != nil {
		return err
	}

	cwRows, err := s.db.QueryContext(ctx, `
		SELECT id, recipe_id, position, name, note
		FROM cookware WHERE recipe_id IN (`+ph+`) ORDER BY position`, args...)
	if err != nil {
		return err
	}
	for cwRows.Next() {
		cw := CookwareOut{}
		if err := cwRows.Scan(&cw.ID, &cw.RecipeID, &cw.Position, &cw.Name, &cw.Note); err != nil {
			cwRows.Close()
			return err
		}
		cw.Media = []MediaOut{}
		if rc, ok := byID[cw.RecipeID]; ok {
			rc.Cookware = append(rc.Cookware, cw)
		}
	}
	cwRows.Close()
	if err := cwRows.Err(); err != nil {
		return err
	}

	mediaRows, err := s.db.QueryContext(ctx, `
		SELECT id, recipe_id, coalesce(ingredient_id,''), coalesce(step_id,''), coalesce(cookware_id,''),
		       type, path, alt, sort_order
		FROM media WHERE recipe_id IN (`+ph+`) ORDER BY sort_order`, args...)
	if err != nil {
		return err
	}
	for mediaRows.Next() {
		var ingID, stepID, cwID string
		m := MediaOut{}
		if err := mediaRows.Scan(&m.ID, &m.RecipeID, &ingID, &stepID, &cwID, &m.Type, &m.Path, &m.Alt, &m.SortOrder); err != nil {
			mediaRows.Close()
			return err
		}
		m.URL = "/media/file/" + m.Path
		rc, ok := byID[m.RecipeID]
		if !ok {
			continue
		}
		rc.Media = append(rc.Media, m)
		switch {
		case ingID != "":
			for i := range rc.Ingredients {
				if rc.Ingredients[i].ID == ingID {
					rc.Ingredients[i].Media = append(rc.Ingredients[i].Media, m)
					break
				}
			}
		case stepID != "":
			for i := range rc.Steps {
				if rc.Steps[i].ID == stepID {
					rc.Steps[i].Media = append(rc.Steps[i].Media, m)
					break
				}
			}
		case cwID != "":
			for i := range rc.Cookware {
				if rc.Cookware[i].ID == cwID {
					rc.Cookware[i].Media = append(rc.Cookware[i].Media, m)
					break
				}
			}
		}
	}
	mediaRows.Close()
	return mediaRows.Err()
}

// ---------- Create / update / delete ----------

func (s *Server) handleCreateRecipe(w http.ResponseWriter, r *http.Request) {
	var p RecipePayload
	if err := jsonDecodeBody(r, &p); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if msg := validatePayload(&p); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	id := uuid.NewString()
	if err := s.saveRecipeContent(r.Context(), id, &p, false); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rc, ok := s.recipeOut(w, r, id); ok {
		writeJSON(w, http.StatusCreated, rc)
	}
}

func (s *Server) handleUpdateRecipe(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var p RecipePayload
	if err := jsonDecodeBody(r, &p); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if msg := validatePayload(&p); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	var exists int
	if err := s.db.QueryRowContext(r.Context(),
		`SELECT count(*) FROM recipes WHERE id = $1`, id).Scan(&exists); err != nil || exists == 0 {
		writeError(w, http.StatusNotFound, "recipe not found")
		return
	}
	if err := s.saveRecipeContent(r.Context(), id, &p, true); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rc, ok := s.recipeOut(w, r, id); ok {
		writeJSON(w, http.StatusOK, rc)
	}
}

// handleUpdateRecipeTags replaces only the tags of a recipe.
func (s *Server) handleUpdateRecipeTags(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		Tags []string `json:"tags"`
	}
	if err := jsonDecodeBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	for _, t := range req.Tags {
		if !uuidPattern.MatchString(strings.TrimSpace(t)) {
			writeError(w, http.StatusBadRequest, "invalid tag id")
			return
		}
	}
	res, err := s.db.ExecContext(r.Context(), `UPDATE recipes SET id = id WHERE id = $1`, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "recipe not found")
		return
	}
	meta, err := s.loadMeta(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	meta["tags"] = req.Tags
	if err := s.storeMeta(r.Context(), id, meta); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "tags": req.Tags})
}

func (s *Server) handleDeleteRecipe(w http.ResponseWriter, r *http.Request) {
	// Soft delete: the recipe lands in the recycle bin.
	res, err := s.db.ExecContext(r.Context(),
		`UPDATE recipes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
		time.Now().UTC().Format(time.RFC3339), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "recipe not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleRestoreRecipe(w http.ResponseWriter, r *http.Request) {
	res, err := s.db.ExecContext(r.Context(),
		`UPDATE recipes SET deleted_at = NULL WHERE id = $1`, r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "recipe not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handlePurgeRecipe permanently deletes a recipe plus its media files.
func (s *Server) handlePurgeRecipe(w http.ResponseWriter, r *http.Request) {
	paths, err := s.deleteRecipesAndFiles(r.Context(), []string{r.PathValue("id")})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	log.Printf("purged recipe %s and %d media file(s)", r.PathValue("id"), len(paths))
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleAppendRecipeMedia attaches freshly uploaded files to a recipe.
func (s *Server) handleAppendRecipeMedia(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		Media []MediaRef `json:"media"`
	}
	if err := jsonDecodeBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var exists int
	if err := s.db.QueryRowContext(r.Context(),
		`SELECT count(*) FROM recipes WHERE id = $1`, id).Scan(&exists); err != nil || exists == 0 {
		writeError(w, http.StatusNotFound, "recipe not found")
		return
	}
	for _, m := range req.Media {
		if !validMediaPath(m.Path) || !validMediaType(m.Type) {
			writeError(w, http.StatusBadRequest, "invalid media entry")
			return
		}
	}
	sort := 0
	if err := s.db.QueryRowContext(r.Context(),
		`SELECT coalesce(max(sort_order) + 1, 0) FROM media WHERE recipe_id = $1`, id).Scan(&sort); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, m := range req.Media {
		if _, err := s.db.ExecContext(r.Context(), `
			INSERT INTO media (id, recipe_id, type, path, alt, sort_order)
			VALUES (?, ?, ?, ?, ?, ?)`,
			uuid.NewString(), id, m.Type, m.Path, m.Alt, sort); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		sort++
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---------- Recycle bin ----------

func (s *Server) handleListBin(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(), `
		SELECT id, title, created_at, deleted_at FROM recipes
		WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	type binItem struct {
		ID        string  `json:"id"`
		Title     string  `json:"title"`
		CreatedAt string  `json:"created_at"`
		DeletedAt *string `json:"deleted_at"`
	}
	items := []binItem{}
	for rows.Next() {
		var it binItem
		if err := rows.Scan(&it.ID, &it.Title, &it.CreatedAt, &it.DeletedAt); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"recipes": items})
}

func (s *Server) handleRestoreAllBin(w http.ResponseWriter, r *http.Request) {
	if _, err := s.db.ExecContext(r.Context(),
		`UPDATE recipes SET deleted_at = NULL WHERE deleted_at IS NOT NULL`); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleEmptyBin(w http.ResponseWriter, r *http.Request) {
	ids := []string{}
	rows, err := s.db.QueryContext(r.Context(),
		`SELECT id FROM recipes WHERE deleted_at IS NOT NULL`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		ids = append(ids, id)
	}
	rows.Close()
	if len(ids) == 0 {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	if _, err := s.deleteRecipesAndFiles(r.Context(), ids); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---------- Internals ----------

func validatePayload(p *RecipePayload) string {
	if strings.TrimSpace(p.Title) == "" {
		return "title is required"
	}
	for _, i := range p.Ingredients {
		if strings.TrimSpace(i.Amount) == "" || strings.TrimSpace(i.Name) == "" {
			return "each ingredient needs an amount and a name"
		}
		for _, m := range i.Media {
			if !validMediaPath(m.Path) || !validMediaType(m.Type) {
				return "invalid media entry"
			}
		}
	}
	for _, st := range p.Steps {
		if strings.TrimSpace(st.Text) == "" {
			return "every step needs instructions"
		}
		for _, m := range st.Media {
			if !validMediaPath(m.Path) || !validMediaType(m.Type) {
				return "invalid media entry"
			}
		}
	}
	for _, c := range p.Cookware {
		if strings.TrimSpace(c.Name) == "" {
			return "every cookware item needs a name"
		}
		for _, m := range c.Media {
			if !validMediaPath(m.Path) || !validMediaType(m.Type) {
				return "invalid media entry"
			}
		}
	}
	for _, m := range p.Media {
		if !validMediaPath(m.Path) || !validMediaType(m.Type) {
			return "invalid media entry"
		}
	}
	return ""
}

// saveRecipeContent writes the recipe row plus all children in one
// transaction. On update it replaces children wholesale and removes media
// files that are no longer referenced anywhere.
func (s *Server) saveRecipeContent(ctx context.Context, id string, p *RecipePayload, isUpdate bool) error {
	oldPaths := map[string]bool{}
	if isUpdate {
		rows, err := s.db.QueryContext(ctx, `SELECT path FROM media WHERE recipe_id = $1`, id)
		if err != nil {
			return err
		}
		for rows.Next() {
			var path string
			if err := rows.Scan(&path); err != nil {
				rows.Close()
				return err
			}
			oldPaths[path] = true
		}
		rows.Close()
	}

	newPaths := map[string]bool{}
	ref := func(m MediaRef) { newPaths[m.Path] = true }

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	meta := map[string]any{}
	if isUpdate {
		var raw string
		if err := tx.QueryRowContext(ctx, `SELECT meta_info FROM recipes WHERE id = $1`, id).Scan(&raw); err != nil {
			return err
		}
		if strings.TrimSpace(raw) != "" {
			if err := json.Unmarshal([]byte(raw), &meta); err != nil {
				return err
			}
		}
	}
	meta["tags"] = p.Tags
	metaJSON, err := json.Marshal(meta)
	if err != nil {
		return err
	}

	if isUpdate {
		if _, err := tx.ExecContext(ctx,
			`UPDATE recipes SET title = ?, notes = ?, meta_info = ? WHERE id = ?`,
			p.Title, p.Notes, string(metaJSON), id); err != nil {
			return err
		}
		for _, table := range []string{"media", "ingredients", "steps", "cookware"} {
			if _, err := tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE recipe_id = ?`, id); err != nil {
				return err
			}
		}
	} else {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO recipes (id, title, notes, meta_info) VALUES (?, ?, ?, ?)`,
			id, p.Title, p.Notes, string(metaJSON)); err != nil {
			return err
		}
	}

	pos := 0
	for _, in := range p.Ingredients {
		entityID := uuid.NewString()
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO ingredients (id, recipe_id, position, section, amount, name, note)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			entityID, id, pos, in.Section, in.Amount, in.Name, in.Note); err != nil {
			return err
		}
		for sort, m := range in.Media {
			if err := insertMediaTx(ctx, tx, id, &entityID, nil, nil, m, sort); err != nil {
				return err
			}
			ref(m)
		}
		pos++
	}

	pos = 0
	for _, st := range p.Steps {
		entityID := uuid.NewString()
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO steps (id, recipe_id, position, section, text, duration_min, notes)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			entityID, id, pos, st.Section, st.Text, st.DurationMin, st.Note); err != nil {
			return err
		}
		for sort, m := range st.Media {
			if err := insertMediaTx(ctx, tx, id, nil, &entityID, nil, m, sort); err != nil {
				return err
			}
			ref(m)
		}
		pos++
	}

	pos = 0
	for _, cw := range p.Cookware {
		entityID := uuid.NewString()
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO cookware (id, recipe_id, position, name, note)
			VALUES (?, ?, ?, ?, ?)`,
			entityID, id, pos, cw.Name, cw.Note); err != nil {
			return err
		}
		for sort, m := range cw.Media {
			if err := insertMediaTx(ctx, tx, id, nil, nil, &entityID, m, sort); err != nil {
				return err
			}
			ref(m)
		}
		pos++
	}

	for sort, m := range p.Media {
		if err := insertMediaTx(ctx, tx, id, nil, nil, nil, m, sort); err != nil {
			return err
		}
		ref(m)
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	for path := range oldPaths {
		if !newPaths[path] {
			s.removeFileIfUnreferenced(path)
		}
	}
	return nil
}

func insertMediaTx(ctx context.Context, tx *sql.Tx, recipeID string, ingredientID, stepID, cookwareID *string, m MediaRef, sort int) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO media (id, recipe_id, ingredient_id, step_id, cookware_id, type, path, alt, sort_order)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		uuid.NewString(), recipeID, ingredientID, stepID, cookwareID, m.Type, m.Path, m.Alt, sort)
	return err
}

func (s *Server) loadMeta(ctx context.Context, id string) (map[string]any, error) {
	var raw string
	err := s.db.QueryRowContext(ctx, `SELECT meta_info FROM recipes WHERE id = $1`, id).Scan(&raw)
	if err != nil {
		return nil, err
	}
	meta := map[string]any{}
	if strings.TrimSpace(raw) != "" {
		if err := json.Unmarshal([]byte(raw), &meta); err != nil {
			return nil, err
		}
	}
	return meta, nil
}

func (s *Server) storeMeta(ctx context.Context, id string, meta map[string]any) error {
	b, err := json.Marshal(meta)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `UPDATE recipes SET meta_info = ? WHERE id = ?`, string(b), id)
	return err
}

// removeFileIfUnreferenced deletes a media file from disk when no media row
// references it anymore. Missing files are ignored.
func (s *Server) removeFileIfUnreferenced(path string) {
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM media WHERE path = $1`, path).Scan(&n); err != nil || n > 0 {
		return
	}
	if !validMediaName.MatchString(path) {
		return
	}
	if err := os.Remove(s.cfg.MediaPath(path)); err != nil && !os.IsNotExist(err) {
		log.Printf("remove media file %s: %v", path, err)
	}
}

// deleteRecipesAndFiles removes the given recipes, then deletes their media
// files from disk (only when no other row still references them).
func (s *Server) deleteRecipesAndFiles(ctx context.Context, ids []string) ([]string, error) {
	ph := inPlaceholders(len(ids))
	args := anyIDs(ids)

	paths := []string{}
	rows, err := s.db.QueryContext(ctx,
		`SELECT DISTINCT path FROM media WHERE recipe_id IN (`+ph+`)`, args...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			rows.Close()
			return nil, err
		}
		paths = append(paths, p)
	}
	rows.Close()

	if _, err := s.db.ExecContext(ctx,
		`DELETE FROM recipes WHERE id IN (`+ph+`)`, args...); err != nil {
		return nil, err
	}
	for _, p := range paths {
		s.removeFileIfUnreferenced(p)
	}
	return paths, nil
}

func queryInt(r *http.Request, key string, def int) int {
	v := r.URL.Query().Get(key)
	if v == "" {
		return def
	}
	n := 0
	for _, c := range v {
		if c < '0' || c > '9' {
			return def
		}
		n = n*10 + int(c-'0')
	}
	return n
}

func splitCSV(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func inPlaceholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

func anyIDs(ids []string) []any {
	out := make([]any, len(ids))
	for i, id := range ids {
		out[i] = id
	}
	return out
}
