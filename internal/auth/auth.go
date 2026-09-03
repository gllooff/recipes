package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"recipes/internal/db"
)

const (
	CookieName = "recipes_session"
	SessionTTL = 30 * 24 * time.Hour
)

// User is the authenticated principal. Roles mirror the legacy Supabase
// app_metadata.app_role: editor (full read/write) and viewer (read-only).
type User struct {
	ID    int64
	Email string
	Role  string
}

func (u *User) IsEditor() bool { return u != nil && u.Role == "editor" }

// ErrInvalidCredentials is returned when the email or password is wrong.
var ErrInvalidCredentials = errInvalidCredentials{}

type errInvalidCredentials struct{}

func (errInvalidCredentials) Error() string { return "invalid email or password" }

// Login verifies email + password and returns the user.
func Login(ctx context.Context, d *db.DB, email, password string) (*User, error) {
	var u User
	var hash string
	err := d.QueryRowContext(ctx,
		`SELECT id, email, role, password_hash FROM users WHERE lower(email) = lower($1)`,
		strings.TrimSpace(email)).Scan(&u.ID, &u.Email, &u.Role, &hash)
	if err != nil {
		return nil, err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return nil, ErrInvalidCredentials
	}
	return &u, nil
}

// NewToken returns a random 32-byte hex token and its sha256 hash.
func NewToken() (token, hash string, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	token = hex.EncodeToString(b)
	sum := sha256.Sum256([]byte(token))
	return token, hex.EncodeToString(sum[:]), nil
}

func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// CreateSession inserts a session row and returns the raw cookie token.
func CreateSession(ctx context.Context, d *db.DB, userID int64) (string, error) {
	token, hash, err := NewToken()
	if err != nil {
		return "", err
	}
	_, err = d.ExecContext(ctx,
		`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
		hash, userID, time.Now().UTC().Add(SessionTTL).Format(time.RFC3339))
	if err != nil {
		return "", err
	}
	return token, nil
}

// LookupSession validates a cookie token and returns the user.
func LookupSession(ctx context.Context, d *db.DB, token string) (*User, error) {
	var u User
	err := d.QueryRowContext(ctx, `
		SELECT u.id, u.email, u.role
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1 AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
	`, HashToken(token)).Scan(&u.ID, &u.Email, &u.Role)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func RevokeSession(ctx context.Context, d *db.DB, token string) error {
	_, err := d.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = $1`, HashToken(token))
	return err
}

type contextKey string

const userKey contextKey = "user"

// Middleware reads the session cookie and injects the user into the request
// context. Invalid or missing cookies pass through as anonymous.
func Middleware(d *db.DB, _ bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c, err := r.Cookie(CookieName)
			if err != nil || c.Value == "" {
				next.ServeHTTP(w, r)
				return
			}
			u, err := LookupSession(r.Context(), d, c.Value)
			if err != nil {
				next.ServeHTTP(w, r)
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey, u)))
		})
	}
}

// UserFrom returns the current user or nil.
func UserFrom(ctx context.Context) *User {
	u, _ := ctx.Value(userKey).(*User)
	return u
}

func SetSessionCookie(w http.ResponseWriter, token string, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(SessionTTL.Seconds()),
	})
}

func ClearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	})
}

// RequireAuth gates a handler behind a logged-in user; returns 401 otherwise.
func RequireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if UserFrom(r.Context()) == nil {
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next(w, r)
	}
}

// RequireEditor gates a handler behind the editor role.
func RequireEditor(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := UserFrom(r.Context())
		if u == nil {
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if !u.IsEditor() {
			writeErr(w, http.StatusForbidden, "forbidden")
			return
		}
		next(w, r)
	}
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
