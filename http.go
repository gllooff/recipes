package main

import (
	"net/http"

	"recipes/internal/config"
	"recipes/internal/server"
)

func httpListenAndServe(cfg config.Config, srv *server.Server) error {
	return http.ListenAndServe(cfg.ListenAddr, srv.Handler())
}
