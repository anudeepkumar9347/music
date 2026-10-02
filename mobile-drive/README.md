# Mobile Drive

An Expo client for the NAS library. It browses files and folders indexed by the shared Python API, uploads files to the NAS, and syncs favorites, renames, and deletions through that API. It does not browse the phone's local filesystem as a drive.

## Run

```sh
npm install
npx expo start
```

The project-root `.env` contains `EXPO_PUBLIC_API_URL`, matching the setup used by Mobile Music and Mobile Movies. Copy `.env.example` to `.env` if needed, then set the URL to the NAS laptop's reachable address (not `localhost`) when running on a phone. If the server's `API_TOKEN` differs from its development default, set `EXPO_PUBLIC_API_TOKEN` in `.env` to match. The client uses the NAS API routes `/api/library`, `/api/folders`, `/api/favorites`, `/api/stats`, `/api/search`, `/api/upload`, and `/api/media`.

On iOS and Android, the system document picker selects upload files. Uploaded files are sent to the current NAS folder and become available after the server indexes them.
