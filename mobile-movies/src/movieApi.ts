export type MediaKind = 'movie' | 'show';

export type MediaItem = {
  id: string;
  type: MediaKind;
  title: string;
  synopsis?: string;
  posterUrl?: string;
  backdropUrl?: string;
  streamUrl?: string;
  year?: number;
  rating?: string;
  genres: string[];
  duration?: number;
  language?: string;
  releaseDate?: string;
};

export type ApiConfig = { url: string };

declare const process: { env: { EXPO_PUBLIC_API_TOKEN?: string } };

const TOKEN = process.env.EXPO_PUBLIC_API_TOKEN?.trim() || 'orbit-local-dev-token';

type JsonObject = Record<string, unknown>;

const ROUTES = {
  health: '/health',
  library: '/api/library',
  search: '/api/search',
  favorites: '/api/favorites',
};

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function asString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function asNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && !!item.trim());
}

function listFrom(data: unknown, keys: string[]): unknown[] {
  if (Array.isArray(data)) return data;
  const object = asObject(data);
  for (const key of keys) {
    if (Array.isArray(object[key])) return object[key] as unknown[];
  }
  return [];
}

export class MovieApi {
  readonly baseUrl: string;

  constructor(config: ApiConfig) {
    this.baseUrl = config.url.trim().replace(/\/+$/, '');
  }

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set('Accept', 'application/json');
    headers.set('Authorization', `Bearer ${TOKEN}`);
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
    if (!response.ok) {
      let detail = '';
      try {
        const body = asObject(await response.json());
        detail = asString(body.detail, body.error, body.message) ?? '';
      } catch {
        detail = '';
      }
      throw new Error(detail || `Movie server returned ${response.status}`);
    }
    return await response.json() as T;
  }

  async ping(): Promise<void> {
    await this.request(ROUTES.health);
  }

  async movies(limit = 100): Promise<MediaItem[]> {
    const data = await this.request<unknown>(`${ROUTES.library}?kind=movie&limit=${limit}`);
    return listFrom(data, ['movies', 'items', 'results']).map((item) => this.normalize(item, 'movie'));
  }

  async shows(limit = 100): Promise<MediaItem[]> {
    const data = await this.request<unknown>(`${ROUTES.library}?kind=show&limit=${limit}`);
    return listFrom(data, ['shows', 'items', 'results']).map((item) => this.normalize(item, 'show'));
  }

  async search(query: string): Promise<MediaItem[]> {
    const data = await this.request<unknown>(`${ROUTES.search}?q=${encodeURIComponent(query)}`);
    return listFrom(data, ['items', 'results', 'media']).filter((item) => asObject(item).kind === 'movie').map((item) => {
      const record = asObject(item);
      return this.normalize(item, asString(record.media_type) === 'show' ? 'show' : 'movie');
    });
  }

  async detail(type: MediaKind, id: string): Promise<MediaItem> {
    const records = await this.request<unknown>(`${ROUTES.library}?kind=${type}`);
    const item = listFrom(records, ['items', 'results']).find((value) => String(asObject(value).id) === String(id));
    if (!item) throw new Error('Media item not found');
    return this.normalize(item, type);
  }

  async favorites(): Promise<MediaItem[]> {
    const data = await this.request<unknown>(ROUTES.favorites);
    return listFrom(data, ['items', 'media', 'favorites', 'movies', 'shows', 'results']).filter((item) => asObject(item).kind === 'movie').map((item) => {
      const record = asObject(item);
      return this.normalize(item, asString(record.media_type) === 'show' ? 'show' : 'movie');
    });
  }

  async setFavorite(item: MediaItem, favorite: boolean): Promise<void> {
    const method = favorite ? 'POST' : 'DELETE';
    await this.request(
      `${ROUTES.favorites}/${encodeURIComponent(item.id)}`,
      { method },
    );
  }

  streamUrl(item: MediaItem): string {
    return item.streamUrl ?? this.protectedUrl(`/api/media/${encodeURIComponent(item.id)}`);
  }

  normalize(value: unknown, type: MediaKind): MediaItem {
    const object = asObject(value);
    const title = asString(object.title, object.name, object.label) ?? 'Untitled';
    const rawGenres = object.genres ?? object.genre;
    const genres = typeof rawGenres === 'string'
      ? rawGenres.split(',').map((genre) => genre.trim()).filter(Boolean)
      : asStrings(rawGenres);
    const poster = asString(object.posterUrl, object.poster, object.coverArt, object.cover, object.artwork_url, object.artwork_path ? `/api/artwork/${asString(object.id)}` : undefined);
    const backdrop = asString(object.backdropUrl, object.backdrop, object.backgroundImage);
    const stream = asString(object.streamUrl, object.videoUrl, object.playbackUrl);
    const releaseDate = asString(object.release_date, object.releaseDate);
    const releaseYear = releaseDate ? Number(releaseDate.slice(0, 4)) : undefined;
    const resolvedType: MediaKind = asString(object.media_type) === 'show' ? 'show' : type;

    return {
      id: asString(object.id, object.slug) ?? title,
      type: resolvedType,
      title,
      synopsis: asString(object.synopsis, object.description, object.overview),
      posterUrl: poster ? this.protectedUrl(poster) : undefined,
      backdropUrl: backdrop ? this.protectedUrl(backdrop) : undefined,
      streamUrl: stream ? this.protectedUrl(stream) : undefined,
      year: asNumber(object.year, object.releaseYear) ?? (Number.isFinite(releaseYear) && releaseYear ? releaseYear : undefined),
      rating: asString(object.rating, object.contentRating),
      genres,
      duration: asNumber(object.duration, object.runtime),
      language: asString(object.language),
      releaseDate,
    };
  }

  private protectedUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    const url = `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(TOKEN)}`;
  }
}
