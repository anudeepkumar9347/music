declare const process: {
  env: {
    EXPO_PUBLIC_API_URL?: string;
    EXPO_PUBLIC_API_TOKEN?: string;
  };
};

export type DriveMedia = {
  id: number;
  name: string;
  kind: 'music' | 'movie' | 'file';
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  folder_id?: number | null;
  size: number;
  mime?: string | null;
  created_at?: string | null;
};

export type DriveFolder = {
  id: number;
  name: string;
  parent_id: number | null;
};

export type DriveStats = {
  items: number;
  bytes: number;
  free_bytes: number;
  total_bytes: number;
};

const API_URL = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '') || 'http://127.0.0.1:8000';
const API_TOKEN = process.env.EXPO_PUBLIC_API_TOKEN?.trim() || 'orbit-local-dev-token';

export class DriveApi {
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set('Accept', 'application/json');
    headers.set('Authorization', `Bearer ${API_TOKEN}`);
    const response = await fetch(`${API_URL}${path}`, { ...options, headers });
    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json() as { detail?: string; error?: string };
        detail = body.detail || body.error || '';
      } catch {
        // Use the status when the server did not return JSON.
      }
      throw new Error(detail || `NAS server returned ${response.status}`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  library() { return this.request<DriveMedia[]>('/api/library'); }
  folders() { return this.request<DriveFolder[]>('/api/folders'); }
  favorites() { return this.request<DriveMedia[]>('/api/favorites'); }
  stats() { return this.request<DriveStats>('/api/stats'); }
  search(query: string) { return this.request<DriveMedia[]>(`/api/search?q=${encodeURIComponent(query)}`); }
  streamUrl(item: DriveMedia) { return `${API_URL}/api/media/${item.id}?token=${encodeURIComponent(API_TOKEN)}`; }

  createFolder(name: string, parentId: number | null) {
    return this.request<DriveFolder>('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parent_id: parentId }),
    });
  }

  rename(target: DriveMedia | DriveFolder, name: string) {
    const path = 'kind' in target ? `/api/media/${target.id}` : `/api/folders/${target.id}`;
    return this.request(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  }

  remove(target: DriveMedia | DriveFolder) {
    const path = 'kind' in target ? `/api/media/${target.id}` : `/api/folders/${target.id}`;
    return this.request(path, { method: 'DELETE' });
  }

  setFavorite(item: DriveMedia, favorite: boolean) {
    return this.request(`/api/favorites/${item.id}`, { method: favorite ? 'POST' : 'DELETE' });
  }

  upload(form: FormData, folderId: number | null) {
    const query = folderId == null ? '' : `?folder_id=${folderId}`;
    return this.request<{ status: string; name: string }>(`/api/upload${query}`, { method: 'POST', body: form });
  }
}

export const driveApi = new DriveApi();

export function mediaCategory(item: DriveMedia): string {
  return item.kind === 'music' ? 'Audio' : item.kind === 'movie' ? 'Video' : 'File';
}

export function formatDriveBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / 1024 ** index;
  return `${amount >= 100 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}
