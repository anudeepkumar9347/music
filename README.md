# Orbit Media NAS

A self-hosted Drive, music, and movie library for one NAS laptop. FastAPI, SQLite, and a static web interface share one API and one persistent data directory; the mobile apps connect to the same server.

## Start the NAS

On Ubuntu with Docker Compose installed:

```sh
cd nas
mkdir -p ../data/media ../data/import ../data/backups ../data/artwork
docker compose --parallel 1 up --build -d
```

Open the web app at `http://<laptop-lan-ip>:4173`. The API is available at `http://<laptop-lan-ip>:8000` and its docs at `/docs`. The laptop's LAN address must be reachable from the phone; replace the sample `.20` address in the mobile `.env` files if needed.

The Docker build uses one build job to reduce peak resource use on an 8 GB machine. At runtime, one FastAPI process, SQLite, and Nginx serve all three clients. Data persists under `data/` on the laptop and survives container rebuilds. A development token is used by default for a trusted LAN; configure a custom `API_TOKEN` in `nas/.env` before remote access.

## Music and movie metadata

Uploads are inspected by FFprobe. Music uploads are matched against MusicBrainz and album covers are fetched from the Cover Art Archive; these lookups do not need an account or API key. The backend saves the chosen metadata in SQLite and artwork under `data/artwork/`, then all apps receive it through the shared library API. Optional audio fingerprint recognition uses AcoustID and Chromaprint; set `ACOUSTID_APP_KEY` in `nas/.env` after registering an AcoustID application for better matches when filenames or embedded tags are poor.

Movie uploads use OMDb for movie and TV metadata, including posters, plot, genre, language, and release date. Create an OMDb API key at <https://www.omdbapi.com/apikey.aspx> and set `OMDB_API_KEY` in `nas/.env`. If no OMDb key is configured or OMDb has no match, the server falls back to Apple's public iTunes Search API. The web and mobile Movies apps credit OMDb. Local video frame artwork and your media files remain in `data/`.

Copy `nas/.env.example` to `nas/.env` to see the server settings. Keep provider keys on the server and out of the mobile apps. The API loads `nas/.env` for local runs; Docker Compose reads the same file automatically.

## Web workspaces

- **Drive** browses all files and folders, with folder creation, moving, renaming, deletion, previews, search, and uploads.
- **Music** filters audio items and supports playback, favorites, and metadata editing. Upload opens a review form with suggested title, artist, album, language, genre, date, and cover art before the file is sent.
- **Movies** filters video items and supports playback, favorites, and movie or TV-show classification. Upload opens the same review flow with a synopsis, language, genre, date, and poster fields; multiple selections move through the form one file at a time.
- **Overview** shows disk usage and catalog counts, and provides library scan, database backup, and recent activity tools.

Changes go through the shared API, so the web interface and mobile apps see the same library and favorites.

## Mobile apps

Each client has its own `.env` with the shared server URL. Set `EXPO_PUBLIC_API_URL` to the laptop's LAN URL and `EXPO_PUBLIC_API_TOKEN` to the same value as `API_TOKEN` in `nas/.env` if you changed the development default.

```sh
cd mobile-drive && npm install && npx expo start
cd mobile-music && npm install && npx expo start
cd mobile-movies && npm install && npx expo start
```

For a physical phone, use the laptop's LAN IP rather than `localhost`. The browser app asks for the API token in Connection Settings if you configured a custom one.

## Data safety

The Compose bind mount stores media, imports, generated artwork, backups, and `nas.db` in `data/`. Run `nas/scripts/backup.sh` regularly and copy the entire `data/` directory to another disk. A single 1 TB drive is not a backup.

Keep the API on a trusted network unless it is behind HTTPS and a private VPN. Replace the development token before exposing the server beyond your LAN.
