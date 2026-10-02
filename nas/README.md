# Orbit NAS runtime

The NAS runs as two small Docker services: a FastAPI and SQLite API, and a static React web app served by Nginx. Media and the database stay in the repository-level `data/` directory on the laptop.

## Start

From this directory, start the services with the local development token:

```sh
mkdir -p ../data/media ../data/import ../data/backups ../data/artwork
docker compose --parallel 1 up --build -d
```

The single build job keeps the initial build gentler on lower-memory laptops. After the first build, start the stack with `docker compose up -d`.

For a custom token, copy `.env.example` to `.env` and set `API_TOKEN` before starting. Use the same token in the mobile `.env` files and the web app's Connection Settings.

- Web app: `http://<laptop-lan-ip>:4173`
- API: `http://<laptop-lan-ip>:8000`
- API docs: `http://<laptop-lan-ip>:8000/docs`

The web app proxies API requests through its own origin. Mobile clients connect directly to port `8000` and use the same `API_TOKEN` value. The default development token is intended for a trusted local network; replace it before enabling remote access.

## Automatic metadata and artwork

Music and Movies uploads open a metadata review form before the file is sent to the NAS. The form searches by filename and lets you review or edit the suggested fields, use the suggested cover/poster, or upload your own image. Multiple selected media files pass through the form one by one. The API also reads embedded media tags when the file arrives.

It searches MusicBrainz for audio metadata and Cover Art Archive for album art without requiring credentials. Optional AcoustID fingerprint matching improves recognition when a track has weak or missing tags; register an AcoustID application and set `ACOUSTID_APP_KEY` in `.env`.

Without a key, movie uploads use Apple's public iTunes Search API as a no-sign-in fallback; its catalog and metadata are more limited, especially for TV. For higher-quality movie/show matches, posters, synopsis, genres, language, and release dates, set `TMDB_API_KEY` in `.env`. Create it in a TMDB account's API settings. The key stays in Docker's server environment, not in the clients. TMDB's developer API is free for non-commercial use with attribution. Its API terms cap cached content at six months, so the service refreshes TMDB-backed records and posters before then; use locally generated video frames for artwork you need to retain as a permanent archive. See the repository README for the provider overview.

The selected metadata is stored in SQLite, and downloaded artwork is stored under `../data/artwork/`. The web and mobile clients read those assets from the NAS API, so they share one catalog and do not independently contact metadata providers.

## Storage and maintenance

The bind mount `../data:/data` persists `media/`, `import/`, `artwork/`, and `nas.db` across container rebuilds. Backups are written to `data/backups/`.

```sh
bash scripts/healthcheck.sh
bash scripts/backup.sh
docker compose logs -f api
docker compose down
```

The API indexes uploads into SQLite and serves file bytes directly from disk. SQLite keeps the idle resource footprint low for a single-user home NAS. Keep regular copies of `data/` on another disk; a database backup alone does not protect the media files.

Before remote access, use a private VPN or HTTPS reverse proxy and keep a strong `API_TOKEN`. The example development token is only for trusted local testing.
