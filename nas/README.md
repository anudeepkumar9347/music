# Orbit NAS runtime

The NAS runs as two small Docker services: a FastAPI and SQLite API, and a static React web app served by Nginx. Media and the database stay in the repository-level `data/` directory on the laptop.

The API source and Docker build files are together in `nas/api/`; run the local server from that directory so Python can import its `app` package.

## Start

From this directory, start the services with the local development token:

```sh
mkdir -p ../data/media ../data/import ../data/backups ../data/artwork
docker compose --parallel 1 up --build -d
```

The single build job keeps the initial build gentler on lower-memory laptops. After the first build, start the stack with `docker compose up -d`.

For a custom token, copy `.env.example` to `.env` and set `API_TOKEN` before starting. Use the same token in the mobile `.env` files and the web app's Connection Settings.

## Run the API without Docker

From the repository root, install the Python requirements and start Uvicorn. The API loads `nas/.env` from the repository automatically.

```sh
cd nas/api
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- Web app: `http://<laptop-lan-ip>:4173`
- API: `http://<laptop-lan-ip>:8000`
- API docs: `http://<laptop-lan-ip>:8000/docs`

The web app proxies API requests through its own origin. Mobile clients connect directly to port `8000` and use the same `API_TOKEN` value. The default development token is intended for a trusted local network; replace it before enabling remote access.

## Automatic metadata and artwork

Music and Movies uploads open a metadata review form before the file is sent to the NAS. The form searches by filename and lets you review or edit the suggested fields, use the suggested cover/poster, or upload your own image. Multiple selected media files pass through the form one by one. The API also reads embedded media tags when the file arrives.

It searches MusicBrainz for audio metadata and Cover Art Archive for album art without requiring credentials. Optional AcoustID fingerprint matching improves recognition when a track has weak or missing tags; register an AcoustID application and set `ACOUSTID_APP_KEY` in `.env`.

Movie and TV uploads use OMDb for title matching, posters, plot, genre, language, and release date. Get an API key from <https://www.omdbapi.com/apikey.aspx> and set `OMDB_API_KEY` in `nas/.env`. If the key is empty or OMDb has no match, the server falls back to Apple's public iTunes Search API. Music lookups continue to use MusicBrainz; `ACOUSTID_APP_KEY` is an optional key for audio fingerprint matching.

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
