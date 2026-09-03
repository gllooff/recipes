package server

import (
	"net/http"
	"strings"
)

type TagOut struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	RecipeCount int    `json:"recipe_count"`
}

func (s *Server) handleListTags(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	page := queryInt(r, "page", 1)
	pageSize := queryInt(r, "page_size", 20)
	if page < 1 {
		page = 1
	}

	where := ""
	var args []any
	if q != "" {
		where = ` WHERE t.name LIKE ? ESCAPE '\'`
		args = append(args, "%"+escapeLike(q)+"%")
	}

	rows, err := s.db.QueryContext(r.Context(), `
		SELECT t.id, t.name,
		       (SELECT count(*) FROM recipes rec
		        WHERE rec.deleted_at IS NULL
		          AND EXISTS (SELECT 1 FROM json_each(rec.meta_info, '$.tags') je WHERE je.value = t.id)) AS recipe_count
		FROM tags t` + where + ` ORDER BY t.name COLLATE NOCASE`, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	all := []TagOut{}
	for rows.Next() {
		var t TagOut
		if err := rows.Scan(&t.ID, &t.Name, &t.RecipeCount); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		all = append(all, t)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if pageSize <= 0 {
		writeJSON(w, http.StatusOK, map[string]any{"total": len(all), "tags": all})
		return
	}
	total := len(all)
	start := (page - 1) * pageSize
	if start > total {
		start = total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	writeJSON(w, http.StatusOK, map[string]any{"total": total, "tags": all[start:end]})
}

func (s *Server) handleCreateTag(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := jsonDecodeBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	name := normalizeTag(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "tag name is required")
		return
	}
	// Upsert on name so creating an existing tag returns the original row.
	var id string
	err := s.db.QueryRowContext(r.Context(), `
		INSERT INTO tags (id, name) VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), ?)
		ON CONFLICT(name) DO UPDATE SET name = excluded.name
		RETURNING id`, name).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id, "name": name})
}

func (s *Server) handleUpdateTag(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		Name string `json:"name"`
	}
	if err := jsonDecodeBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	name := normalizeTag(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "tag name is required")
		return
	}
	var existing string
	err := s.db.QueryRowContext(r.Context(),
		`SELECT id FROM tags WHERE name = ? AND id <> ?`, name, id).Scan(&existing)
	if err == nil {
		writeError(w, http.StatusConflict, "a tag with this name already exists")
		return
	}
	res, err := s.db.ExecContext(r.Context(), `UPDATE tags SET name = ? WHERE id = ?`, name, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "tag not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id, "name": name})
}

func (s *Server) handleDeleteTag(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	res, err := s.db.ExecContext(r.Context(), `DELETE FROM tags WHERE id = $1`, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "tag not found")
		return
	}
	// The assignment lives in recipes.meta_info; strip the deleted tag there.
	rows, err := s.db.QueryContext(r.Context(),
		`SELECT id, meta_info FROM recipes WHERE json_type(meta_info, '$.tags') = 'array' AND EXISTS (SELECT 1 FROM json_each(meta_info, '$.tags') je WHERE je.value = ?)`, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	type row struct {
		id   string
		meta string
	}
	var affected []row
	for rows.Next() {
		var rw row
		if err := rows.Scan(&rw.id, &rw.meta); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		affected = append(affected, rw)
	}
	rows.Close()

	for _, rw := range affected {
		var meta map[string]any
		if err := jsonUnmarshal(rw.meta, &meta); err != nil {
			continue
		}
		tags, _ := meta["tags"].([]any)
		kept := make([]any, 0, len(tags))
		for _, t := range tags {
			if strings.TrimSpace(toString(t)) != id {
				kept = append(kept, t)
			}
		}
		meta["tags"] = kept
		b, err := jsonMarshal(meta)
		if err != nil {
			continue
		}
		if _, err := s.db.ExecContext(r.Context(),
			`UPDATE recipes SET meta_info = ? WHERE id = ?`, string(b), rw.id); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func normalizeTag(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(s)), " "))
}
