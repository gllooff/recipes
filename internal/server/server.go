package server

import (
	"net/http"
	"os"
	"path/filepath"

	"recipes/internal/auth"
	"recipes/internal/config"
	"recipes/internal/db"
)

type Server struct {
	cfg config.Config
	db  *db.DB
}

func New(cfg config.Config) (*Server, error) {
	d, err := db.Connect(cfg.DatabasePath)
	if err != nil {
		return nil, err
	}
	if err := d.Migrate(); err != nil {
		d.Close()
		return nil, err
	}
	return &Server{cfg: cfg, db: d}, nil
}

func (s *Server) Close() { s.db.Close() }

// Handler returns the full HTTP handler with routing and middleware.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	s.routes(mux)
	return auth.Middleware(s.db, s.cfg.CookieSecure)(mux)
}

func (s *Server) routes(mux *http.ServeMux) {
	// Auth
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.HandleFunc("GET /api/me", s.handleMe)

	// Recipes
	mux.HandleFunc("GET /api/recipes", auth.RequireAuth(s.handleListRecipes))
	mux.HandleFunc("POST /api/recipes", auth.RequireEditor(s.handleCreateRecipe))
	mux.HandleFunc("GET /api/recipes/{id}", auth.RequireAuth(s.handleGetRecipe))
	mux.HandleFunc("PATCH /api/recipes/{id}", auth.RequireEditor(s.handleUpdateRecipe))
	mux.HandleFunc("DELETE /api/recipes/{id}", auth.RequireEditor(s.handleDeleteRecipe))
	mux.HandleFunc("POST /api/recipes/{id}/restore", auth.RequireEditor(s.handleRestoreRecipe))
	mux.HandleFunc("POST /api/recipes/{id}/purge", auth.RequireEditor(s.handlePurgeRecipe))
	mux.HandleFunc("POST /api/recipes/{id}/media", auth.RequireEditor(s.handleAppendRecipeMedia))
	mux.HandleFunc("PUT /api/recipes/{id}/tags", auth.RequireEditor(s.handleUpdateRecipeTags))

	// Tags
	mux.HandleFunc("GET /api/tags", auth.RequireAuth(s.handleListTags))
	mux.HandleFunc("POST /api/tags", auth.RequireEditor(s.handleCreateTag))
	mux.HandleFunc("PATCH /api/tags/{id}", auth.RequireEditor(s.handleUpdateTag))
	mux.HandleFunc("DELETE /api/tags/{id}", auth.RequireEditor(s.handleDeleteTag))

	// Recycle bin
	mux.HandleFunc("GET /api/bin", auth.RequireEditor(s.handleListBin))
	mux.HandleFunc("POST /api/bin/restore-all", auth.RequireEditor(s.handleRestoreAllBin))
	mux.HandleFunc("POST /api/bin/empty", auth.RequireEditor(s.handleEmptyBin))

	// Uploads and media files (auth + range streaming + long cache)
	mux.HandleFunc("POST /api/upload", auth.RequireEditor(s.handleUpload))
	mux.HandleFunc("GET /media/file/{path}", auth.RequireAuth(s.handleServeFile))

	// Static frontend
	mux.Handle("/", s.staticHandler())
}

func (s *Server) staticHandler() http.Handler {
	fs := http.FileServer(http.Dir(s.cfg.WebDir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := filepath.Join(s.cfg.WebDir, filepath.Clean("/"+r.URL.Path))
		if r.URL.Path != "/" {
			if fi, err := os.Stat(p); err != nil || fi.IsDir() {
				http.NotFound(w, r)
				return
			}
		}
		fs.ServeHTTP(w, r)
	})
}
