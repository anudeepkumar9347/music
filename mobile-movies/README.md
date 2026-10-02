# Mobile Movies

An Expo streaming app connected to the shared Orbit NAS API. Movies, TV shows, artwork, streams, and favorites use the same catalog as Drive, Music, and the web app.

## Run

```sh
npm install
npx expo start
```

Set `EXPO_PUBLIC_API_URL` in the project `.env` to the NAS laptop's LAN address, for example `http://192.168.1.20:8000`. Set `EXPO_PUBLIC_API_TOKEN` to match `API_TOKEN` in `nas/.env` if you changed the development default. Copy `.env.example` to `.env` to start. On a phone, use the laptop IP rather than `localhost`.

## Shared API

The adapter in `src/movieApi.ts` uses the NAS API:

- `GET /api/library?kind=movie` and `GET /api/library?kind=show` for the video catalog
- `GET /api/search?q=...` for server-side search
- `GET /api/favorites` and `POST` / `DELETE` `/api/favorites/{id}` for shared favorites
- `GET /api/media/{id}?token=...` for playback
- `GET /api/artwork/{id}?token=...` for poster art

New video uploads are classified as movies. Use the web app's Movies section to mark an item as a TV show; that classification then appears in the app's Shows view.
