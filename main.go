package main

import (
	"fmt"
	"log"

	"recipes/internal/config"
	"recipes/internal/server"
)

func main() {
	config.LoadDotEnv()
	cfg, err := config.Get()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	srv, err := server.New(cfg)
	if err != nil {
		log.Fatalf("init: %v", err)
	}
	defer srv.Close()

	log.Printf("recipes server listening on %s (web: %s, db: %s)",
		cfg.ListenAddr, cfg.WebDir, cfg.DatabasePath)
	if err := httpListenAndServe(cfg, srv); err != nil {
		log.Fatalf("server: %v", err)
	}
	fmt.Println("stopped")
}
