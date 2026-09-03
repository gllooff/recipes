package db

import (
	"database/sql"
	_ "embed"
	"fmt"

	_ "modernc.org/sqlite" // registers the "sqlite" driver
)

//go:embed schema.sql
var Schema string

// DB is a SQLite-backed database handle. A single connection is used so all
// statements serialize and the app never hits SQLITE_BUSY on a 1 GB box.
type DB struct {
	*sql.DB
}

// Connect opens a SQLite database at path and enables foreign keys, WAL and a
// busy timeout.
func Connect(path string) (*DB, error) {
	dsn := "file:" + path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)"
	d, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	d.SetMaxOpenConns(1)
	d.SetMaxIdleConns(1)
	if err := d.Ping(); err != nil {
		d.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}
	return &DB{d}, nil
}

// Migrate applies the schema. All statements are idempotent.
func (d *DB) Migrate() error {
	if _, err := d.Exec(Schema); err != nil {
		return fmt.Errorf("apply schema: %w", err)
	}
	return nil
}
