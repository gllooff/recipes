package server

import (
	"crypto/rand"
	"encoding/hex"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

var imageExts = map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".gif": true}
var videoExts = map[string]bool{".mp4": true, ".mov": true, ".webm": true, ".m4v": true}

var contentTypes = map[string]string{
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".png":  "image/png",
	".webp": "image/webp",
	".gif":  "image/gif",
	".mp4":  "video/mp4",
	".m4v":  "video/mp4",
	".mov":  "video/quicktime",
	".webm": "video/webm",
}

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.MaxUploadBytes)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "upload too large or malformed")
		return
	}
	defer r.MultipartForm.RemoveAll()

	file, hdr, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file field")
		return
	}
	defer file.Close()

	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(hdr.Filename), "."))
	if ext == "" {
		// Fall back to the declared content type, e.g. image/jpeg.
		if ct, _, err := mime.ParseMediaType(hdr.Header.Get("Content-Type")); err == nil {
			sub := strings.TrimPrefix(ct, "image/")
			sub = strings.TrimPrefix(sub, "video/")
			if _, ok := contentTypes["."+sub]; ok {
				ext = sub
			}
		}
	}
	if !imageExts["."+ext] && !videoExts["."+ext] {
		writeError(w, http.StatusBadRequest, "unsupported file type: "+ext)
		return
	}

	// The client may propose its own uuid.ext path; otherwise generate one.
	path := strings.TrimSpace(r.FormValue("path"))
	if path != "" {
		if !validMediaPath(path) {
			writeError(w, http.StatusBadRequest, "invalid path field")
			return
		}
		if _, err := os.Stat(s.cfg.MediaPath(path)); err == nil {
			// Re-upload with an existing name: replace the stored file.
			// (Names are uuids, so a clash means the same logical file.)
		} else {
			path = ""
		}
	}
	if path == "" {
		path = newMediaName(ext)
	}

	dst, err := os.CreateTemp(s.cfg.MediaDir, ".upload-*")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	tmpName := filepath.Base(dst.Name())
	_, copyErr := io.Copy(dst, io.LimitReader(file, s.cfg.MaxUploadBytes+1))
	closeErr := dst.Close()
	if copyErr != nil || closeErr != nil {
		os.Remove(filepath.Join(s.cfg.MediaDir, tmpName))
		writeError(w, http.StatusInternalServerError, "failed to store upload")
		return
	}

	final := s.cfg.MediaPath(path)
	if err := os.Rename(filepath.Join(s.cfg.MediaDir, tmpName), final); err != nil {
		os.Remove(filepath.Join(s.cfg.MediaDir, tmpName))
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	os.Chmod(final, 0o644)

	mediaType := "video"
	if imageExts["."+ext] {
		mediaType = "image"
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"path": path,
		"type": mediaType,
		"alt":  hdr.Filename,
	})
}

func newMediaName(ext string) string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	h := hex.EncodeToString(b)
	u := h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:32]
	return u + "." + ext
}

func (s *Server) handleServeFile(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("path")
	if !validMediaName.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	p := s.cfg.MediaPath(name)
	f, err := os.Open(p)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	ext := strings.TrimPrefix(filepath.Ext(name), ".")
	if ct, ok := contentTypes["."+ext]; ok {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeContent(w, r, name, fi.ModTime(), f)
}
