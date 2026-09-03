package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	DatabasePath string
	MediaDir     string
	WebDir       string

	// Listen address (host:port).
	ListenAddr string

	// Max upload size in bytes.
	MaxUploadBytes int64

	// CookieSecure sets the Secure attribute on session cookies. True in
	// production (behind Caddy TLS); false for plain-HTTP local testing.
	CookieSecure bool
}

func Get() (Config, error) {
	cfg := Config{
		DatabasePath:   env("DATABASE_PATH", "./data/recipes.db"),
		MediaDir:       env("MEDIA_DIR", "./data/media"),
		WebDir:         env("WEB_DIR", "./web"),
		ListenAddr:     env("LISTEN_ADDR", "127.0.0.1:8082"),
		MaxUploadBytes: int64(envInt("MAX_UPLOAD_BYTES", 100<<20)),
		CookieSecure:   envBool("COOKIE_SECURE", true),
	}

	if err := os.MkdirAll(cfg.MediaDir, 0o755); err != nil {
		return cfg, fmt.Errorf("create media dir: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(cfg.DatabasePath), 0o755); err != nil {
		return cfg, fmt.Errorf("create data dir: %w", err)
	}
	return cfg, nil
}

// MediaPath joins a stored file name onto the media dir.
func (c Config) MediaPath(name string) string {
	return filepath.Join(c.MediaDir, name)
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil {
		return def
	}
	return n
}

func envBool(key string, def bool) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	}
	return def
}

// LoadDotEnv reads KEY=VALUE lines from a file into the process environment,
// without overriding variables already set. Typical paths: "./.env" (local
// dev) and "/opt/recipes/.env" (droplet, also wired via EnvironmentFile).
func LoadDotEnv(paths ...string) {
	if len(paths) == 0 {
		paths = []string{"./.env", "/opt/recipes/.env"}
	}
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			k, v, ok := strings.Cut(line, "=")
			if !ok {
				continue
			}
			k = strings.TrimSpace(k)
			v = strings.TrimSpace(strings.Trim(v, `"'`))
			if k == "" {
				continue
			}
			if _, exists := os.LookupEnv(k); !exists {
				_ = os.Setenv(k, v)
			}
		}
		return // use the first file that exists
	}
}
