import mimetypes
import os
import hashlib
import io
import json
import re
import secrets
import shutil
import sqlite3
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from difflib import SequenceMatcher
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
try:
    from PIL import Image
except ImportError:
    Image = None

API_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = API_ROOT.parent.parent
PROJECT_ROOT = REPOSITORY_ROOT if (REPOSITORY_ROOT / "nas").is_dir() else API_ROOT
load_dotenv(PROJECT_ROOT / "nas" / ".env", override=False)
default_data_root = "/data" if PROJECT_ROOT == API_ROOT else str(PROJECT_ROOT / "data")
DATA_ROOT = Path(os.getenv("DATA_ROOT", default_data_root)).expanduser()
if not DATA_ROOT.is_absolute():
    DATA_ROOT = PROJECT_ROOT / DATA_ROOT
MEDIA_ROOT = Path(os.getenv("MEDIA_ROOT", str(DATA_ROOT / "media"))).expanduser()
DB_PATH = Path(os.getenv("DB_PATH", str(DATA_ROOT / "nas.db"))).expanduser()
if not MEDIA_ROOT.is_absolute():
    MEDIA_ROOT = PROJECT_ROOT / MEDIA_ROOT
if not DB_PATH.is_absolute():
    DB_PATH = PROJECT_ROOT / DB_PATH
IMPORT_ROOT = MEDIA_ROOT.parent / "import"
ARTWORK_ROOT = MEDIA_ROOT.parent / "artwork"
API_TOKEN = os.getenv("API_TOKEN", "orbit-local-dev-token")
def normalize_omdb_key(value: str) -> str:
    configured = value.strip()
    if configured.lower().startswith(("http://", "https://")):
        parsed = urllib.parse.urlparse(configured)
        if parsed.hostname not in {"omdbapi.com", "www.omdbapi.com"}:
            return ""
        return urllib.parse.parse_qs(parsed.query).get("apikey", [""])[0].strip()
    if configured.lower().startswith("apikey="):
        configured = configured.split("=", 1)[1]
    return configured.strip()


OMDB_API_KEY = normalize_omdb_key(os.getenv("OMDB_API_KEY", ""))
ACOUSTID_APP_KEY = os.getenv("ACOUSTID_APP_KEY", "").strip()
ITUNES_COUNTRY = os.getenv("ITUNES_COUNTRY", "IN").strip().upper()
METADATA_USER_AGENT = os.getenv("METADATA_USER_AGENT", "OrbitNAS/0.1 (https://github.com/anudeepkumar9347/nas)")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(20 * 1024 * 1024 * 1024)))
RATE_WINDOW_SECONDS = 60
RATE_LIMIT = 120
REQUESTS: dict[str, list[float]] = {}
MUSICBRAINZ_LAST_REQUEST = 0.0
MUSICBRAINZ_LOCK = threading.Lock()
ITUNES_LOCK = threading.Lock()
ITUNES_LAST_REQUEST = 0.0
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
IMPORT_ROOT.mkdir(parents=True, exist_ok=True)
ARTWORK_ROOT.mkdir(parents=True, exist_ok=True)
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Orbit Media API", version="0.1.0")
origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:8081").split(",")
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"], allow_credentials=True)


def connection() -> sqlite3.Connection:
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    return db


