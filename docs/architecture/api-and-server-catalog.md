# API and server catalog

## Host configuration

The launcher talks to a REST API through `src/services/launcherApi.ts`. The current Vercel domain is only the production fallback; builds can override it with `VITE_LAUNCHER_API_BASE_URL` or provide an ordered comma-separated failover list with `VITE_LAUNCHER_API_BASE_URLS`.

Read requests can fail over on connection errors, missing routes, or server errors. Write requests only fall back on a missing route; retrying a write after an uncertain timeout could duplicate an action.

`VITE_LAUNCHER_STORAGE_BASE_URL` can point file downloads at a separate storage host. `VITE_SERVER_STATUS_BASE_URL` can replace the public Minecraft status provider. Copy `.env.example` and set these values for the build environment when moving hosts.

Keep the API response contract stable when moving the backend. Current routes used by the launcher are:

- `GET /launcher-api/events/active`
- `GET /launcher-api/announcements`
- `GET /launcher-api/stats`
- `POST /launcher-api/stats/heartbeat`
- `POST /launcher-api/stats/launch`
- `GET /storage/{path}`

The Vercel/Neon server code and database schema are not in this repository. Neon credentials must stay in the backend's secret environment and must never use a `VITE_` prefix. Moving the API host or database should not require a launcher code change as long as these routes and payloads stay compatible.

The launcher caches active server records locally, so the directory can still open during a temporary API outage. A host migration should keep the old and new API bases in the failover list for the transition, then remove the old host after clients have updated.

## Active server record

`GET /launcher-api/events/active` returns an array. The launcher keeps the existing field names and also accepts the following optional fields for server cards and soundtracks:

```json
{
  "id": 42,
  "name": "Community Server",
  "description": "A short introduction to this world.",
  "menu_background": "https://cdn.example.com/server-cover.webp",
  "music_url": "https://www.youtube.com/watch?v=abcdefghijk",
  "music_title": "Server theme",
  "music_author": "Community team",
  "server_ip": "play.example.net",
  "minecraft_version": "1.21.1",
  "loader": "Fabric"
}
```

`music_url` may be an 11-character YouTube video ID or a YouTube URL. If the API omits it, the launcher leaves the user's current music alone. `music_title` and `music_author` are optional presentation text.

The backend should allow requests from the launcher's production Tauri origin and local development origin. It should expose only public server data here; database access and credentials remain server-side.

## Catalog interface

`src/components/ServerHub.tsx` owns the directory and server overview, with scoped presentation in `ServerHub.css`. The directory includes a selectable cover, shortcuts to installed servers, search, filters, and sorting. It uses `menu_background`, then `banner_url` or `image_url`, with a theme-colored fallback when the image is absent or fails to load. A single-server catalog uses the cover without repeating the same server in a second grid.

Installation, updating, launching, maintenance guards, and code redemption remain in `App.tsx`. Catalog publication status is not treated as proof that a Minecraft server is online; the overview uses the existing server-status lookup. Search, filtering, and sorting survive a visit to a server's overview. Soundtrack playback remains mounted separately, and the overview reserves a dedicated bottom area for its controls.
