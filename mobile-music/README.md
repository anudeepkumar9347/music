# Mobile Music

An Expo music player connected to the shared Orbit NAS API. Music, playback artwork, and favorites come from the same NAS catalog used by Drive, Movies, and the web app.

## Run

```sh
npm install
npx expo start
```

Set `EXPO_PUBLIC_API_URL` in the project `.env` to the NAS laptop's LAN address, for example `http://192.168.1.20:8000`. Set `EXPO_PUBLIC_API_TOKEN` to match `API_TOKEN` in `nas/.env` if you changed the development default. Copy `.env.example` to `.env` to start. On a phone, use the laptop IP rather than `localhost`.

## Shared API

The adapter in `src/musicApi.ts` consumes the NAS API:

- `GET /api/library?kind=music` for tracks and album metadata
- `GET /api/search?q=...` for server-side search
- `GET /api/favorites` and `POST` / `DELETE /api/favorites/{id}` for shared favorites
- `GET /api/media/{id}?token=...` for audio playback
- `GET /api/artwork/{id}?token=...` for cover art

Albums are grouped from the indexed artist and album tags. The NAS extracts audio duration and cover artwork while indexing newly uploaded files.