def initialise() -> None:
    with connection() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            kind TEXT NOT NULL,
            size INTEGER NOT NULL,
            mime TEXT,
            created_at TEXT NOT NULL
        )""")
        db.execute("CREATE TABLE IF NOT EXISTS progress (media_id INTEGER PRIMARY KEY, position REAL NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS refresh_tokens (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS folders (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, parent_id INTEGER, created_at TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS playlists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS playlist_items (playlist_id INTEGER NOT NULL, media_id INTEGER NOT NULL, position INTEGER NOT NULL, PRIMARY KEY(playlist_id, media_id))")
        db.execute("CREATE TABLE IF NOT EXISTS favorites (media_id INTEGER PRIMARY KEY, created_at TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, subject TEXT NOT NULL, created_at TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS upload_sessions (id TEXT PRIMARY KEY, name TEXT NOT NULL, total INTEGER NOT NULL, received INTEGER NOT NULL DEFAULT 0, path TEXT NOT NULL, created_at TEXT NOT NULL)")
        for statement in ("ALTER TABLE media ADD COLUMN title TEXT", "ALTER TABLE media ADD COLUMN artist TEXT", "ALTER TABLE media ADD COLUMN album TEXT", "ALTER TABLE media ADD COLUMN lyrics TEXT", "ALTER TABLE media ADD COLUMN subtitle TEXT", "ALTER TABLE media ADD COLUMN artwork_path TEXT", "ALTER TABLE media ADD COLUMN dominant_color TEXT", "ALTER TABLE media ADD COLUMN checksum TEXT", "ALTER TABLE media ADD COLUMN folder_id INTEGER", "ALTER TABLE media ADD COLUMN media_type TEXT", "ALTER TABLE media ADD COLUMN duration REAL", "ALTER TABLE media ADD COLUMN language TEXT", "ALTER TABLE media ADD COLUMN genre TEXT", "ALTER TABLE media ADD COLUMN description TEXT", "ALTER TABLE media ADD COLUMN release_date TEXT", "ALTER TABLE media ADD COLUMN external_id TEXT", "ALTER TABLE media ADD COLUMN metadata_provider TEXT", "ALTER TABLE media ADD COLUMN metadata_checked_at TEXT"):
            try:
                db.execute(statement)
            except sqlite3.OperationalError:
                pass
        db.execute("UPDATE media SET media_type = kind WHERE media_type IS NULL")
        db.commit()


def require_token(authorization: str | None = Header(default=None), token: str | None = Query(default=None)) -> None:
    candidate = authorization.removeprefix("Bearer ") if authorization else token
    valid_refresh = False
    if candidate and candidate != API_TOKEN:
        with connection() as db:
            valid_refresh = db.execute("SELECT 1 FROM refresh_tokens WHERE token = ? AND expires_at > ?", (candidate, datetime.now(timezone.utc).isoformat())).fetchone() is not None
    if candidate != API_TOKEN and not valid_refresh:
        raise HTTPException(status_code=401, detail="Authentication required")
    now = time.time()
    recent = [stamp for stamp in REQUESTS.get(candidate or "anonymous", []) if now - stamp < RATE_WINDOW_SECONDS]
    if len(recent) >= RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Too many requests")
    recent.append(now)
    REQUESTS[candidate or "anonymous"] = recent


def audit(action: str, subject: str) -> None:
    with connection() as db:
        db.execute("INSERT INTO audit_events(action, subject, created_at) VALUES(?, ?, ?)", (action, subject, datetime.now(timezone.utc).isoformat()))
        db.commit()


class MediaUpdate(BaseModel):
    name: str | None = None
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    language: str | None = None
    genre: str | None = None
    description: str | None = None
    release_date: str | None = None
    external_id: str | None = None
    metadata_provider: str | None = None
    lyrics: str | None = None
    subtitle: str | None = None
    folder_id: int | None = None
    media_type: str | None = None


class ProgressUpdate(BaseModel):
    position: float


class PlaylistInput(BaseModel):
    name: str


class PlaylistItemsInput(BaseModel):
    media_ids: list[int]


class FolderInput(BaseModel):
    name: str
    parent_id: int | None = None


class FolderUpdate(BaseModel):
    name: str | None = None
    parent_id: int | None = None


class UserInput(BaseModel):
    username: str
    password: str


def media_kind(path: Path) -> str:
    if path.suffix.lower() in {".mp3", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wav"}:
        return "music"
    if path.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v"}:
        return "movie"
    return "file"


def media_metadata(path: Path) -> dict[str, str | None]:
    metadata: dict[str, str | None] = {"title": path.stem, "artist": None, "album": None, "language": None, "genre": None, "description": None, "release_date": None, "external_id": None, "metadata_provider": None, "artwork_path": None, "dominant_color": None, "checksum": None, "duration": "0"}
    ffprobe = shutil.which("ffprobe")
    if ffprobe:
        try:
            result = subprocess.run([ffprobe, "-v", "quiet", "-show_entries", "format=duration:format_tags=title,artist,album,genre,language,date:stream_tags=title,artist,album,genre,language,date", "-of", "default=noprint_wrappers=1", str(path)], capture_output=True, text=True, timeout=8, check=True)
            seen_tags: set[str] = set()
            for line in result.stdout.splitlines():
                key, _, value = line.partition("=")
                key = key.rsplit(":", 1)[-1].lower()
                key = {"date": "release_date"}.get(key, key)
                if key in metadata and value and key not in seen_tags:
                    metadata[key] = value
                    seen_tags.add(key)
        except (OSError, subprocess.SubprocessError):
            pass
    digest_builder = hashlib.sha256()
    with path.open("rb") as media_file:
        for chunk in iter(lambda: media_file.read(1024 * 1024), b""):
            digest_builder.update(chunk)
    digest = digest_builder.hexdigest()
    metadata["checksum"] = digest
    metadata["dominant_color"] = f"#{digest[:6]}"
    if media_kind(path) in {"music", "movie"} and shutil.which("ffmpeg"):
        artwork = ARTWORK_ROOT / f"{digest}.jpg"
        if not artwork.exists():
            try:
                command = ["ffmpeg", "-y", "-i", str(path), "-an", "-vcodec", "mjpeg", "-frames:v", "1"]
                if media_kind(path) == "movie":
                    command[4:4] = ["-ss", "00:00:08"]
                command.append(str(artwork))
                subprocess.run(command, capture_output=True, timeout=15, check=True)
            except (OSError, subprocess.SubprocessError):
                pass
        if artwork.exists():
            metadata["artwork_path"] = artwork.name
            if Image:
                try:
                    pixel = Image.open(artwork).convert("RGB").resize((1, 1)).getpixel((0, 0))
                    metadata["dominant_color"] = "#%02x%02x%02x" % pixel
                except (OSError, ValueError):
                    pass
    return metadata


def request_json(url: str, *, data: bytes | None = None, headers: dict[str, str] | None = None, timeout: int = 8) -> dict[str, Any] | None:
    request_headers = {"User-Agent": METADATA_USER_AGENT, "Accept": "application/json"} | (headers or {})
    request = urllib.request.Request(url, data=data, headers=request_headers, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read(4 * 1024 * 1024 + 1)
        if len(payload) > 4 * 1024 * 1024:
            return None
        result = json.loads(payload)
        return result if isinstance(result, dict) else None
    except (OSError, ValueError, urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
        return None


def musicbrainz_json(path: str, query: dict[str, str]) -> dict[str, Any] | None:
    global MUSICBRAINZ_LAST_REQUEST
    with MUSICBRAINZ_LOCK:
        wait = 1.05 - (time.monotonic() - MUSICBRAINZ_LAST_REQUEST)
        if wait > 0:
            time.sleep(wait)
        MUSICBRAINZ_LAST_REQUEST = time.monotonic()
        url = f"https://musicbrainz.org/ws/2/{path}?{urllib.parse.urlencode(query)}"
        return request_json(url, timeout=10)


def clean_media_title(path: Path) -> tuple[str, str | None, str | None]:
    stem = path.stem.replace(".", " ").replace("_", " ")
    year_matches = list(re.finditer(r"\b(19\d{2}|20\d{2})\b", stem))
    year_match = year_matches[-1] if year_matches else None
    year = year_match.group(1) if year_match else None
    is_show = bool(re.search(r"\bS\d{1,2}\s*E\d{1,2}\b|\bSeason\s*\d+\b", stem, re.I))
    if year_match:
        stem = stem[:year_match.start()] + " " + stem[year_match.end():]
    stem = re.sub(r"\b(2160p|1080p|720p|480p|4k|8k|hdr10?|dv|uhd|bluray|blu ray|brrip|bdrip|web[- ]?dl|web[- ]?rip|hdtv|dvdrip|x26[45]|h26[45]|hevc|av1|aac\d*|dts|proper|repack|limited)\b", " ", stem, flags=re.I)
    stem = re.sub(r"\bS\d{1,2}\s*E\d{1,2}\b|\bSeason\s*\d+\b|\bEpisode\s*\d+\b", " ", stem, flags=re.I)
    stem = re.sub(r"\[[^]]*\]|\([^)]*\)", " ", stem)
    title = re.sub(r"\s+", " ", stem).strip(" -_")
    return title or path.stem, year, "show" if is_show else None


def normalized_text(value: str | None) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", (value or "").casefold()))


def artist_credit_name(credit: list[Any] | None) -> str | None:
    if not credit:
        return None
    names = [str(item.get("name") or item.get("artist", {}).get("name") or "").strip() for item in credit if isinstance(item, dict)]
    result = "".join(names)
    return result or None


def acoustid_recording_id(path: Path) -> str | None:
    fpcalc = shutil.which("fpcalc")
    if not ACOUSTID_APP_KEY or not fpcalc:
        return None
    try:
        result = subprocess.run([fpcalc, "-json", "-length", "120", str(path)], capture_output=True, text=True, timeout=45, check=True)
        fingerprint = json.loads(result.stdout)
        payload = urllib.parse.urlencode({
            "client": ACOUSTID_APP_KEY,
            "duration": str(fingerprint.get("duration", "")),
            "fingerprint": str(fingerprint.get("fingerprint", "")),
            "meta": "recordings+releasegroups",
        }).encode()
        response = request_json("https://api.acoustid.org/v2/lookup", data=payload, timeout=12)
        if not response or response.get("status") != "ok":
            return None
        results = sorted(response.get("results", []), key=lambda item: item.get("score", 0), reverse=True)
        for match in results:
            recordings = match.get("recordings") or []
            if match.get("score", 0) >= 0.65 and recordings and recordings[0].get("id"):
                return str(recordings[0]["id"])
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    return None


def music_metadata_lookup(path: Path, metadata: dict[str, str | None], *, force_match: bool = False) -> dict[str, str | None]:
    title = str(metadata.get("title") or path.stem)
    artist = str(metadata.get("artist") or "")
    recording_id = acoustid_recording_id(path)
    recording: dict[str, Any] | None = None
    if recording_id:
        response = musicbrainz_json(f"recording/{recording_id}", {"inc": "artists+releases+tags", "fmt": "json"})
        recording = response if response and response.get("id") else None
    if recording is None:
        terms = f'recording:"{title}"' + (f' AND artist:"{artist}"' if artist else "")
        response = musicbrainz_json("recording/", {"query": terms, "limit": "5", "inc": "artists+releases+tags", "fmt": "json"})
        candidates = response.get("recordings", []) if response else []
        scored: list[tuple[float, dict[str, Any]]] = []
        wanted_title = normalized_text(title)
        wanted_artist = normalized_text(artist)
        for candidate in candidates:
            candidate_artist = normalized_text(artist_credit_name(candidate.get("artist-credit")))
            title_score = SequenceMatcher(None, wanted_title, normalized_text(candidate.get("title"))).ratio()
            artist_score = SequenceMatcher(None, wanted_artist, candidate_artist).ratio() if wanted_artist and candidate_artist else 0.6
            score = title_score * 0.75 + artist_score * 0.25 if wanted_artist else title_score
            scored.append((score, candidate))
        if scored:
            score, best = max(scored, key=lambda row: row[0])
            if score >= 0.82:
                recording = best
    if not recording:
        return {}

    result: dict[str, str | None] = {"metadata_provider": "musicbrainz", "external_id": f"musicbrainz:{recording.get('id')}"}
    if force_match or not metadata.get("title") or metadata.get("title") == path.stem:
        result["title"] = recording.get("title")
    if force_match or not metadata.get("artist"):
        result["artist"] = artist_credit_name(recording.get("artist-credit"))
    releases = recording.get("releases") or []
    if releases:
        release = releases[0]
        if force_match or not metadata.get("album"):
            result["album"] = release.get("title")
        result["release_date"] = release.get("date")
        language = (release.get("text-representation") or {}).get("language")
        if not metadata.get("language") and language:
            result["language"] = language
        release_group = release.get("release-group") or {}
        release_group_id = release_group.get("id")
        if release_group_id:
            cover = request_json(f"https://coverartarchive.org/release-group/{release_group_id}", timeout=8)
            images = cover.get("images", []) if cover else []
            front = next((image for image in images if image.get("front")), images[0] if images else None)
            if front:
                result["_artwork_url"] = (front.get("thumbnails") or {}).get("500") or front.get("image")
    if not metadata.get("genre"):
        tags = sorted(recording.get("tags", []), key=lambda tag: tag.get("count", 0), reverse=True)
        if tags:
            result["genre"] = tags[0].get("name")
    return result


def omdb_request(params: dict[str, str]) -> dict[str, Any] | None:
    if not OMDB_API_KEY:
        return None
    query = {"apikey": OMDB_API_KEY, "r": "json", **params}
    response = request_json(f"https://www.omdbapi.com/?{urllib.parse.urlencode(query)}", timeout=10)
    return response if response and response.get("Response") == "True" else None


def omdb_movie_metadata_lookup(path: Path) -> dict[str, str | None]:
    title, year, detected_type = clean_media_title(path)
    query = {
        "t": title,
        "type": "series" if detected_type == "show" else "movie",
        "plot": "full",
    }
    if year:
        query["y"] = year
    candidate = omdb_request(query)
    if not candidate:
        return {}
    imdb_id = candidate.get("imdbID")
    media_type = "show" if candidate.get("Type") == "series" else "movie"
    released = str(candidate.get("Released") or "")
    try:
        release_date = datetime.strptime(released, "%d %b %Y").date().isoformat()
    except ValueError:
        matched_year = re.search(r"\b(19\d{2}|20\d{2})\b", str(candidate.get("Year") or ""))
        release_date = matched_year.group(1) if matched_year else None
    poster = candidate.get("Poster")
    if poster == "N/A":
        poster = None
    def omdb_value(field: str) -> str | None:
        value = candidate.get(field)
        return str(value) if value and value != "N/A" else None

    return {
        "title": omdb_value("Title"),
        "language": omdb_value("Language"),
        "genre": omdb_value("Genre"),
        "description": omdb_value("Plot"),
        "release_date": release_date,
        "media_type": media_type,
        "external_id": f"omdb:{imdb_id}" if imdb_id else None,
        "metadata_provider": "omdb",
        "_artwork_url": poster,
    }


def itunes_movie_metadata_lookup(path: Path) -> dict[str, str | None]:
    global ITUNES_LAST_REQUEST
    with ITUNES_LOCK:
        wait = 3.1 - (time.monotonic() - ITUNES_LAST_REQUEST)
        if wait > 0:
            time.sleep(wait)
        ITUNES_LAST_REQUEST = time.monotonic()
    title, year, detected_type = clean_media_title(path)
    if detected_type == "show":
        media, entity = "tvShow", "tvSeason"
    else:
        media, entity = "movie", "movie"
    query = urllib.parse.urlencode({"term": title, "country": ITUNES_COUNTRY or "US", "media": media, "entity": entity, "limit": "8", "lang": "en_us"})
    response = request_json(f"https://itunes.apple.com/search?{query}", timeout=8)
    candidates = response.get("results", []) if response else []
    wanted = normalized_text(title)
    scored: list[tuple[float, dict[str, Any]]] = []
    for item in candidates:
        candidate_title = item.get("collectionName") or item.get("trackName")
        score = SequenceMatcher(None, wanted, normalized_text(candidate_title)).ratio()
        date = str(item.get("releaseDate") or "")
        if year and date.startswith(year):
            score = min(1.0, score + 0.08)
        scored.append((score, item))
    if not scored:
        return {}
    score, candidate = max(scored, key=lambda row: row[0])
    if score < 0.82:
        return {}
    artwork = candidate.get("artworkUrl100")
    if artwork:
        artwork = re.sub(r"/\d+x\d+bb\.", "/600x600bb.", artwork)
    return {
        "title": candidate.get("collectionName") or candidate.get("trackName"),
        "genre": candidate.get("primaryGenreName"),
        "description": candidate.get("longDescription") or candidate.get("shortDescription"),
        "release_date": candidate.get("releaseDate"),
        "external_id": f"itunes:{media}:{candidate.get('trackId') or candidate.get('collectionId')}",
        "metadata_provider": "itunes",
        "_artwork_url": artwork,
    }


def movie_metadata_lookup(path: Path) -> dict[str, str | None]:
    if OMDB_API_KEY:
        match = omdb_movie_metadata_lookup(path)
        if match:
            return match
    return itunes_movie_metadata_lookup(path)


def persist_artwork_bytes(content: bytes, checksum: str | None) -> tuple[str | None, str | None]:
    if not checksum:
        return None, None
    try:
        image = Image.open(io.BytesIO(content)).convert("RGB") if Image else None
        if image is None:
            return None, None
        image.thumbnail((1200, 1600))
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=88, optimize=True)
        artwork_path = ARTWORK_ROOT / f"{checksum}.jpg"
        temporary_path = artwork_path.with_suffix(".tmp")
        temporary_path.write_bytes(output.getvalue())
        temporary_path.replace(artwork_path)
        pixel = image.resize((1, 1)).getpixel((0, 0))
        return artwork_path.name, "#%02x%02x%02x" % pixel
    except (OSError, ValueError):
        return None, None


def persist_artwork(url: str | None, checksum: str | None) -> tuple[str | None, str | None]:
    if not url or not checksum:
        return None, None
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or "").lower()
    trusted_host = host in {"coverartarchive.org", "m.media-amazon.com", "images-na.ssl-images-amazon.com", "archive.org"} or host.endswith(".mzstatic.com")
    if parsed.scheme not in {"http", "https"} or not trusted_host:
        return None, None
    secure_url = parsed._replace(scheme="https").geturl()
    try:
        with urllib.request.urlopen(urllib.request.Request(secure_url, headers={"User-Agent": METADATA_USER_AGENT}), timeout=12) as response:
            content = response.read(15 * 1024 * 1024 + 1)
        if len(content) > 15 * 1024 * 1024:
            return None, None
        return persist_artwork_bytes(content, checksum)
    except (OSError, ValueError, urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
        return None, None


def enrich_media(path: Path, kind: str, metadata: dict[str, str | None]) -> dict[str, str | None]:
    remote: dict[str, str | None] = {}
    if kind == "music":
        remote = music_metadata_lookup(path, metadata)
    elif kind == "movie":
        remote = movie_metadata_lookup(path)
    artwork_url = remote.pop("_artwork_url", None)
    if artwork_url:
        parsed_artwork = urllib.parse.urlparse(artwork_url)
        if parsed_artwork.scheme == "http":
            artwork_url = parsed_artwork._replace(scheme="https").geturl()
    metadata.update({key: value for key, value in remote.items() if value is not None})
    if metadata.get("metadata_provider"):
        metadata["metadata_checked_at"] = datetime.now(timezone.utc).isoformat()
    if artwork_url:
        artwork_path, dominant_color = persist_artwork(artwork_url, metadata.get("checksum"))
        if artwork_path:
            metadata["artwork_path"] = artwork_path
            metadata["dominant_color"] = dominant_color
    return metadata


def folder_path(db: sqlite3.Connection, folder_id: int | None) -> Path:
    parts: list[str] = []
    current_id = folder_id
    visited: set[int] = set()
    while current_id is not None:
        if current_id in visited:
            raise HTTPException(status_code=400, detail="Folder hierarchy contains a cycle")
        visited.add(current_id)
        row = db.execute("SELECT id, name, parent_id FROM folders WHERE id = ?", (current_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Folder not found")
        parts.append(row["name"])
        current_id = row["parent_id"]
    return Path(*reversed(parts)) if parts else Path()


def scan_library(*, enrich_external: bool = True) -> int:
    found = 0
    with connection() as db:
        folder_paths = [(row["id"], folder_path(db, row["id"])) for row in db.execute("SELECT id FROM folders").fetchall()]
        for source in IMPORT_ROOT.rglob("*"):
            if not source.is_file():
                continue
            relative = source.relative_to(IMPORT_ROOT)
            target = MEDIA_ROOT / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source), str(target))
            metadata = media_metadata(target)
            kind = media_kind(target)
            if enrich_external:
                metadata = enrich_media(target, kind, metadata)
            checksum = metadata["checksum"]
            try:
                duration = max(0.0, float(metadata["duration"] or 0))
            except (TypeError, ValueError):
                duration = 0.0
            folder = next((folder_id for folder_id, path in sorted(folder_paths, key=lambda item: len(item[1].parts), reverse=True) if relative.parent == path or str(relative.parent).startswith(f"{path}/")), None)
            media_type = "movie" if kind == "movie" else kind
            if kind == "movie" and metadata.get("media_type") in {"movie", "show"}:
                media_type = str(metadata["media_type"])
            db.execute("INSERT OR REPLACE INTO media(name, path, kind, size, mime, title, artist, album, artwork_path, dominant_color, checksum, folder_id, media_type, duration, language, genre, description, release_date, external_id, metadata_provider, metadata_checked_at, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (target.name, str(target.relative_to(MEDIA_ROOT)), kind, target.stat().st_size, mimetypes.guess_type(target.name)[0], metadata["title"], metadata["artist"], metadata["album"], metadata["artwork_path"], metadata["dominant_color"], checksum, folder if folder else None, media_type, duration, metadata["language"], metadata["genre"], metadata["description"], metadata["release_date"], metadata["external_id"], metadata["metadata_provider"], metadata.get("metadata_checked_at"), datetime.now(timezone.utc).isoformat()))
            found += 1
        db.commit()
    return found


@app.on_event("startup")
def startup() -> None:
    initialise()
    scan_library()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "orbit-api"}


@app.post("/api/auth/register")
def register(user: UserInput) -> dict[str, str]:
    password_hash = hashlib.pbkdf2_hmac("sha256", user.password.encode(), user.username.encode(), 120_000).hex()
    try:
        with connection() as db:
            db.execute("INSERT INTO users(username, password_hash, created_at) VALUES(?, ?, ?)", (user.username, password_hash, datetime.now(timezone.utc).isoformat()))
            db.commit()
    except sqlite3.IntegrityError as error:
        raise HTTPException(status_code=409, detail="Username already exists") from error
    return {"username": user.username}


@app.post("/api/auth/login")
def login(user: UserInput) -> dict[str, str]:
    password_hash = hashlib.pbkdf2_hmac("sha256", user.password.encode(), user.username.encode(), 120_000).hex()
    with connection() as db:
        row = db.execute("SELECT id FROM users WHERE username = ? AND password_hash = ?", (user.username, password_hash)).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        token = secrets.token_urlsafe(32)
        expires = (datetime.now(timezone.utc) + timedelta(days=365)).isoformat()
        db.execute("INSERT INTO refresh_tokens(token, user_id, expires_at) VALUES(?, ?, ?)", (token, row["id"], expires))
        db.commit()
    return {"access_token": token, "token_type": "bearer"}


@app.get("/api/library")
def library(kind: str | None = None, _: None = Depends(require_token)) -> list[dict[str, Any]]:
    with connection() as db:
        if kind == "show":
            rows = db.execute("SELECT * FROM media WHERE kind = 'movie' AND media_type = 'show' ORDER BY created_at DESC").fetchall()
        elif kind == "movie":
            rows = db.execute("SELECT * FROM media WHERE kind = 'movie' AND COALESCE(media_type, 'movie') != 'show' ORDER BY created_at DESC").fetchall()
        elif kind:
            rows = db.execute("SELECT * FROM media WHERE kind = ? ORDER BY created_at DESC", (kind,)).fetchall()
        else:
            rows = db.execute("SELECT * FROM media ORDER BY created_at DESC").fetchall()
    return [dict(row) | {"stream_url": f"/api/media/{row['id']}", "artwork_url": f"/api/artwork/{row['id']}"} for row in rows]


@app.get("/api/search")
def search(q: str, _: None = Depends(require_token)) -> list[dict[str, Any]]:
    pattern = f"%{q}%"
    with connection() as db:
        rows = db.execute("SELECT * FROM media WHERE name LIKE ? OR title LIKE ? OR artist LIKE ? OR album LIKE ? OR language LIKE ? OR genre LIKE ? OR description LIKE ? ORDER BY created_at DESC", (pattern, pattern, pattern, pattern, pattern, pattern, pattern)).fetchall()
    return [dict(row) for row in rows]


@app.get("/api/metadata/lookup")
def lookup_upload_metadata(filename: str, kind: str, _: None = Depends(require_token)) -> dict[str, Any]:
    if kind not in {"music", "movie"}:
        raise HTTPException(status_code=400, detail="Metadata lookup supports music or movie files")
    safe_name = Path(filename.replace("\\", "/")).name
    if not safe_name or safe_name in {".", ".."}:
        raise HTTPException(status_code=400, detail="A file name is required")
    source = Path(safe_name)
    if kind == "music":
        stem = source.stem.replace(".", " ").replace("_", " ").strip()
        guessed_artist, separator, guessed_title = stem.partition(" - ")
        metadata: dict[str, str | None] = {
            "title": guessed_title.strip() if separator else stem,
            "artist": guessed_artist.strip() if separator else None,
            "album": None, "language": None, "genre": None, "description": None,
            "release_date": None, "external_id": None, "metadata_provider": None,
            "artwork_path": None, "dominant_color": None, "checksum": None, "duration": None,
        }
        remote = music_metadata_lookup(source, metadata, force_match=True)
    else:
        title, _, detected_type = clean_media_title(source)
        metadata = {
            "title": title, "artist": None, "album": None, "language": None,
            "genre": None, "description": None, "release_date": None,
            "external_id": None, "metadata_provider": None, "artwork_path": None,
            "dominant_color": None, "checksum": None, "duration": None,
            "media_type": detected_type or "movie",
        }
        remote = movie_metadata_lookup(source)
    artwork_url = remote.pop("_artwork_url", None)
    if artwork_url:
        parsed_artwork = urllib.parse.urlparse(artwork_url)
        if parsed_artwork.scheme == "http":
            artwork_url = parsed_artwork._replace(scheme="https").geturl()
    metadata.update({key: value for key, value in remote.items() if value is not None})
    metadata["artwork_url"] = artwork_url
    metadata["matched"] = bool(metadata.get("metadata_provider"))
    return metadata


@app.get("/api/artwork/{media_id}")
def artwork(media_id: int, _: None = Depends(require_token)) -> FileResponse:
    with connection() as db:
        row = db.execute("SELECT artwork_path FROM media WHERE id = ?", (media_id,)).fetchone()
    if not row or not row["artwork_path"]:
        raise HTTPException(status_code=404, detail="Artwork not found")
    path = ARTWORK_ROOT / row["artwork_path"]
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Artwork not found")
    return FileResponse(path, media_type="image/jpeg")


@app.get("/api/media/{media_id}/subtitles")
def subtitles(media_id: int, _: None = Depends(require_token)) -> list[dict[str, str]]:
    with connection() as db:
        row = db.execute("SELECT path FROM media WHERE id = ?", (media_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Media not found")
    source = MEDIA_ROOT / row["path"]
    return [{"language": sidecar.stem.rsplit(".", 1)[-1], "url": f"/api/subtitles/{media_id}/{sidecar.name}"} for sidecar in source.parent.glob(f"{source.stem}.*.srt")]


@app.get("/api/subtitles/{media_id}/{filename}")
def subtitle_file(media_id: int, filename: str, _: None = Depends(require_token)) -> FileResponse:
    with connection() as db:
        row = db.execute("SELECT path FROM media WHERE id = ?", (media_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Media not found")
    source = (MEDIA_ROOT / row["path"]).resolve()
    subtitle = (source.parent / Path(filename).name).resolve()
    if MEDIA_ROOT.resolve() not in subtitle.parents or not subtitle.is_file():
        raise HTTPException(status_code=404, detail="Subtitle not found")
    return FileResponse(subtitle, media_type="text/plain")


@app.post("/api/scan")
def scan(_: None = Depends(require_token)) -> dict[str, int]:
    return {"imported": scan_library()}


@app.get("/api/folders")
def folders(_: None = Depends(require_token)) -> list[dict[str, Any]]:
    with connection() as db:
        return [dict(row) for row in db.execute("SELECT * FROM folders ORDER BY name").fetchall()]


@app.post("/api/folders")
def create_folder(folder: FolderInput, _: None = Depends(require_token)) -> dict[str, Any]:
    safe_name = Path(folder.name.strip().replace("\\", "/")).name
    if not safe_name or safe_name in {".", ".."}:
        raise HTTPException(status_code=400, detail="Folder name is required")
    with connection() as db:
        parent_path = folder_path(db, folder.parent_id)
        if db.execute("SELECT 1 FROM folders WHERE parent_id IS ? AND name = ? LIMIT 1", (folder.parent_id, safe_name)).fetchone():
            raise HTTPException(status_code=409, detail="A folder with that name already exists")
        cursor = db.execute("INSERT INTO folders(name, parent_id, created_at) VALUES(?, ?, ?)", (safe_name, folder.parent_id, datetime.now(timezone.utc).isoformat()))
        db.commit()
        (IMPORT_ROOT / parent_path / safe_name).mkdir(parents=True, exist_ok=True)
        result = db.execute("SELECT * FROM folders WHERE id = ?", (cursor.lastrowid,)).fetchone()
    audit("folder.create", safe_name)
    return dict(result)


@app.patch("/api/folders/{folder_id}")
def update_folder(folder_id: int, update: FolderUpdate, _: None = Depends(require_token)) -> dict[str, Any]:
    changes = update.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail="No changes supplied")
    with connection() as db:
        folder = db.execute("SELECT * FROM folders WHERE id = ?", (folder_id,)).fetchone()
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")
        safe_name = Path(str(changes.get("name", folder["name"])).strip().replace("\\", "/")).name
        if not safe_name or safe_name in {".", ".."}:
            raise HTTPException(status_code=400, detail="Folder name is required")
        new_parent = changes.get("parent_id", folder["parent_id"])
        old_path = folder_path(db, folder_id)
        new_parent_path = folder_path(db, new_parent)
        if old_path == new_parent_path or old_path in new_parent_path.parents:
            raise HTTPException(status_code=400, detail="A folder cannot be moved inside itself")
        new_path = new_parent_path / safe_name
        if new_path != old_path:
            if db.execute("SELECT 1 FROM folders WHERE parent_id IS ? AND name = ? AND id != ? LIMIT 1", (new_parent, safe_name, folder_id)).fetchone():
                raise HTTPException(status_code=409, detail="A folder with that name already exists in the destination")
            moves = [(MEDIA_ROOT / old_path, MEDIA_ROOT / new_path), (IMPORT_ROOT / old_path, IMPORT_ROOT / new_path)]
            for source, target in moves:
                if source.exists() and target.exists() and source.resolve() != target.resolve():
                    raise HTTPException(status_code=409, detail="A folder with that name already exists in the destination")
            for source, target in moves:
                if source.exists() and source.resolve() != target.resolve():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    source.rename(target)
            old_prefix = old_path.as_posix()
            new_prefix = new_path.as_posix()
            matching = db.execute(
                "SELECT id, path FROM media WHERE path = ? OR substr(path, 1, ?) = ?",
                (old_prefix, len(old_prefix) + 1, f"{old_prefix}/"),
            ).fetchall()
            for media in matching:
                db.execute("UPDATE media SET path = ? WHERE id = ?", (new_prefix + media["path"][len(old_prefix):], media["id"]))
        changes["name"] = safe_name
        changes["parent_id"] = new_parent
        assignments = ", ".join(f"{key} = ?" for key in changes)
        db.execute(f"UPDATE folders SET {assignments} WHERE id = ?", (*changes.values(), folder_id))
        db.commit()
        result = db.execute("SELECT * FROM folders WHERE id = ?", (folder_id,)).fetchone()
    audit("folder.update", result["name"])
    return dict(result)


@app.delete("/api/folders/{folder_id}")
def delete_folder(folder_id: int, _: None = Depends(require_token)) -> dict[str, int]:
    with connection() as db:
        folder = db.execute("SELECT * FROM folders WHERE id = ?", (folder_id,)).fetchone()
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")
        relative_path = folder_path(db, folder_id)
        if db.execute("SELECT 1 FROM folders WHERE parent_id = ? LIMIT 1", (folder_id,)).fetchone() or db.execute("SELECT 1 FROM media WHERE folder_id = ? LIMIT 1", (folder_id,)).fetchone():
            raise HTTPException(status_code=409, detail="Folder must be empty before it can be deleted")
        directories = [IMPORT_ROOT / relative_path, MEDIA_ROOT / relative_path]
        if any(path.exists() and any(path.iterdir()) for path in directories):
            raise HTTPException(status_code=409, detail="Folder contains files that are not indexed yet")
        db.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
        db.commit()
    for path in directories:
        if path.exists():
            path.rmdir()
    audit("folder.delete", folder["name"])
    return {"deleted": folder_id}


@app.get("/api/playlists")
def playlists(_: None = Depends(require_token)) -> list[dict[str, Any]]:
    with connection() as db:
        return [dict(row) for row in db.execute("SELECT p.*, COUNT(i.media_id) AS items FROM playlists p LEFT JOIN playlist_items i ON p.id = i.playlist_id GROUP BY p.id ORDER BY p.name").fetchall()]


@app.get("/api/playlists/{playlist_id}")
def playlist_detail(playlist_id: int, _: None = Depends(require_token)) -> dict[str, Any]:
    with connection() as db:
        playlist = db.execute("SELECT * FROM playlists WHERE id = ?", (playlist_id,)).fetchone()
        if not playlist:
            raise HTTPException(status_code=404, detail="Playlist not found")
        tracks = db.execute("SELECT m.* FROM media m JOIN playlist_items i ON i.media_id = m.id WHERE i.playlist_id = ? ORDER BY i.position, m.title", (playlist_id,)).fetchall()
    return {"id": playlist["id"], "name": playlist["name"], "items": [dict(row) for row in tracks]}


@app.post("/api/playlists")
def create_playlist(playlist: PlaylistInput, _: None = Depends(require_token)) -> dict[str, Any]:
    name = playlist.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Playlist name is required")
    with connection() as db:
        cursor = db.execute("INSERT INTO playlists(name, created_at) VALUES(?, ?)", (name, datetime.now(timezone.utc).isoformat()))
        db.commit()
    audit("playlist.create", name)
    return {"id": cursor.lastrowid, "name": name}


@app.patch("/api/playlists/{playlist_id}")
def rename_playlist(playlist_id: int, playlist: PlaylistInput, _: None = Depends(require_token)) -> dict[str, Any]:
    name = playlist.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Playlist name is required")
    with connection() as db:
        cursor = db.execute("UPDATE playlists SET name = ? WHERE id = ?", (name, playlist_id))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Playlist not found")
        db.commit()
    audit("playlist.rename", name)
    return {"id": playlist_id, "name": name}


@app.delete("/api/playlists/{playlist_id}")
def delete_playlist(playlist_id: int, _: None = Depends(require_token)) -> dict[str, int]:
    with connection() as db:
        playlist = db.execute("SELECT name FROM playlists WHERE id = ?", (playlist_id,)).fetchone()
        if not playlist:
            raise HTTPException(status_code=404, detail="Playlist not found")
        db.execute("DELETE FROM playlist_items WHERE playlist_id = ?", (playlist_id,))
        db.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
        db.commit()
    audit("playlist.delete", playlist["name"])
    return {"deleted": playlist_id}


@app.put("/api/playlists/{playlist_id}/items")
def set_playlist_items(playlist_id: int, payload: PlaylistItemsInput, _: None = Depends(require_token)) -> dict[str, Any]:
    media_ids = list(dict.fromkeys(payload.media_ids))
    with connection() as db:
        playlist = db.execute("SELECT name FROM playlists WHERE id = ?", (playlist_id,)).fetchone()
        if not playlist:
            raise HTTPException(status_code=404, detail="Playlist not found")
        valid = {row["id"] for row in db.execute("SELECT id FROM media WHERE id IN ({}) AND kind = 'music'".format(",".join("?" for _ in media_ids) or "NULL"), media_ids).fetchall()} if media_ids else set()
        if len(valid) != len(media_ids):
            raise HTTPException(status_code=400, detail="Playlists can contain music items only")
        db.execute("DELETE FROM playlist_items WHERE playlist_id = ?", (playlist_id,))
        db.executemany("INSERT INTO playlist_items(playlist_id, media_id, position) VALUES(?, ?, ?)", [(playlist_id, media_id, index) for index, media_id in enumerate(media_ids)])
        db.commit()
    audit("playlist.update", playlist["name"])
    return {"id": playlist_id, "items": len(media_ids)}


@app.post("/api/favorites/{media_id}")
def favorite(media_id: int, _: None = Depends(require_token)) -> dict[str, int]:
    with connection() as db:
        db.execute("INSERT OR IGNORE INTO favorites(media_id, created_at) VALUES(?, ?)", (media_id, datetime.now(timezone.utc).isoformat()))
        db.commit()
    return {"media_id": media_id}


@app.delete("/api/favorites/{media_id}")
def unfavorite(media_id: int, _: None = Depends(require_token)) -> dict[str, int]:
    with connection() as db:
        db.execute("DELETE FROM favorites WHERE media_id = ?", (media_id,))
        db.commit()
    return {"media_id": media_id}


@app.get("/api/favorites")
def favorites(_: None = Depends(require_token)) -> list[dict[str, Any]]:
    with connection() as db:
        return [dict(row) for row in db.execute("SELECT m.* FROM media m JOIN favorites f ON f.media_id = m.id ORDER BY f.created_at DESC").fetchall()]


@app.post("/api/upload")
def upload(
    file: UploadFile = File(...),
    artwork: UploadFile | None = File(default=None),
    folder_id: int | None = Query(default=None),
    metadata_confirmed: bool = Form(default=False),
    title: str | None = Form(default=None),
    artist: str | None = Form(default=None),
    album: str | None = Form(default=None),
    language: str | None = Form(default=None),
    genre: str | None = Form(default=None),
    description: str | None = Form(default=None),
    release_date: str | None = Form(default=None),
    media_type: str | None = Form(default=None),
    external_id: str | None = Form(default=None),
    metadata_provider: str | None = Form(default=None),
    edited_fields: str = Form(default="[]"),
    artwork_url: str | None = Form(default=None),
    _: None = Depends(require_token),
) -> dict[str, str]:
    safe_name = Path((file.filename or "upload.bin").replace("\\", "/")).name
    if not safe_name or safe_name in {".", ".."}:
        raise HTTPException(status_code=400, detail="File name is required")
    with connection() as db:
        relative_path = folder_path(db, folder_id) / safe_name
        destination = IMPORT_ROOT / relative_path
    indexed_destination = MEDIA_ROOT / relative_path
    if destination.exists() or indexed_destination.exists():
        raise HTTPException(status_code=409, detail="A file with that name already exists in the destination")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as output:
        copied = 0
        while chunk := file.file.read(1024 * 1024):
            copied += len(chunk)
            if copied > MAX_UPLOAD_BYTES:
                destination.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="Upload exceeds storage limit")
            output.write(chunk)
    scan_library(enrich_external=not metadata_confirmed)
    if metadata_confirmed:
        with connection() as db:
            row = db.execute("SELECT id, checksum FROM media WHERE path = ?", (relative_path.as_posix(),)).fetchone()
            if row:
                changes: dict[str, Any] = {}
                try:
                    edited = {value for value in json.loads(edited_fields) if isinstance(value, str)}
                except (TypeError, ValueError):
                    edited = set()
                provider_match = bool(metadata_provider and metadata_provider.strip() and metadata_provider != "manual")
                for key, value in (("title", title), ("artist", artist), ("album", album), ("language", language), ("genre", genre), ("description", description), ("release_date", release_date), ("external_id", external_id)):
                    if key in edited or (provider_match and value and value.strip()):
                        changes[key] = value.strip() or None if value else None
                if media_type in {"movie", "show"} and media_kind(Path(safe_name)) == "movie":
                    changes["media_type"] = media_type
                changes["metadata_provider"] = metadata_provider.strip() if metadata_provider and metadata_provider.strip() else "manual"
                if provider_match:
                    changes["metadata_checked_at"] = datetime.now(timezone.utc).isoformat()
                artwork_bytes = artwork.file.read(15 * 1024 * 1024 + 1) if artwork else b""
                if artwork_bytes:
                    if len(artwork_bytes) > 15 * 1024 * 1024:
                        raise HTTPException(status_code=413, detail="Artwork upload exceeds 15 MB")
                    art_path, dominant_color = persist_artwork_bytes(artwork_bytes, row["checksum"])
                    if art_path:
                        changes["artwork_path"] = art_path
                        changes["dominant_color"] = dominant_color
                elif artwork_url:
                    art_path, dominant_color = persist_artwork(artwork_url, row["checksum"])
                    if art_path:
                        changes["artwork_path"] = art_path
                        changes["dominant_color"] = dominant_color
                if changes:
                    db.execute(f"UPDATE media SET {', '.join(f'{key} = ?' for key in changes)} WHERE id = ?", (*changes.values(), row["id"]))
                    db.commit()
    audit("upload.create", safe_name)
    return {"status": "indexed", "name": safe_name}


@app.post("/api/uploads")
def create_upload(name: str, total: int, _: None = Depends(require_token)) -> dict[str, Any]:
    upload_id = secrets.token_urlsafe(16)
    path = IMPORT_ROOT / f"{upload_id}-{Path(name).name}"
    with connection() as db:
        db.execute("INSERT INTO upload_sessions(id, name, total, path, created_at) VALUES(?, ?, ?, ?, ?)", (upload_id, Path(name).name, total, str(path), datetime.now(timezone.utc).isoformat()))
        db.commit()
    return {"id": upload_id, "received": 0, "total": total}


@app.patch("/api/uploads/{upload_id}")
def append_upload(upload_id: str, chunk: UploadFile = File(...), _: None = Depends(require_token)) -> dict[str, Any]:
    with connection() as db:
        session = db.execute("SELECT * FROM upload_sessions WHERE id = ?", (upload_id,)).fetchone()
    if not session:
        raise HTTPException(status_code=404, detail="Upload session not found")
    with Path(session["path"]).open("ab") as output:
        shutil.copyfileobj(chunk.file, output)
    received = Path(session["path"]).stat().st_size
    if received > MAX_UPLOAD_BYTES:
        Path(session["path"]).unlink(missing_ok=True)
        raise HTTPException(status_code=413, detail="Upload exceeds storage limit")
    with connection() as db:
        db.execute("UPDATE upload_sessions SET received = ? WHERE id = ?", (received, upload_id))
        db.commit()
    return {"id": upload_id, "received": received, "total": session["total"], "complete": received >= session["total"]}


@app.get("/api/media/{media_id}")
def stream(media_id: int, _: None = Depends(require_token)) -> FileResponse:
    with connection() as db:
        row = db.execute("SELECT * FROM media WHERE id = ?", (media_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Media not found")
    path = (MEDIA_ROOT / row["path"]).resolve()
    if MEDIA_ROOT.resolve() not in path.parents or not path.is_file():
        raise HTTPException(status_code=404, detail="Media file not found")
    return FileResponse(path, media_type=row["mime"] or "application/octet-stream")


@app.patch("/api/media/{media_id}")
def update_media(media_id: int, update: MediaUpdate, _: None = Depends(require_token)) -> dict[str, Any]:
    changes = update.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail="No changes supplied")
    with connection() as db:
        row = db.execute("SELECT * FROM media WHERE id = ?", (media_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Media not found")
        if "media_type" in changes and (row["kind"] != "movie" or changes["media_type"] not in {"movie", "show"}):
            raise HTTPException(status_code=400, detail="Media type must be movie or show for video files")
        if "name" in changes or "folder_id" in changes:
            safe_name = Path(str(changes.get("name", row["name"])).replace("\\", "/")).name.strip()
            if not safe_name or safe_name in {".", ".."}:
                raise HTTPException(status_code=400, detail="File name is required")
            folder_id = changes.get("folder_id", row["folder_id"])
            relative_folder = folder_path(db, folder_id) if folder_id is not None else Path()
            source = (MEDIA_ROOT / row["path"]).resolve()
            target_directory = (MEDIA_ROOT / relative_folder).resolve()
            root = MEDIA_ROOT.resolve()
            if target_directory != root and root not in target_directory.parents:
                raise HTTPException(status_code=400, detail="Invalid destination folder")
            target = target_directory / safe_name
            if root not in target.resolve().parents:
                raise HTTPException(status_code=400, detail="Invalid filename")
            if target.exists() and target.resolve() != source:
                raise HTTPException(status_code=409, detail="A file with that name already exists in the destination")
            target.parent.mkdir(parents=True, exist_ok=True)
            if source != target.resolve():
                source.rename(target)
            changes["name"] = safe_name
            changes["path"] = str(target.resolve().relative_to(root))
            changes["folder_id"] = folder_id
        assignments = ", ".join(f"{key} = ?" for key in changes)
        db.execute(f"UPDATE media SET {assignments} WHERE id = ?", (*changes.values(), media_id))
        db.commit()
        result = db.execute("SELECT * FROM media WHERE id = ?", (media_id,)).fetchone()
    audit("media.update", result["name"])
    return dict(result)


@app.delete("/api/media/{media_id}")
def delete_media(media_id: int, _: None = Depends(require_token)) -> dict[str, int]:
    with connection() as db:
        row = db.execute("SELECT path FROM media WHERE id = ?", (media_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Media not found")
        path = (MEDIA_ROOT / row["path"]).resolve()
        if MEDIA_ROOT.resolve() in path.parents and path.is_file():
            path.unlink()
        db.execute("DELETE FROM media WHERE id = ?", (media_id,))
        db.execute("DELETE FROM playlist_items WHERE media_id = ?", (media_id,))
        db.execute("DELETE FROM favorites WHERE media_id = ?", (media_id,))
        db.execute("DELETE FROM progress WHERE media_id = ?", (media_id,))
        db.commit()
    audit("media.delete", row["path"])
    return {"deleted": media_id}


@app.get("/api/progress/{media_id}")
def get_progress(media_id: int, _: None = Depends(require_token)) -> dict[str, float]:
    with connection() as db:
        row = db.execute("SELECT position FROM progress WHERE media_id = ?", (media_id,)).fetchone()
    return {"position": row["position"] if row else 0}


@app.put("/api/progress/{media_id}")
def save_progress(media_id: int, progress: ProgressUpdate, _: None = Depends(require_token)) -> dict[str, float]:
    with connection() as db:
        db.execute("INSERT INTO progress(media_id, position, updated_at) VALUES(?, ?, ?) ON CONFLICT(media_id) DO UPDATE SET position = excluded.position, updated_at = excluded.updated_at", (media_id, max(0, progress.position), datetime.now(timezone.utc).isoformat()))
        db.commit()
    return {"position": max(0, progress.position)}


@app.get("/api/stats")
def stats(_: None = Depends(require_token)) -> dict[str, int]:
    with connection() as db:
        row = db.execute("SELECT COUNT(*) AS items, COALESCE(SUM(size), 0) AS bytes FROM media").fetchone()
    usage = shutil.disk_usage(MEDIA_ROOT)
    return {"items": row["items"], "bytes": row["bytes"], "free_bytes": usage.free, "total_bytes": usage.total}


@app.get("/api/audit")
def audit_events(limit: int = Query(default=20, ge=1, le=100), _: None = Depends(require_token)) -> list[dict[str, Any]]:
    with connection() as db:
        rows = db.execute("SELECT id, action, subject, created_at FROM audit_events ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/backup")
def backup(_: None = Depends(require_token)) -> dict[str, str]:
    backup_root = MEDIA_ROOT.parent / "backups"
    backup_root.mkdir(parents=True, exist_ok=True)
    destination = backup_root / f"nas-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.db"
    with connection() as source, sqlite3.connect(destination) as target:
        source.backup(target)
    audit("database.backup", destination.name)
    return {"path": str(destination.relative_to(MEDIA_ROOT.parent))}
