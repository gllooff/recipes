# Build stage — pure-Go build, no CGO (modernc.org/sqlite).
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/recipes .

# Runtime stage
FROM alpine:3.20
RUN adduser -D -H -u 1000 recipes
COPY --from=build /out/recipes /usr/local/bin/recipes
COPY web /app/web
ENV WEB_DIR=/app/web
ENV DATABASE_PATH=/data/recipes.db
ENV MEDIA_DIR=/data/media
ENV LISTEN_ADDR=0.0.0.0:8080
USER recipes
EXPOSE 8080
VOLUME /data
ENTRYPOINT ["/usr/local/bin/recipes"]
