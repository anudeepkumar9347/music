declare const process: {
  env: { EXPO_PUBLIC_API_TOKEN?: string };
};

export type ApiConfig = { url: string };

export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId?: string;
  duration: number;
  coverArt?: string;
  streamUrl?: string;
  genre?: string;
  track?: number;
  year?: number;
};

export type Album = {
  id: string;
  name: string;
  artist: string;
  coverArt?: string;
  year?: number;
  songCount?: number;
};

export type Playlist = {
  id: string;
  name: string;
  description?: string;
  coverArt?: string;
  updatedAt: string;
  tracks: Track[];
};

type NasMedia = {
  id: number | string;
  kind: string;
  name: string;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  duration?: number | string | null;
  artwork_url?: string | null;
  artwork_path?: string | null;
  genre?: string | null;
  language?: string | null;
  release_date?: string | null;
  created_at?: string | null;
};

const TOKEN = process.env.EXPO_PUBLIC_API_TOKEN?.trim() || 'orbit-local-dev-token';

export class MusicApi {
  private readonly baseUrl: string;
  private libraryCache: Promise<NasMedia[]> | null = null;

  constructor(config: ApiConfig) {
    this.baseUrl = config.url.trim().replace(/\/+$/, '');
  }

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set('Accept', 'application/json');
    headers.set('Authorization', `Bearer ${TOKEN}`);
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (!response.ok) {
      let detail = '';
      try {
        const body = (await response.json()) as { detail?: string; error?: string };
        detail = body.detail ?? body.error ?? '';
      } catch {
        // Keep the status code for non-JSON errors.
      }
      throw new Error(detail || `NAS server returned ${response.status}`);
    }
    return (await response.json()) as T;
  }

  async ping(): Promise<void> {
    await this.request<{ status: string }>('/health');
  }

  async albums(size = 40): Promise<Album[]> {
    const tracks = await this.loadMusicLibrary();
    const groups = new Map<string, Album>();
    for (const track of tracks) {
      const artist = track.artist || 'Unknown artist';
      const name = track.album || 'Unknown album';
      const id = this.albumKey(artist, name);
      const current = groups.get(id);
      if (current) {
        current.songCount = (current.songCount || 0) + 1;
        const cover = this.coverPath(track);
        if (!current.coverArt && cover) current.coverArt = this.protectedUrl(cover);
      } else {
        groups.set(id, {
          id,
          name,
          artist,
          coverArt: this.coverPath(track) ? this.protectedUrl(this.coverPath(track)!) : undefined,
          songCount: 1,
        });
      }
    }
    return [...groups.values()].slice(0, size);
  }

  async albumTracks(albumId: string): Promise<Track[]> {
    const tracks = await this.loadMusicLibrary();
    return tracks.filter(track => this.albumKey(track.artist || 'Unknown artist', track.album || 'Unknown album') === albumId).map(track => this.toTrack(track));
  }

  async search(query: string): Promise<Track[]> {
    if (!query.trim()) return [];
    const tracks = await this.request<NasMedia[]>(`/api/search?q=${encodeURIComponent(query)}`);
    return tracks.filter(track => track.kind === 'music').map(track => this.toTrack(track));
  }

  async favorites(): Promise<Track[]> {
    const tracks = await this.request<NasMedia[]>('/api/favorites');
    return tracks.filter(track => track.kind === 'music').map(track => this.toTrack(track));
  }

  async setFavorite(id: string, liked: boolean): Promise<void> {
    await this.request(`/api/favorites/${encodeURIComponent(id)}`, { method: liked ? 'POST' : 'DELETE' });
  }

  streamUrl(track: Track): string {
    return this.protectedUrl(`/api/media/${encodeURIComponent(track.id)}`);
  }

  coverUrl(coverArt: string): string {
    return this.protectedUrl(coverArt);
  }

  private toTrack(item: NasMedia): Track {
    const artist = item.artist || 'Unknown artist';
    const album = item.album || 'Unknown album';
    return {
      id: String(item.id),
      title: item.title || item.name.replace(/\.[^.]+$/, ''),
      artist,
      album,
      albumId: this.albumKey(artist, album),
      duration: Number(item.duration) || 0,
      coverArt: this.coverPath(item) ? this.protectedUrl(this.coverPath(item)!) : undefined,
      streamUrl: this.protectedUrl(`/api/media/${encodeURIComponent(item.id)}`),
      genre: item.genre || undefined,
      year: item.release_date ? Number(item.release_date.slice(0, 4)) || undefined : undefined,
    };
  }

  private albumKey(artist: string, album: string) {
    return encodeURIComponent(JSON.stringify([artist, album]));
  }

  private loadMusicLibrary() {
    if (!this.libraryCache) {
      this.libraryCache = this.request<NasMedia[]>('/api/library?kind=music').catch(error => {
        this.libraryCache = null;
        throw error;
      });
    }
    return this.libraryCache;
  }

  private coverPath(item: NasMedia) {
    return item.artwork_url || (item.artwork_path ? `/api/artwork/${encodeURIComponent(item.id)}` : undefined);
  }

  private protectedUrl(path: string) {
    const url = /^https?:\/\//i.test(path) ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(TOKEN)}`;
  }
}
