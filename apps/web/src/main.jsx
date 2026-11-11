import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, ArrowDownToLine, ArrowLeft, AudioLines, Check, ChevronRight, CircleHelp, Cloud,
  Database, Film, File, FileAudio, FileImage, FileVideo, Folder, FolderPlus, HardDrive,
  LayoutDashboard, ListFilter, LoaderCircle, MoreHorizontal, Moon, Pencil, Plus,
  RefreshCw, Search, Settings2, ShieldCheck, Sun, Trash2, Upload, X, ListMusic, Languages,
} from 'lucide-react';
import './styles.css';

const DEV_TOKEN = import.meta.env.VITE_API_TOKEN || 'orbit-local-dev-token';
const ENV_API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const getToken = () => localStorage.getItem('orbit-api-token') || DEV_TOKEN;
const getApiBaseUrl = () => (localStorage.getItem('orbit-api-url') ?? ENV_API_URL).replace(/\/+$/, '');
const apiUrl = path => `${getApiBaseUrl()}${path}`;
const api = async (path, options = {}) => {
  const savedToken = localStorage.getItem('orbit-api-token');
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${savedToken || DEV_TOKEN}`);
  if (!(options.body instanceof FormData)) headers.set('Accept', 'application/json');
  let response = await fetch(apiUrl(path), { ...options, headers });
  if (response.status === 401 && savedToken && savedToken !== DEV_TOKEN && !options.body) {
    const fallbackHeaders = new Headers(headers);
    fallbackHeaders.set('Authorization', `Bearer ${DEV_TOKEN}`);
    const fallbackResponse = await fetch(apiUrl(path), { ...options, headers: fallbackHeaders });
    if (fallbackResponse.ok) {
      localStorage.removeItem('orbit-api-token');
      response = fallbackResponse;
    }
  }
  if (!response.ok) {
    let detail = '';
    try { const body = await response.json(); detail = body.detail || body.error || ''; } catch { /* use status */ }
    throw new Error(detail || `NAS server returned ${response.status}`);
  }
  return response.status === 204 ? undefined : response.json();
};
const uploadWithProgress = (path, body, onProgress) => new Promise((resolve, reject) => {
  const request = new XMLHttpRequest();
  request.open('POST', apiUrl(path));
  request.setRequestHeader('Authorization', `Bearer ${getToken()}`);
  request.setRequestHeader('Accept', 'application/json');
  request.upload.onprogress = event => {
    if (event.lengthComputable) onProgress(Math.min(100, event.loaded / event.total * 100));
  };
  request.onerror = () => reject(new Error('Network error while uploading.'));
  request.onabort = () => reject(new Error('Upload was cancelled.'));
  request.onload = () => {
    let response;
    try { response = request.responseText ? JSON.parse(request.responseText) : undefined; }
    catch { reject(new Error('NAS server returned an invalid upload response.')); return; }
    if (request.status < 200 || request.status >= 300) {
      reject(new Error(response?.detail || response?.error || `NAS server returned ${request.status}`));
      return;
    }
    resolve(response);
  };
  request.send(body);
});

const bytes = value => {
  const size = Number(value) || 0;
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)) - 1, units.length - 1);
  return `${(size / 1024 ** (index + 1)).toFixed(index > 0 && size / 1024 ** (index + 1) < 10 ? 1 : 0)} ${units[index]}`;
};
const dateLabel = value => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : '—';
const extension = name => String(name || '').split('.').pop()?.toUpperCase() || 'FILE';
const pageMeta = {
  overview: { title: 'Overview', eyebrow: 'YOUR PRIVATE CLOUD', description: 'A clear view of everything stored on your NAS.' },
  drive: { title: 'Drive', eyebrow: 'FILES & FOLDERS', description: 'Manage documents and everything outside your media libraries.' },
  music: { title: 'Music', eyebrow: 'AUDIO LIBRARY', description: 'Upload, organize, and play music from your server.' },
  movies: { title: 'Movies', eyebrow: 'VIDEO LIBRARY', description: 'Keep your films and shows ready to stream.' },
};

function App() {
  const [section, setSection] = useState('overview');
  const [items, setItems] = useState([]);
  const [folders, setFolders] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [playlistContents, setPlaylistContents] = useState([]);
  const [activePlaylist, setActivePlaylist] = useState('');
  const [playlistPicker, setPlaylistPicker] = useState(null);
  const [playlistChoice, setPlaylistChoice] = useState('');
  const [languageFilter, setLanguageFilter] = useState('');
  const [genreFilter, setGenreFilter] = useState('');
  const [movieTypeFilter, setMovieTypeFilter] = useState('all');
  const [driveLayout, setDriveLayout] = useState('grid');
  const [stats, setStats] = useState(null);
  const [systemMetrics, setSystemMetrics] = useState(null);
  const [metricsRange, setMetricsRange] = useState(6);
  const [audit, setAudit] = useState([]);
  const [folderId, setFolderId] = useState(null);
  const [folderTrail, setFolderTrail] = useState([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [searchItems, setSearchItems] = useState(null);
  const [selected, setSelected] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState({});
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadQueue, setUploadQueue] = useState([]);
  const [uploadIndex, setUploadIndex] = useState(0);
  const [uploadForm, setUploadForm] = useState(null);
  const [uploadLookupBusy, setUploadLookupBusy] = useState(false);
  const [uploadLookupMessage, setUploadLookupMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('orbit-theme') || 'dark');
  const [tokenDraft, setTokenDraft] = useState(getToken());
  const [apiUrlDraft, setApiUrlDraft] = useState(getApiBaseUrl());

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true); else setBusy(true);
    setError('');
    try {
      const [nextItems, nextFolders, nextStats, nextPlaylists] = await Promise.all([
        api('/api/library'), api('/api/folders'), api('/api/stats'), api('/api/playlists'),
      ]);
      setItems(nextItems); setFolders(nextFolders); setStats(nextStats); setPlaylists(nextPlaylists);
      if (section === 'overview') {
        const log = await api('/api/audit?limit=8').catch(() => []);
        setAudit(log);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect to the NAS.');
    } finally { setBusy(false); setRefreshing(false); }
  }, [section]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (section !== 'overview') return undefined;
    let active = true;
    const refreshMetrics = () => {
      api(`/api/system/metrics?range_hours=${metricsRange}`)
        .then(result => { if (active) setSystemMetrics(result); })
        .catch(() => { if (active) setSystemMetrics(null); });
    };
    refreshMetrics();
    const timer = window.setInterval(refreshMetrics, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [section, metricsRange]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('orbit-theme', theme);
  }, [theme]);
  useEffect(() => {
    setFolderId(null); setFolderTrail([]); setQuery(''); setSearchItems(null); setActivePlaylist(''); setLanguageFilter(''); setGenreFilter(''); setMovieTypeFilter('all');
  }, [section]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setSearchItems(null); return undefined; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api(`/api/search?q=${encodeURIComponent(term)}`).then(result => {
        if (!cancelled) setSearchItems(result);
      }).catch(cause => { if (!cancelled) setError(cause.message); });
    }, 240);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query]);

  const currentFolder = folders.find(folder => folder.id === folderId) || null;
  const currentUpload = uploadQueue[uploadIndex] || null;
  const driveFiles = useMemo(() => items.filter(item => item.kind === 'file'), [items]);
  const sectionItems = useMemo(() => {
    const kind = section === 'music' ? 'music' : section === 'movies' ? 'movie' : 'file';
    const source = searchItems || items;
    let filtered = source.filter(item => (section === 'drive' ? item.kind === 'file' : item.kind === kind) && (section !== 'drive' || (item.folder_id ?? null) === folderId));
    if (section === 'music' && activePlaylist) filtered = playlistContents;
    if (section === 'movies' && movieTypeFilter !== 'all') filtered = filtered.filter(item => (item.media_type || 'movie') === movieTypeFilter);
    if (languageFilter) filtered = filtered.filter(item => item.language === languageFilter);
    if (genreFilter) filtered = filtered.filter(item => item.genre === genreFilter);
    return filtered;
  }, [activePlaylist, folderId, genreFilter, items, languageFilter, movieTypeFilter, playlistContents, searchItems, section]);
  const visibleItems = useMemo(() => {
    const matched = sectionItems.filter(item => !query.trim() || searchItems || `${item.name} ${item.title || ''} ${item.artist || ''} ${item.album || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    return [...matched].sort((a, b) => sort === 'name' ? (a.title || a.name).localeCompare(b.title || b.name) : sort === 'size' ? (b.size || 0) - (a.size || 0) : String(b.created_at || '').localeCompare(String(a.created_at || '')));
  }, [query, searchItems, sectionItems, sort]);
  const visibleFolders = section === 'drive' ? folders.filter(folder => folder.parent_id === folderId && (!query.trim() || folder.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))) : [];
  const languages = useMemo(() => [...new Set(items.filter(item => section === 'music' ? item.kind === 'music' : item.kind === 'movie').map(item => item.language).filter(Boolean))].sort(), [items, section]);
  const genres = useMemo(() => [...new Set(items.filter(item => section === 'music' ? item.kind === 'music' : item.kind === 'movie').map(item => item.genre).filter(Boolean))].sort(), [items, section]);
  const categoryCounts = useMemo(() => ({
    drive: items.filter(item => item.kind === 'file').length,
    music: items.filter(item => item.kind === 'music').length,
    movies: items.filter(item => item.kind === 'movie').length,
  }), [items]);

  const flash = (text, type = 'success') => { setNotice({ text, type }); window.setTimeout(() => setNotice(null), 4200); };
  const navigate = key => { setSection(key); setSelected(null); };
  const openFolder = folder => {
    setFolderId(folder.id);
    setFolderTrail(previous => [...previous, folder]);
    setQuery(''); setSearchItems(null);
  };
  const goToTrail = index => {
    const next = folderTrail.slice(0, index + 1);
    setFolderTrail(next); setFolderId(next.at(-1)?.id ?? null); setQuery('');
  };

  async function upload(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setBusy(true); setError(''); setUploadProgress(`Uploading 0 of ${files.length}`);
    let uploaded = 0;
    try {
      for (const file of files) {
        const label = `Uploading ${uploaded + 1} of ${files.length}: ${file.name}`;
        setUploadProgress(`${label} · 0%`); setUploadPercent(0);
        const data = new FormData(); data.append('file', file);
        const destination = section === 'drive' && folderId ? `?folder_id=${folderId}` : '';
        await uploadWithProgress(`/api/upload${destination}`, data, percent => {
          setUploadPercent(percent); setUploadProgress(`${label} · ${Math.floor(percent)}%`);
        });
        uploaded += 1;
      }
      flash(`${uploaded} ${uploaded === 1 ? 'file' : 'files'} uploaded and indexed.`);
      await load({ quiet: true });
    } catch (cause) {
      setError(`${cause.message}${uploaded ? ` (${uploaded} file${uploaded === 1 ? '' : 's'} uploaded before the error)` : ''}`);
      await load({ quiet: true });
    } finally { setBusy(false); setUploadProgress(''); setUploadPercent(0); event.target.value = ''; }
  }
  function blankUploadMetadata(file, kind) {
    return { name: file.name, title: file.name.replace(/\.[^.]+$/, ''), artist: '', album: '', language: '', genre: '', description: '', release_date: '', media_type: kind === 'movie' ? (/\bS\d{1,2}\s*E\d{1,2}\b/i.test(file.name) ? 'show' : 'movie') : '', metadata_provider: '', external_id: '', artwork_url: '', artwork_file: null, edited_fields: [] };
  }
  async function lookupUpload(file, kind) {
    setUploadLookupBusy(true); setUploadLookupMessage('Checking title and tags with the metadata catalogs…');
    try {
      const found = await api(`/api/metadata/lookup?kind=${kind}&filename=${encodeURIComponent(file.name)}`);
      setUploadForm(previous => ({ ...previous, ...found, name: file.name, title: found.title || previous.title, artwork_file: null }));
      setUploadLookupMessage(found.matched ? `Suggested match from ${found.metadata_provider}. Review it and edit anything that needs correction.` : 'No confident catalog match. Fill in the details you know, or upload with the filename as its title.');
    } catch {
      setUploadLookupMessage('Catalog lookup is unavailable right now. You can still fill in the details and upload.');
    } finally { setUploadLookupBusy(false); }
  }
  function beginMediaUpload(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    const kind = section === 'music' ? 'music' : 'movie';
    setUploadQueue(files); setUploadIndex(0); setUploadForm(blankUploadMetadata(files[0], kind)); setUploadLookupMessage('');
    void lookupUpload(files[0], kind);
  }
  async function submitMediaUpload(event) {
    event.preventDefault();
    if (!currentUpload || !uploadForm || uploadLookupBusy || busy) return;
    const kind = section === 'music' ? 'music' : 'movie';
    const data = new FormData(); data.append('file', currentUpload); data.append('metadata_confirmed', 'true');
    for (const key of ['title', 'artist', 'album', 'language', 'genre', 'description', 'release_date', 'media_type', 'external_id', 'metadata_provider', 'artwork_url']) {
      const value = uploadForm[key]; if (value !== undefined && value !== null) data.append(key, String(value));
    }
    data.append('edited_fields', JSON.stringify(uploadForm.edited_fields || []));
    if (uploadForm.artwork_file) data.append('artwork', uploadForm.artwork_file);
    const uploadLabel = `Uploading ${uploadIndex + 1} of ${uploadQueue.length}: ${currentUpload.name}`;
    setBusy(true); setError(''); setUploadProgress(`${uploadLabel} · 0%`); setUploadPercent(0);
    try {
      await uploadWithProgress('/api/upload', data, percent => {
        setUploadPercent(percent); setUploadProgress(`${uploadLabel} · ${Math.floor(percent)}%`);
      });
      const nextIndex = uploadIndex + 1;
      if (nextIndex < uploadQueue.length) {
        const nextFile = uploadQueue[nextIndex]; setUploadIndex(nextIndex); setUploadForm(blankUploadMetadata(nextFile, kind));
        setBusy(false); setUploadProgress(''); setUploadPercent(0); void lookupUpload(nextFile, kind); return;
      }
      flash(`${uploadQueue.length} ${kind === 'music' ? 'music file' : 'video'}${uploadQueue.length === 1 ? '' : 's'} uploaded and indexed.`);
      setUploadQueue([]); setUploadIndex(0); setUploadForm(null); await load({ quiet: true });
    } catch (cause) { setError(cause.message || 'Upload failed. Your file is still available to retry.'); }
    finally { setBusy(false); setUploadProgress(''); setUploadPercent(0); }
  }
  function cancelMediaUpload() {
    if (busy) return;
    setUploadQueue([]); setUploadIndex(0); setUploadForm(null); setUploadLookupMessage('');
  }

  async function createFolder() {
    setForm({ name: '', parent_id: folderId }); setDialog({ kind: 'create-folder' });
  }
  function beginDriveDrag(event, kind, target) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/orbit-drive-item', JSON.stringify({ kind, id: target.id, parentId: kind === 'file' ? target.folder_id ?? null : target.parent_id ?? null }));
    event.dataTransfer.setData('text/plain', target.name);
  }
  async function dropDriveItem(event, destinationId) {
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.classList.remove('drag-over');
    const raw = event.dataTransfer.getData('application/orbit-drive-item');
    if (!raw) return;
    try {
      const dragged = JSON.parse(raw);
      if (dragged.kind === 'folder' && Number(dragged.id) === Number(destinationId)) return;
      if (dragged.parentId === destinationId) return;
      const endpoint = dragged.kind === 'folder' ? `/api/folders/${dragged.id}` : `/api/media/${dragged.id}`;
      const body = dragged.kind === 'folder' ? { parent_id: destinationId } : { folder_id: destinationId };
      await api(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      flash(`Moved ${dragged.kind} to ${destinationId == null ? 'My Drive' : 'folder'}.`);
      await load({ quiet: true });
    } catch (cause) { setError(cause.message || 'Could not move this item.'); }
  }
  function allowDriveDrop(event) {
    if (event.dataTransfer.types.includes('application/orbit-drive-item')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; event.currentTarget.classList.add('drag-over'); }
  }
  function leaveDriveDrop(event) { event.currentTarget.classList.remove('drag-over'); }
  function editTarget(target, type) {
    setForm(type === 'folder' ? { name: target.name, parent_id: target.parent_id } : {
      name: target.name, title: target.title || '', artist: target.artist || '', album: target.album || '', language: target.language || '', genre: target.genre || '', description: target.description || '', release_date: target.release_date || '', folder_id: target.folder_id ?? null, media_type: target.media_type || (target.kind === 'movie' ? 'movie' : undefined),
    });
    setDialog({ kind: type === 'folder' ? 'edit-folder' : 'edit-media', target });
  }
  async function saveDialog(event) {
    event.preventDefault();
    const name = String(form.name || '').trim();
    if (!name) { setError('A name is required.'); return; }
    try {
      if (dialog.kind === 'create-folder') {
        await api('/api/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parent_id: form.parent_id }) });
        flash('Folder created.');
      } else if (dialog.kind === 'edit-folder') {
        await api(`/api/folders/${dialog.target.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parent_id: form.parent_id }) });
        flash('Folder updated.');
      } else {
        await api(`/api/media/${dialog.target.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, name }) });
        flash('Library item updated.');
      }
      setDialog(null); await load({ quiet: true });
    } catch (cause) { setError(cause.message || 'Could not save your changes.'); }
  }
  async function removeTarget(target, type) {
    const label = type === 'folder' ? 'folder' : 'file';
    if (!window.confirm(`Delete ${label} “${target.name}”? This removes it from the NAS.`)) return;
    try {
      await api(type === 'folder' ? `/api/folders/${target.id}` : `/api/media/${target.id}`, { method: 'DELETE' });
      if (selected?.id === target.id) setSelected(null);
      flash(`${label[0].toUpperCase()}${label.slice(1)} deleted.`); await load({ quiet: true });
    } catch (cause) { setError(cause.message || `Could not delete ${label}.`); }
  }
  async function choosePlaylist(id) {
    setActivePlaylist(id);
    if (!id) { setPlaylistContents([]); return; }
    try { const result = await api(`/api/playlists/${id}`); setPlaylistContents(result.items || []); }
    catch (cause) { setError(cause.message); }
  }
  async function playlistAction(action, playlist = null, item = null) {
    try {
      if (action === 'create') {
        const name = window.prompt('Playlist name'); if (!name?.trim()) return;
        const result = await api('/api/playlists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
        await load({ quiet: true }); await choosePlaylist(String(result.id)); flash('Playlist created.');
      } else if (action === 'rename') {
        const name = window.prompt('Rename playlist', playlist.name); if (!name?.trim()) return;
        await api(`/api/playlists/${playlist.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
        await load({ quiet: true }); flash('Playlist renamed.');
      } else if (action === 'delete') {
        if (!window.confirm(`Delete playlist “${playlist.name}”?`)) return;
        await api(`/api/playlists/${playlist.id}`, { method: 'DELETE' });
        if (String(playlist.id) === activePlaylist) { setActivePlaylist(''); setPlaylistContents([]); }
        await load({ quiet: true }); flash('Playlist deleted.');
      } else if (action === 'add-track') {
        const target = activePlaylist || playlist?.id || playlistChoice;
        if (!target) { setError('Create a playlist first.'); return; }
        const match = playlists.find(value => String(value.id) === String(target));
        if (!match) { setError('Choose a playlist first.'); return; }
        const current = await api(`/api/playlists/${match.id}`);
        await api(`/api/playlists/${match.id}/items`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ media_ids: [...current.items.map(value => value.id), item.id] }) });
        if (String(match.id) === activePlaylist) await choosePlaylist(activePlaylist);
        setPlaylistPicker(null); await load({ quiet: true }); flash(`Added to ${match.name}.`);
      } else if (action === 'remove-track') {
        const current = await api(`/api/playlists/${activePlaylist}`);
        await api(`/api/playlists/${activePlaylist}/items`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ media_ids: current.items.filter(value => value.id !== item.id).map(value => value.id) }) });
        await choosePlaylist(activePlaylist); await load({ quiet: true }); flash('Track removed from playlist.');
      }
    } catch (cause) { setError(cause.message || 'Playlist action failed.'); }
  }
  async function runAdminAction(action) {
    setBusy(true); setError('');
    try {
      if (action === 'scan') {
        const result = await api('/api/scan', { method: 'POST' });
        flash(`Scan complete · ${result.imported} files indexed.`);
      } else {
        const result = await api('/api/backup', { method: 'POST' });
        flash(`Database backup saved · ${result.path}`);
      }
      await load({ quiet: true });
    } catch (cause) { setError(cause.message || 'Admin action failed.'); } finally { setBusy(false); }
  }
  async function saveToken(event) {
    event.preventDefault();
    if (!tokenDraft.trim()) { setError('The API token cannot be empty.'); return; }
    const baseUrl = apiUrlDraft.trim().replace(/\/+$/, '');
    if (baseUrl) {
      try { new URL(baseUrl); } catch { setError('Enter a valid API server URL, such as http://192.168.1.20:8000.'); return; }
    }
    localStorage.setItem('orbit-api-token', tokenDraft.trim());
    localStorage.setItem('orbit-api-url', baseUrl);
    setSettingsOpen(false); await load();
  }
  function playbackUrl(item) { return apiUrl(`/api/media/${item.id}?token=${encodeURIComponent(getToken())}`); }

  const meta = pageMeta[section];
  const libraryTitle = section === 'drive' && currentFolder ? currentFolder.name : meta.title;

  return <div className="app-shell" data-theme={theme}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Cloud size={19} /></span><span>orbit<span className="brand-light">nas</span></span></div>
      <p className="workspace-label">LIBRARY</p>
      <nav className="side-nav" aria-label="Main navigation">
        <NavButton active={section === 'overview'} onClick={() => navigate('overview')} icon={<LayoutDashboard size={18} />} label="Overview" />
        <NavButton active={section === 'drive'} onClick={() => navigate('drive')} icon={<HardDrive size={18} />} label="Drive" count={categoryCounts.drive} />
        <NavButton active={section === 'music'} onClick={() => navigate('music')} icon={<AudioLines size={18} />} label="Music" count={categoryCounts.music} />
        <NavButton active={section === 'movies'} onClick={() => navigate('movies')} icon={<Film size={18} />} label="Movies" count={categoryCounts.movies} />
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-server"><span className="server-pulse" /><div><strong>NAS connected</strong><small>Private server</small></div></div>
        <button className="settings-link" onClick={() => setTheme(value => value === 'dark' ? 'light' : 'dark')}><span className="theme-switch-icon">{theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}</span>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</button>
        <button className="settings-link" onClick={() => { setTokenDraft(getToken()); setApiUrlDraft(getApiBaseUrl()); setSettingsOpen(true); }}><Settings2 size={17} /> Connection settings</button>
        <div className="sidebar-foot"><ShieldCheck size={16} /><span>Files stay on your network</span></div>
      </div>
    </aside>

    <main className="main-content">
      <header className="topbar">
        <div><p className="eyebrow">{meta.eyebrow}</p><h1>{libraryTitle}</h1></div>
        <div className="top-actions">
          <button className="icon-button theme-top-toggle" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={() => setTheme(value => value === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}</button>
          <button className="icon-button" aria-label="Refresh library" onClick={() => void load()} disabled={busy}><RefreshCw size={18} className={busy ? 'spin' : ''} /></button>
          {section !== 'overview' && <label className="button button-dark upload-button"><Upload size={16} /> {section === 'music' ? 'Add music' : section === 'movies' ? 'Add videos' : 'Upload files'}<input type="file" multiple accept={section === 'music' ? 'audio/*' : section === 'movies' ? 'video/*' : undefined} onChange={section === 'music' || section === 'movies' ? beginMediaUpload : upload} disabled={busy} /></label>}
          <button className="avatar" title="Connection settings" onClick={() => { setTokenDraft(getToken()); setApiUrlDraft(getApiBaseUrl()); setSettingsOpen(true); }}>O</button>
        </div>
      </header>

      {section === 'overview' ? <Overview stats={stats} items={items} folders={folders} audit={audit} systemMetrics={systemMetrics} metricsRange={metricsRange} onMetricsRange={setMetricsRange} onNavigate={navigate} onAdmin={runAdminAction} busy={busy} /> : <>
        <p className="page-description">{meta.description}</p>
        {section === 'movies' && <div className="metadata-credit"><span>Movie and show metadata provided by <a href="https://www.omdbapi.com/" target="_blank" rel="noreferrer">OMDb API</a>.</span></div>}
        <div className="toolbar">
          <label className="search-field"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${meta.title.toLowerCase()} by name or metadata`} /><kbd>/</kbd></label>
          {section === 'drive' && <button className="button button-light" onClick={() => void createFolder()}><FolderPlus size={16} /> New folder</button>}
          {(section === 'music' || section === 'movies') && <FilterSelect icon={<Languages size={15}/>} label="Language" value={languageFilter} options={languages} onChange={setLanguageFilter}/>}
          {(section === 'music' || section === 'movies') && <FilterSelect icon={<ListFilter size={15}/>} label="Genre" value={genreFilter} options={genres} onChange={setGenreFilter}/>}
          {section === 'movies' && <div className="segmented-filter" aria-label="Filter movie type">{[['all', 'All'], ['movie', 'Movies'], ['show', 'TV shows']].map(([value, label]) => <button key={value} className={movieTypeFilter === value ? 'selected' : ''} onClick={() => setMovieTypeFilter(value)}>{label}</button>)}</div>}
          {section === 'drive' && <button className="button button-light layout-toggle" onClick={() => setDriveLayout(value => value === 'grid' ? 'list' : 'grid')} title={`Switch to ${driveLayout === 'grid' ? 'list' : 'grid'} view`}>{driveLayout === 'grid' ? 'List view' : 'Grid view'}</button>}
          <button className="button button-light sort-button" onClick={() => setSort(value => value === 'recent' ? 'name' : value === 'name' ? 'size' : 'recent')}><ListFilter size={16} /> {sort === 'recent' ? 'Recently added' : sort === 'name' ? 'Name A–Z' : 'Largest'}</button>
        </div>
        {section === 'music' && <div className="collection-bar"><div className="collection-icon"><ListMusic size={17}/></div><div className="collection-copy"><strong>Playlists</strong><small>Organize tracks for the mobile player</small></div><select value={activePlaylist} onChange={event => void choosePlaylist(event.target.value)} aria-label="Select playlist"><option value="">All tracks</option>{playlists.map(playlist => <option key={playlist.id} value={playlist.id}>{playlist.name} · {playlist.items}</option>)}</select><button className="button button-light" onClick={() => void playlistAction('create')}><Plus size={15}/> New playlist</button>{activePlaylist && <><button className="subtle-action" onClick={() => void playlistAction('rename', playlists.find(value => String(value.id) === activePlaylist))}><Pencil size={14}/> Rename</button><button className="subtle-action danger-text" onClick={() => void playlistAction('delete', playlists.find(value => String(value.id) === activePlaylist))}><Trash2 size={14}/> Delete</button></>}</div>}
        {section === 'drive' && <div className="breadcrumbs">
          <button className={!folderId ? 'crumb-current' : ''} onClick={() => { setFolderId(null); setFolderTrail([]); }} onDragOver={allowDriveDrop} onDragLeave={leaveDriveDrop} onDrop={event => void dropDriveItem(event, null)}>My Drive</button>
          {folderTrail.map((folder, index) => <React.Fragment key={folder.id}><ChevronRight size={14} /><button className={index === folderTrail.length - 1 ? 'crumb-current' : ''} onClick={() => goToTrail(index)} onDragOver={allowDriveDrop} onDragLeave={leaveDriveDrop} onDrop={event => void dropDriveItem(event, folder.id)}>{folder.name}</button></React.Fragment>)}
        </div>}
        {uploadProgress && <div className="upload-status"><LoaderCircle size={16} className="spin" />{uploadProgress}<span className="progress-track" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(uploadPercent)}><span style={{ width: `${uploadPercent}%` }} /></span></div>}
        <div className="section-heading"><div><p className="eyebrow">{section === 'drive' ? 'YOUR FILES' : 'LIBRARY CONTENT'}</p><h2>{visibleItems.length + visibleFolders.length} items</h2></div><span className="view-note">{section === 'drive' ? 'Drag files or folders onto a folder to move them' : 'Synced with mobile apps'}</span></div>
        <div className={`library-grid ${section === 'drive' && driveLayout === 'list' ? 'list-layout' : ''}`}>
          {visibleFolders.map(folder => <FolderCard key={`folder-${folder.id}`} folder={folder} folders={folders} items={driveFiles} draggable={section === 'drive'} onDragStart={event => beginDriveDrag(event, 'folder', folder)} onDragOver={allowDriveDrop} onDragLeave={leaveDriveDrop} onDrop={event => void dropDriveItem(event, folder.id)} onOpen={openFolder} onEdit={() => editTarget(folder, 'folder')} onDelete={() => void removeTarget(folder, 'folder')} />)}
          {visibleItems.map(item => <MediaCard key={item.id} item={item} draggable={section === 'drive'} onDragStart={event => beginDriveDrag(event, 'file', item)} onOpen={() => setSelected(item)} onEdit={() => editTarget(item, 'media')} onDelete={() => void removeTarget(item, 'media')} onPlaylist={section === 'music' ? () => { if (activePlaylist) void playlistAction('remove-track', null, item); else if (playlists.length === 1) void playlistAction('add-track', playlists[0], item); else { setPlaylistChoice(String(playlists[0]?.id || '')); setPlaylistPicker(item); } } : null} playlistMode={Boolean(activePlaylist)} onDownload={section === 'drive' ? () => window.open(playbackUrl(item), '_blank', 'noopener') : null} />)}
          {!visibleItems.length && !visibleFolders.length && <EmptyState title={query ? 'No matching items' : `No ${meta.title.toLowerCase()} here yet`} detail={query ? 'Try another search term.' : 'Upload something to get started. Your files will appear in the mobile apps too.'} />}
        </div>
      </>}
      {notice && <div className={`toast ${notice.type}`}><Check size={16} />{notice.text}<button onClick={() => setNotice(null)} aria-label="Dismiss"><X size={16} /></button></div>}
      {error && <div className="error-banner"><CircleHelp size={17} /><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={16} /></button></div>}
      {refreshing && <div className="refresh-note"><LoaderCircle size={15} className="spin" />Refreshing library…</div>}
    </main>

    {selected && <MediaPlayer item={selected} url={playbackUrl(selected)} onClose={() => setSelected(null)} onEdit={() => editTarget(selected, 'media')} onDelete={() => void removeTarget(selected, 'media')} />}
    {currentUpload && uploadForm && <UploadMetadataDialog kind={section === 'music' ? 'music' : 'movie'} file={currentUpload} index={uploadIndex} total={uploadQueue.length} form={uploadForm} setForm={setUploadForm} lookupBusy={uploadLookupBusy} lookupMessage={uploadLookupMessage} uploading={busy} onCancel={cancelMediaUpload} onSubmit={submitMediaUpload} />}
    {dialog && <EditDialog kind={dialog.kind} isVideo={dialog.target?.kind === 'movie'} form={form} setForm={setForm} folders={folders} onClose={() => setDialog(null)} onSave={saveDialog} />}
    {playlistPicker && <Modal title="Add to playlist" onClose={() => setPlaylistPicker(null)}><div className="playlist-picker"><p>Add <strong>{playlistPicker.title || playlistPicker.name}</strong> to a music playlist.</p><label>Playlist<select value={playlistChoice} onChange={event => setPlaylistChoice(event.target.value)}><option value="" disabled>Select a playlist</option>{playlists.map(playlist => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}</select></label><div className="dialog-actions"><button className="button button-light" onClick={() => setPlaylistPicker(null)}>Cancel</button><button className="button button-dark" onClick={() => void playlistAction('add-track', null, playlistPicker)}><ListMusic size={15}/>Add track</button></div></div></Modal>}
    {settingsOpen && <Modal title="Connection settings" onClose={() => setSettingsOpen(false)}><form onSubmit={saveToken} className="settings-form"><p>Set the NAS API address and the same auth string as <code>API_TOKEN</code> in the server environment. These values are saved only in this browser.</p><label>API server URL<input type="url" placeholder="Leave blank to use this site's /api proxy" value={apiUrlDraft} onChange={event => setApiUrlDraft(event.target.value)} autoComplete="url" /></label><label>Auth string (API token)<input type="password" value={tokenDraft} onChange={event => setTokenDraft(event.target.value)} autoComplete="current-password" /></label><div className="dialog-actions"><button type="button" className="button button-light" onClick={() => setSettingsOpen(false)}>Cancel</button><button className="button button-dark">Save and reconnect</button></div></form></Modal>}
  </div>;
}

function NavButton({ active, onClick, icon, label, count }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span>{count > 0 && <small>{count}</small>}</button>;
}

function FilterSelect({ icon, label, value, options, onChange }) {
  return <label className="filter-select">{icon}<select value={value} onChange={event => onChange(event.target.value)} aria-label={`Filter by ${label.toLowerCase()}`}><option value="">All {label.toLowerCase()}s</option>{options.map(option => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function Overview({ stats, items, folders, audit, systemMetrics, metricsRange, onMetricsRange, onNavigate, onAdmin, busy }) {
  const totalBytes = Number(stats?.total_bytes || 0);
  const freeBytes = Number(stats?.free_bytes || 0);
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  const catalogBytes = Number(stats?.bytes || 0);
  const usage = totalBytes ? Math.min(100, usedBytes / totalBytes * 100) : 0;
  const gib = value => `${(Number(value || 0) / 1024 ** 3).toFixed(2)} GiB`;
  const tib = value => `${(Number(value || 0) / 1024 ** 4).toFixed(2)} TiB`;
  const formatCount = value => Number(value || 0).toLocaleString();
  const groups = [
    { label: 'Drive', kind: 'file', color: 'blue' },
    { label: 'Music', kind: 'music', color: 'slate' },
    { label: 'Movies', kind: 'movie', color: 'violet' },
  ].map(group => {
    const groupItems = items.filter(item => item.kind === group.kind);
    return { ...group, count: groupItems.length, size: groupItems.reduce((sum, item) => sum + Number(item.size || 0), 0) };
  });
  const countRows = groups.map(group => ({ label: group.label, value: group.count, color: group.color }));
  const sizeRows = groups.map(group => ({ label: group.label, value: group.size, color: group.color }));
  const catalogShare = totalBytes ? Math.min(100, catalogBytes / totalBytes * 100) : 0;
  return <div className="ops-overview">
    <section className="ops-summary">
      <div className="ops-summary-copy">
        <span className="ops-kicker">SYSTEM SUMMARY</span>
        <h2>NAS overview</h2>
        <p>Live catalog and filesystem figures from the connected server.</p>
      </div>
      <div className="ops-summary-state"><span className="ops-state-dot"/><span>API responding</span></div>
    </section>

    <section className="ops-metrics" aria-label="Storage and library metrics">
      <Metric label="CATALOGUED ITEMS" value={stats ? formatCount(stats.items) : '—'} detail={`${formatCount(folders.length)} folders · ${formatCount(items.length)} indexed records`} />
      <Metric label="CATALOG SIZE" value={stats ? gib(catalogBytes) : '—'} detail={stats ? `${tib(catalogBytes)} · media catalog only` : 'Waiting for filesystem stats'} />
      <Metric label="FILESYSTEM USED" value={stats ? gib(usedBytes) : '—'} detail={stats ? `${usage.toFixed(1)}% of total capacity` : 'Waiting for filesystem stats'} />
      <Metric label="AVAILABLE SPACE" value={stats ? gib(freeBytes) : '—'} detail={stats ? `${tib(totalBytes)} total filesystem capacity` : 'Waiting for filesystem stats'} />
    </section>

    <section className="ops-panel ops-capacity-panel">
      <div className="ops-panel-heading">
        <div><span className="ops-kicker">FILESYSTEM CAPACITY</span><h3>Storage utilization</h3></div>
        <span className="ops-panel-value">{stats ? `${usage.toFixed(1)}% used` : 'Waiting for stats'}</span>
      </div>
      <div className="ops-storage-bar" role="progressbar" aria-label="Filesystem space used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={stats ? Math.round(usage) : 0}>
        <span style={{ width: `${stats ? usage : 0}%` }}/>
      </div>
      <div className="ops-storage-legend">
        <span><i className="ops-legend-used"/>Used <strong>{gib(usedBytes)}</strong></span>
        <span><i className="ops-legend-free"/>Available <strong>{gib(freeBytes)}</strong></span>
        <span><i className="ops-legend-catalog"/>Catalogued <strong>{gib(catalogBytes)}</strong></span>
      </div>
      <div className="ops-capacity-details">
        <div><small>Filesystem total</small><strong>{gib(totalBytes)}</strong></div>
        <div><small>Catalog / filesystem</small><strong>{catalogShare.toFixed(2)}%</strong></div>
        <div><small>Uncatalogued used space</small><strong>{gib(Math.max(0, usedBytes - catalogBytes))}</strong></div>
      </div>
      <p className="ops-footnote">Filesystem usage comes from the NAS media directory's underlying filesystem. Catalog size is calculated from indexed media records and can differ from actual disk usage.</p>
    </section>

    <section className="ops-panel ops-system-panel">
      <div className="ops-panel-heading ops-system-heading">
        <div><span className="ops-kicker">HOST PERFORMANCE</span><h3>System monitoring</h3><small className="ops-system-subtitle">Live readings from the Ubuntu NAS host · sampled every 15 seconds</small></div>
        <div className="ops-range-switch" role="group" aria-label="Chart time range">{[1, 6, 24].map(hours => <button key={hours} className={metricsRange === hours ? 'active' : ''} onClick={() => onMetricsRange(hours)}>{hours}h</button>)}</div>
      </div>
      {systemMetrics?.current ? <>
        <div className="ops-system-summary">
          <SystemValue label="CPU UTILIZATION" value={systemMetrics.current.cpu_percent == null ? 'Sampling…' : `${systemMetrics.current.cpu_percent.toFixed(1)}%`} detail={`${systemMetrics.current.cpu_cores} logical cores`} />
          <SystemValue label="MEMORY USED" value={systemMetrics.current.memory_percent == null ? 'Unavailable' : `${systemMetrics.current.memory_percent.toFixed(1)}%`} detail={`${gib(systemMetrics.current.memory_used_bytes)} / ${gib(systemMetrics.current.memory_total_bytes)}`} />
          <SystemValue label="UPTIME" value={durationLabel(systemMetrics.current.uptime_seconds)} detail={`Load ${systemMetrics.current.load_1m.toFixed(2)} / ${systemMetrics.current.load_5m.toFixed(2)} / ${systemMetrics.current.load_15m.toFixed(2)}`} />
          <SystemValue label="CPU TEMPERATURE" value={systemMetrics.current.cpu_temperature_c == null ? 'Unavailable' : `${systemMetrics.current.cpu_temperature_c.toFixed(1)} °C`} detail="Host thermal sensor" />
        </div>
        <div className="ops-system-chart-grid">
          <LineChart title="CPU utilization" unit="%" points={systemMetrics.history} series={[{ key: 'cpu_percent', label: 'CPU', color: 'blue' }]} min={0} max={100} format={value => `${value.toFixed(1)}%`} />
          <LineChart title="Memory utilization" unit="%" points={systemMetrics.history} series={[{ key: 'memory_percent', label: 'Memory', color: 'slate' }]} min={0} max={100} format={value => `${value.toFixed(1)}%`} />
          <LineChart title="Network throughput" unit="MiB/s" points={systemMetrics.history} series={[{ key: 'network_rx_bytes_per_sec', label: 'Receive', color: 'blue', scale: 1024 ** 2 }, { key: 'network_tx_bytes_per_sec', label: 'Transmit', color: 'violet', scale: 1024 ** 2 }]} format={value => `${value.toFixed(2)} MiB/s`} />
          <LineChart title="Disk I/O throughput" unit="MiB/s" points={systemMetrics.history} series={[{ key: 'disk_read_bytes_per_sec', label: 'Read', color: 'blue', scale: 1024 ** 2 }, { key: 'disk_write_bytes_per_sec', label: 'Write', color: 'slate', scale: 1024 ** 2 }]} format={value => `${value.toFixed(2)} MiB/s`} />
        </div>
        <div className="ops-system-footer"><span>{systemMetrics.history_count} samples in selected window</span><span>Interfaces: {systemMetrics.current.network_interfaces.join(', ') || 'not detected'}</span><span>Block devices: {systemMetrics.current.disk_devices.join(', ') || 'not detected'}</span></div>
      </> : <div className="ops-monitoring-empty"><span className="ops-monitoring-pulse"/><strong>Waiting for host metrics</strong><small>First readings are collected when the API starts. Charts populate after the first sampling interval.</small></div>}
    </section>

    <div className="ops-chart-grid">
      <BarChart title="Items by library" kicker="CONTENT DISTRIBUTION" rows={countRows} format={formatCount} unit="items" empty="No indexed items yet" />
      <BarChart title="Catalog size by library" kicker="INDEXED MEDIA SIZE" rows={sizeRows} format={gib} unit="GiB" empty="No catalogued media sizes yet" />
    </div>

    <div className="ops-main-grid">
      <section className="ops-panel">
        <div className="ops-panel-heading"><div><span className="ops-kicker">LIBRARY BREAKDOWN</span><h3>Indexed content</h3></div></div>
        <div className="ops-breakdown">
          <button onClick={() => onNavigate('drive')}><span className="ops-breakdown-icon file"><HardDrive size={17}/></span><span>Drive files</span><strong>{formatCount(groups[0].count)}</strong><ChevronRight size={15}/></button>
          <button onClick={() => onNavigate('music')}><span className="ops-breakdown-icon music"><AudioLines size={17}/></span><span>Music tracks</span><strong>{formatCount(groups[1].count)}</strong><ChevronRight size={15}/></button>
          <button onClick={() => onNavigate('movies')}><span className="ops-breakdown-icon movies"><Film size={17}/></span><span>Movies &amp; shows</span><strong>{formatCount(groups[2].count)}</strong><ChevronRight size={15}/></button>
        </div>
      </section>
      <section className="ops-panel">
        <div className="ops-panel-heading"><div><span className="ops-kicker">AUDIT LOG</span><h3>Recent activity</h3></div><span className="ops-panel-value">{audit.length} events</span></div>
        {audit.length ? <div className="ops-activity">{audit.map(event => <div className="ops-activity-row" key={event.id}><span className="ops-activity-mark"/><span><strong>{String(event.action).replaceAll('.', ' ')}</strong><small>{event.subject}</small></span><time>{dateLabel(event.created_at)}</time></div>)}</div> : <p className="ops-empty">No recorded activity yet.</p>}
      </section>
    </div>

    <section className="ops-panel">
      <div className="ops-panel-heading"><div><span className="ops-kicker">MAINTENANCE</span><h3>Server operations</h3></div></div>
      <div className="ops-tools">
        <button onClick={() => onAdmin('scan')} disabled={busy}><span className="ops-tool-icon"><RefreshCw size={17}/></span><span><strong>Scan media directory</strong><small>Index files added outside the apps</small></span><ChevronRight size={15}/></button>
        <button onClick={() => onAdmin('backup')} disabled={busy}><span className="ops-tool-icon"><Database size={17}/></span><span><strong>Back up catalog database</strong><small>Create a SQLite database snapshot</small></span><ChevronRight size={15}/></button>
      </div>
    </section>
    <p className="ops-data-note">CPU, memory, network throughput, disk SMART, and container metrics are not yet exposed by the current API. These charts use indexed media records and filesystem measurements only.</p>
  </div>;
}

function SystemValue({ label, value, detail }) {
  return <div className="ops-system-value"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function durationLabel(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function LineChart({ title, unit, points, series, min, max, format }) {
  const width = 640, height = 160, padX = 8, padY = 12;
  const values = points.flatMap(point => series.map(item => point[item.key] == null ? null : Number(point[item.key]) / (item.scale || 1))).filter(value => value != null && Number.isFinite(value));
  const low = min ?? 0;
  const high = max ?? Math.max(1, ...values) * 1.12;
  const pathFor = item => points.map((point, index) => {
    const raw = point[item.key];
    if (raw == null || !Number.isFinite(Number(raw))) return null;
    const value = Number(raw) / (item.scale || 1);
    const x = padX + (points.length <= 1 ? 0 : index / (points.length - 1) * (width - padX * 2));
    const y = height - padY - (Math.max(low, Math.min(high, value)) - low) / Math.max(0.000001, high - low) * (height - padY * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).filter(Boolean).join(' ');
  const latest = series.map(item => ({ ...item, value: points.at(-1)?.[item.key] == null ? null : Number(points.at(-1)[item.key]) / (item.scale || 1) }));
  return <section className="ops-chart-panel ops-line-chart">
    <div className="ops-panel-heading"><div><h4>{title}</h4></div><span className="ops-panel-value">{unit}</span></div>
    {values.length ? <>
      <div className="ops-line-plot"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} preserveAspectRatio="none">
        {[0, .5, 1].map(fraction => <line key={fraction} x1="0" x2={width} y1={padY + fraction * (height - padY * 2)} y2={padY + fraction * (height - padY * 2)} className="ops-chart-gridline" />)}
        {series.map(item => <polyline key={item.key} points={pathFor(item)} className={`ops-line ${item.color}`} />)}
      </svg></div>
      <div className="ops-line-legend">{latest.map(item => <span key={item.key}><i className={item.color}/>{item.label}<strong>{item.value == null ? '—' : format(item.value)}</strong></span>)}</div>
      <div className="ops-line-time"><span>{points[0]?.timestamp ? new Date(points[0].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span><span>{points.at(-1)?.timestamp ? new Date(points.at(-1).timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span></div>
    </> : <p className="ops-empty">Waiting for valid samples.</p>}
  </section>;
}

function Metric({ label, value, detail }) {
  return <article className="ops-metric"><span className="ops-metric-label">{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function BarChart({ title, kicker, rows, format, unit, empty }) {
  const max = Math.max(0, ...rows.map(row => row.value));
  return <section className="ops-panel ops-chart-panel">
    <div className="ops-panel-heading"><div><span className="ops-kicker">{kicker}</span><h3>{title}</h3></div><span className="ops-panel-value">{unit}</span></div>
    {max > 0 ? <div className="ops-chart-bars">{rows.map(row => <div className="ops-chart-row" key={row.label}>
      <div className="ops-chart-label"><span>{row.label}</span><strong>{format(row.value)}</strong></div>
      <div className="ops-chart-track"><span className={`ops-chart-fill ${row.color}`} style={{ width: `${Math.max(1, row.value / max * 100)}%` }}/></div>
    </div>)}</div> : <p className="ops-empty">{empty}</p>}
  </section>;
}

function StatCard({ icon, label, value, detail, tone }) {
  return <article className="stat-card"><span className={`stat-icon ${tone}`}>{icon}</span><div className="stat-label">{label}</div><strong className="stat-value">{value}</strong><small>{detail}</small></article>;
}

function WorkspaceCard({ icon, tone, title, count, detail, onClick }) {
  return <button className="workspace-card" onClick={onClick}><span className={`workspace-icon ${tone}`}>{icon}</span><span className="workspace-copy"><strong>{title}</strong><small>{detail}</small></span><span className="workspace-count">{count}</span><ChevronRight size={16}/></button>;
}

function FolderCard({ folder, folders, items, onOpen, onEdit, onDelete, draggable = false, onDragStart, onDragOver, onDragLeave, onDrop }) {
  const count = folders.filter(child => child.parent_id === folder.id).length + items.filter(item => item.folder_id === folder.id).length;
  return <article className="asset-card folder-asset" draggable={draggable} onDragStart={onDragStart} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}><button className="asset-main" onClick={onOpen}><div className={`asset-preview folder-preview ${count ? 'has-files' : ''}`}><Folder size={42}/><span>{count ? `${count} items` : 'Empty folder'}</span></div><div className="asset-info"><strong title={folder.name}>{folder.name}</strong><small>{count} {count === 1 ? 'item' : 'items'}</small></div></button><CardMenu onEdit={onEdit} onDelete={onDelete} />
  </article>;
}

function MediaCard({ item, onOpen, onEdit, onDelete, onPlaylist, playlistMode, onDownload, draggable = false, onDragStart }) {
  const kindLabel = item.kind === 'music' ? 'MUSIC' : item.kind === 'movie' ? item.media_type === 'show' ? 'TV SHOW' : 'MOVIE' : extension(item.name);
  const artwork = item.artwork_url || (item.artwork_path ? apiUrl(`/api/artwork/${item.id}`) : null);
  const ArtIcon = item.kind === 'music' ? FileAudio : item.kind === 'movie' ? FileVideo : /\.(png|jpe?g|gif|webp|heic)$/i.test(item.name) ? FileImage : File;
  return <article className={`asset-card ${item.kind}-asset`} draggable={draggable} onDragStart={onDragStart}><button className="asset-main" onClick={onOpen}>
    <div className={`asset-preview ${item.kind}`}>
      {artwork && item.kind !== 'file' ? <img src={`${artwork}${artwork.includes('?') ? '&' : '?'}token=${encodeURIComponent(getToken())}`} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none'; }} /> : null}
      <ArtIcon size={37}/><span>{kindLabel}</span>
    </div>
    <div className="asset-info"><strong title={item.name}>{item.title || item.name}</strong><small>{item.kind === 'music' ? [item.artist, item.album].filter(Boolean).join(' · ') || item.name : item.kind === 'movie' ? [item.media_type === 'show' ? 'TV show' : 'Movie', item.language, item.genre].filter(Boolean).join(' · ') : item.name}{item.size ? ` · ${bytes(item.size)}` : ''}</small></div>
  </button><CardMenu onEdit={onEdit} onDelete={onDelete} onPlaylist={onPlaylist} playlistMode={playlistMode} onDownload={onDownload} /></article>;
}

function CardMenu({ onEdit, onDelete, onPlaylist, playlistMode, onDownload }) {
  return <details className="asset-actions"><summary aria-label="More actions" title="More actions"><MoreHorizontal size={17}/></summary><div className="action-menu"><button onClick={onEdit}><Pencil size={14}/>Rename or organize</button>{onDownload && <button onClick={onDownload}><Upload size={14}/>Download</button>}{onPlaylist && <button onClick={onPlaylist}>{playlistMode ? <X size={14}/> : <ListMusic size={14}/>} {playlistMode ? 'Remove from playlist' : 'Add to playlist'}</button>}<button className="delete-menu-action" onClick={onDelete}><Trash2 size={14}/>Delete</button></div></details>;
}

function EmptyState({ title, detail }) {
  return <div className="empty-state"><span><Folder size={27}/></span><strong>{title}</strong><p>{detail}</p></div>;
}

function MediaPlayer({ item, url, onClose, onEdit, onDelete }) {
  return <div className="player-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="player-dialog">
    <header><div><p className="eyebrow">{item.kind === 'music' ? 'NOW PLAYING' : item.kind === 'movie' ? 'STREAMING' : 'FILE PREVIEW'}</p><h3>{item.title || item.name}</h3></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={20}/></button></header>
    <div className={`player-view ${item.kind}`}>
      {item.kind === 'music' ? <div className="audio-player-art">{item.artwork_url && <img src={`${item.artwork_url}?token=${encodeURIComponent(getToken())}`} alt=""/>}<AudioLines size={42}/><strong>{item.artist || 'Unknown artist'}</strong><span>{item.album || 'Unknown album'}</span></div> : item.kind === 'movie' ? <video src={url} controls autoPlay playsInline /> : /\.(png|jpe?g|gif|webp|bmp)$/i.test(item.name) ? <img src={url} alt={item.name}/> : <div className="document-preview"><File size={48}/><strong>{item.name}</strong><a href={url} download={item.name}>Download file</a></div>}
    </div>
    <footer><span>{item.name} · {bytes(item.size)}</span><div><button className="button button-light" onClick={onEdit}><Pencil size={15}/> Edit</button><button className="button button-danger" onClick={onDelete}><Trash2 size={15}/> Delete</button><button className="icon-button" onClick={onClose}><X size={17}/></button></div></footer>
  </section></div>;
}

function Modal({ title, onClose, children, className = '' }) {
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal-card ${className}`}><header><h3>{title}</h3><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19}/></button></header>{children}</section></div>;
}

function UploadMetadataDialog({ kind, file, index, total, form, setForm, lookupBusy, lookupMessage, uploading, onCancel, onSubmit }) {
  const changeField = (field, value) => setForm(current => ({
    ...current,
    [field]: value,
    edited_fields: [...new Set([...(current.edited_fields || []), field])],
  }));
  const [localPreview, setLocalPreview] = useState('');
  useEffect(() => {
    if (!form.artwork_file) { setLocalPreview(''); return undefined; }
    const url = URL.createObjectURL(form.artwork_file);
    setLocalPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [form.artwork_file]);
  const preview = localPreview || form.artwork_url;
  return <Modal title={`${kind === 'music' ? 'Music' : 'Movie & show'} details · ${index + 1} of ${total}`} onClose={onCancel} className="upload-metadata-modal">
    <form className="upload-metadata-form" onSubmit={onSubmit}>
      <div className="upload-file-summary"><span className={`upload-type-icon ${kind}`}>{kind === 'music' ? <FileAudio size={20}/> : <FileVideo size={20}/>}</span><div><strong title={file.name}>{file.name}</strong><small>{bytes(file.size)} · {extension(file.name)} file</small></div><span className="upload-step">{index + 1}/{total}</span></div>
      <div className={`lookup-status ${lookupBusy ? 'checking' : ''}`}><span className="lookup-indicator">{lookupBusy ? <LoaderCircle size={15} className="spin"/> : <Check size={14}/>}</span><span>{lookupMessage}</span></div>
      <div className="upload-form-grid">
        <section className="artwork-picker"><p className="form-section-label">COVER ART / POSTER</p><div className="artwork-preview">{preview ? <img src={preview} alt="Selected artwork preview" /> : <span>{kind === 'music' ? <AudioLines size={26}/> : <Film size={26}/>}Artwork will show here</span>}</div><label className="button button-light artwork-file-button">Choose your own image<input type="file" accept="image/*" onChange={event => { const artworkFile = event.target.files?.[0] || null; changeField('artwork', artworkFile); setForm(value => ({ ...value, artwork_file: artworkFile, artwork_url: artworkFile ? '' : value.artwork_url })); event.target.value = ''; }}/></label>{form.metadata_provider && <small className="provider-note">Suggested by {form.metadata_provider}</small>}</section>
        <section className="metadata-fields"><p className="form-section-label">FILE INFORMATION</p>
          <label>Title<input value={form.title || ''} onChange={event => changeField('title', event.target.value)} disabled={lookupBusy} required /></label>
          {kind === 'music' && <><label>Artist<input value={form.artist || ''} onChange={event => changeField('artist', event.target.value)} disabled={lookupBusy} /></label><label>Album<input value={form.album || ''} onChange={event => changeField('album', event.target.value)} disabled={lookupBusy} /></label></>}
          {kind === 'movie' && <label>Library type<select value={form.media_type || 'movie'} onChange={event => changeField('media_type', event.target.value)} disabled={lookupBusy}><option value="movie">Movie</option><option value="show">TV show</option></select></label>}
          <div className="form-row"><label>Language<input value={form.language || ''} onChange={event => changeField('language', event.target.value)} disabled={lookupBusy} placeholder="e.g. Tamil, English" /></label><label>Genre<input value={form.genre || ''} onChange={event => changeField('genre', event.target.value)} disabled={lookupBusy} placeholder="e.g. Drama, Jazz" /></label></div>
          <label>Release date<input value={form.release_date || ''} onChange={event => changeField('release_date', event.target.value)} disabled={lookupBusy} placeholder="YYYY-MM-DD" /></label>
          <label>{kind === 'movie' ? 'Synopsis' : 'Description'}<textarea rows={3} value={form.description || ''} onChange={event => changeField('description', event.target.value)} disabled={lookupBusy} placeholder={kind === 'movie' ? 'Short description' : 'Optional track or album notes'} /></label>
        </section>
      </div>
      <div className="upload-dialog-footer"><span>{kind === 'music' ? 'This information syncs to Music and the NAS catalog.' : 'This information and poster sync to Movies and the NAS catalog.'}</span><div><button type="button" className="button button-light" onClick={onCancel} disabled={uploading}>Cancel</button><button className="button button-dark" disabled={lookupBusy || uploading}><Upload size={15}/>{uploading ? 'Uploading…' : index + 1 < total ? 'Save & next file' : 'Save & upload'}</button></div></div>
    </form>
  </Modal>;
}

function EditDialog({ kind, isVideo, form, setForm, folders, onClose, onSave }) {
  const media = kind === 'edit-media';
  const folderDialog = kind === 'edit-folder';
  return <Modal title={kind === 'create-folder' ? 'Create a folder' : folderDialog ? 'Edit folder' : 'Edit library item'} onClose={onClose}>
    <form className="edit-form" onSubmit={onSave}>
      <label>Name<input autoFocus value={form.name || ''} onChange={event => setForm(value => ({ ...value, name: event.target.value }))} maxLength={255} required /></label>
      {media && <>
        <label>Display title<input value={form.title || ''} onChange={event => setForm(value => ({ ...value, title: event.target.value }))} /></label>
        {isVideo && <label>Library type<select value={form.media_type || 'movie'} onChange={event => setForm(value => ({ ...value, media_type: event.target.value }))}><option value="movie">Movie</option><option value="show">TV show</option></select></label>}
        <div className="form-row"><label>Artist<input value={form.artist || ''} onChange={event => setForm(value => ({ ...value, artist: event.target.value }))} /></label><label>Album<input value={form.album || ''} onChange={event => setForm(value => ({ ...value, album: event.target.value }))} /></label></div>
        <div className="form-row"><label>Language<input value={form.language || ''} onChange={event => setForm(value => ({ ...value, language: event.target.value }))} placeholder="e.g. Tamil, English" /></label><label>Genre<input value={form.genre || ''} onChange={event => setForm(value => ({ ...value, genre: event.target.value }))} placeholder="e.g. Drama, Jazz" /></label></div>
        {isVideo && <><label>Release date<input value={form.release_date || ''} onChange={event => setForm(value => ({ ...value, release_date: event.target.value }))} placeholder="YYYY-MM-DD" /></label><label>Synopsis<textarea rows={3} value={form.description || ''} onChange={event => setForm(value => ({ ...value, description: event.target.value }))} /></label></>}
        <label>Folder<select value={form.folder_id ?? ''} onChange={event => setForm(value => ({ ...value, folder_id: event.target.value ? Number(event.target.value) : null }))}><option value="">My Drive (root)</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
      </>}
      {folderDialog && <label>Parent folder<select value={form.parent_id ?? ''} onChange={event => setForm(value => ({ ...value, parent_id: event.target.value ? Number(event.target.value) : null }))}><option value="">My Drive (root)</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>}
      <div className="dialog-actions"><button type="button" className="button button-light" onClick={onClose}>Cancel</button><button className="button button-dark"><Check size={15}/>{kind === 'create-folder' ? 'Create folder' : 'Save changes'}</button></div>
    </form>
  </Modal>;
}

createRoot(document.getElementById('root')).render(<App />);
