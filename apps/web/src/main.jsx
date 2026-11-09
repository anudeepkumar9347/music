import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, ArrowDownToLine, ArrowLeft, AudioLines, Check, ChevronRight, CircleHelp, Cloud,
  Database, Film, File, FileAudio, FileImage, FileVideo, Folder, FolderPlus, HardDrive,
  Heart, LayoutDashboard, ListFilter, LoaderCircle, MoreHorizontal, Pencil, Plus,
  RefreshCw, Search, Settings2, ShieldCheck, Trash2, Upload, X, ListMusic, Languages,
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
  favorites: { title: 'Favorites', eyebrow: 'QUICK ACCESS', description: 'Your starred items, shared with the mobile apps.' },
};

function App() {
  const [section, setSection] = useState('overview');
  const [items, setItems] = useState([]);
  const [folders, setFolders] = useState([]);
  const [favorites, setFavorites] = useState([]);
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
  const [uploadQueue, setUploadQueue] = useState([]);
  const [uploadIndex, setUploadIndex] = useState(0);
  const [uploadForm, setUploadForm] = useState(null);
  const [uploadLookupBusy, setUploadLookupBusy] = useState(false);
  const [uploadLookupMessage, setUploadLookupMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [tokenDraft, setTokenDraft] = useState(getToken());
  const [apiUrlDraft, setApiUrlDraft] = useState(getApiBaseUrl());

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true); else setBusy(true);
    setError('');
    try {
      const [nextItems, nextFolders, nextFavorites, nextStats, nextPlaylists] = await Promise.all([
        api('/api/library'), api('/api/folders'), api('/api/favorites'), api('/api/stats'), api('/api/playlists'),
      ]);
      setItems(nextItems); setFolders(nextFolders); setFavorites(nextFavorites); setStats(nextStats); setPlaylists(nextPlaylists);
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
  const sectionItems = useMemo(() => {
    if (section === 'favorites') return favorites;
    const kind = section === 'music' ? 'music' : section === 'movies' ? 'movie' : 'file';
    const source = searchItems || items;
    let filtered = source.filter(item => (section === 'drive' ? item.kind === 'file' : item.kind === kind) && (section !== 'drive' || (item.folder_id ?? null) === folderId));
    if (section === 'music' && activePlaylist) filtered = playlistContents;
    if (section === 'movies' && movieTypeFilter !== 'all') filtered = filtered.filter(item => (item.media_type || 'movie') === movieTypeFilter);
    if (languageFilter) filtered = filtered.filter(item => item.language === languageFilter);
    if (genreFilter) filtered = filtered.filter(item => item.genre === genreFilter);
    return filtered;
  }, [activePlaylist, favorites, folderId, genreFilter, items, languageFilter, movieTypeFilter, playlistContents, searchItems, section]);
  const visibleItems = useMemo(() => {
    const matched = sectionItems.filter(item => !query.trim() || searchItems || `${item.name} ${item.title || ''} ${item.artist || ''} ${item.album || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    return [...matched].sort((a, b) => sort === 'name' ? (a.title || a.name).localeCompare(b.title || b.name) : sort === 'size' ? (b.size || 0) - (a.size || 0) : String(b.created_at || '').localeCompare(String(a.created_at || '')));
  }, [query, searchItems, sectionItems, sort]);
  const visibleFolders = section === 'drive' ? folders.filter(folder => folder.parent_id === folderId && (!query.trim() || folder.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))) : [];
  const favoriteIds = useMemo(() => new Set(favorites.map(item => item.id)), [favorites]);
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
        setUploadProgress(`Uploading ${uploaded + 1} of ${files.length}: ${file.name}`);
        const data = new FormData(); data.append('file', file);
        const destination = section === 'drive' && folderId ? `?folder_id=${folderId}` : '';
        await api(`/api/upload${destination}`, { method: 'POST', body: data });
        uploaded += 1;
      }
      flash(`${uploaded} ${uploaded === 1 ? 'file' : 'files'} uploaded and indexed.`);
      await load({ quiet: true });
    } catch (cause) {
      setError(`${cause.message}${uploaded ? ` (${uploaded} file${uploaded === 1 ? '' : 's'} uploaded before the error)` : ''}`);
      await load({ quiet: true });
    } finally { setBusy(false); setUploadProgress(''); event.target.value = ''; }
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
    setBusy(true); setError(''); setUploadProgress(`Uploading ${uploadIndex + 1} of ${uploadQueue.length}: ${currentUpload.name}`);
    try {
      await api('/api/upload', { method: 'POST', body: data });
      const nextIndex = uploadIndex + 1;
      if (nextIndex < uploadQueue.length) {
        const nextFile = uploadQueue[nextIndex]; setUploadIndex(nextIndex); setUploadForm(blankUploadMetadata(nextFile, kind));
        setBusy(false); setUploadProgress(''); void lookupUpload(nextFile, kind); return;
      }
      flash(`${uploadQueue.length} ${kind === 'music' ? 'music file' : 'video'}${uploadQueue.length === 1 ? '' : 's'} uploaded and indexed.`);
      setUploadQueue([]); setUploadIndex(0); setUploadForm(null); await load({ quiet: true });
    } catch (cause) { setError(cause.message || 'Upload failed. Your file is still available to retry.'); }
    finally { setBusy(false); setUploadProgress(''); }
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
  async function toggleFavorite(item) {
    const liked = favoriteIds.has(item.id);
    try {
      await api(`/api/favorites/${item.id}`, { method: liked ? 'DELETE' : 'POST' });
      setFavorites(previous => liked ? previous.filter(fav => fav.id !== item.id) : [item, ...previous]);
    } catch (cause) { setError(cause.message || 'Favorite update failed.'); }
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

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Cloud size={19} /></span><span>orbit<span className="brand-light">nas</span></span></div>
      <p className="workspace-label">LIBRARY</p>
      <nav className="side-nav" aria-label="Main navigation">
        <NavButton active={section === 'overview'} onClick={() => navigate('overview')} icon={<LayoutDashboard size={18} />} label="Overview" />
        <NavButton active={section === 'drive'} onClick={() => navigate('drive')} icon={<HardDrive size={18} />} label="Drive" count={categoryCounts.drive} />
        <NavButton active={section === 'music'} onClick={() => navigate('music')} icon={<AudioLines size={18} />} label="Music" count={categoryCounts.music} />
        <NavButton active={section === 'movies'} onClick={() => navigate('movies')} icon={<Film size={18} />} label="Movies" count={categoryCounts.movies} />
        <NavButton active={section === 'favorites'} onClick={() => navigate('favorites')} icon={<Heart size={18} />} label="Favorites" count={favorites.length} />
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-server"><span className="server-pulse" /><div><strong>NAS connected</strong><small>Private server</small></div></div>
        <button className="settings-link" onClick={() => { setTokenDraft(getToken()); setApiUrlDraft(getApiBaseUrl()); setSettingsOpen(true); }}><Settings2 size={17} /> Connection settings</button>
        <button className="settings-link" onClick={() => setCreditsOpen(true)}>About &amp; credits</button>
        <div className="sidebar-foot"><ShieldCheck size={16} /><span>Files stay on your network</span></div>
      </div>
    </aside>

    <main className="main-content">
      <header className="topbar">
        <div><p className="eyebrow">{meta.eyebrow}</p><h1>{libraryTitle}</h1></div>
        <div className="top-actions">
          <button className="icon-button" aria-label="Refresh library" onClick={() => void load()} disabled={busy}><RefreshCw size={18} className={busy ? 'spin' : ''} /></button>
          {section !== 'overview' && <label className="button button-dark upload-button"><Upload size={16} /> {section === 'music' ? 'Add music' : section === 'movies' ? 'Add videos' : 'Upload files'}<input type="file" multiple accept={section === 'music' ? 'audio/*' : section === 'movies' ? 'video/*' : undefined} onChange={section === 'music' || section === 'movies' ? beginMediaUpload : upload} disabled={busy} /></label>}
          <button className="avatar" title="Connection settings" onClick={() => { setTokenDraft(getToken()); setApiUrlDraft(getApiBaseUrl()); setSettingsOpen(true); }}>O</button>
        </div>
      </header>

      {section === 'overview' ? <Overview stats={stats} items={items} folders={folders} audit={audit} onNavigate={navigate} onAdmin={runAdminAction} busy={busy} /> : <>
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
        {uploadProgress && <div className="upload-status"><LoaderCircle size={16} className="spin" />{uploadProgress}<span className="progress-track"><span /></span></div>}
        <div className="section-heading"><div><p className="eyebrow">{section === 'drive' ? 'YOUR FILES' : section === 'favorites' ? 'SAVED ITEMS' : 'LIBRARY CONTENT'}</p><h2>{visibleItems.length + visibleFolders.length} items</h2></div><span className="view-note">{section === 'drive' ? 'Drag files or folders onto a folder to move them' : 'Synced with mobile apps'}</span></div>
        <div className={`library-grid ${section === 'drive' && driveLayout === 'list' ? 'list-layout' : ''}`}>
          {visibleFolders.map(folder => <FolderCard key={`folder-${folder.id}`} folder={folder} folders={folders} items={items} draggable={section === 'drive'} onDragStart={event => beginDriveDrag(event, 'folder', folder)} onDragOver={allowDriveDrop} onDragLeave={leaveDriveDrop} onDrop={event => void dropDriveItem(event, folder.id)} onOpen={openFolder} onEdit={() => editTarget(folder, 'folder')} onDelete={() => void removeTarget(folder, 'folder')} />)}
          {visibleItems.map(item => <MediaCard key={item.id} item={item} liked={favoriteIds.has(item.id)} draggable={section === 'drive'} onDragStart={event => beginDriveDrag(event, 'file', item)} onOpen={() => setSelected(item)} onEdit={() => editTarget(item, 'media')} onDelete={() => void removeTarget(item, 'media')} onFavorite={() => void toggleFavorite(item)} onPlaylist={section === 'music' ? () => { if (activePlaylist) void playlistAction('remove-track', null, item); else if (playlists.length === 1) void playlistAction('add-track', playlists[0], item); else { setPlaylistChoice(String(playlists[0]?.id || '')); setPlaylistPicker(item); } } : null} playlistMode={Boolean(activePlaylist)} onDownload={section === 'drive' ? () => window.open(playbackUrl(item), '_blank', 'noopener') : null} />)}
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
    {creditsOpen && <Modal title="About & credits" onClose={() => setCreditsOpen(false)}><div className="credits-content"><p>Movie and show metadata is provided by <a href="https://www.omdbapi.com/" target="_blank" rel="noreferrer">OMDb API</a>.</p></div></Modal>}
  </div>;
}

function NavButton({ active, onClick, icon, label, count }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span>{count > 0 && <small>{count}</small>}</button>;
}

function FilterSelect({ icon, label, value, options, onChange }) {
  return <label className="filter-select">{icon}<select value={value} onChange={event => onChange(event.target.value)} aria-label={`Filter by ${label.toLowerCase()}`}><option value="">All {label.toLowerCase()}s</option>{options.map(option => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function Overview({ stats, items, folders, audit, onNavigate, onAdmin, busy }) {
  const usage = stats?.total_bytes ? Math.min(100, (stats.total_bytes - stats.free_bytes) / stats.total_bytes * 100) : 0;
  return <div className="overview">
    <p className="page-description">Your private library, at a glance. Changes sync across the web and mobile apps.</p>
    <section className="welcome-card"><div><p className="eyebrow">ORBIT NAS · PRIVATE BY DESIGN</p><h2>Your library,<br /><em>all in one place.</em></h2><p>Files, music, and movies stored safely on your own hardware.</p></div><div className="welcome-art"><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><Cloud size={65}/><span>YOUR NAS</span></div></section>
    <div className="stats-grid">
      <StatCard icon={<Database size={18}/>} label="Indexed files" value={stats ? Number(stats.items).toLocaleString() : '—'} detail={`${folders.length} folders`} tone="mint" />
      <StatCard icon={<HardDrive size={18}/>} label="Library size" value={stats ? bytes(stats.bytes) : '—'} detail="Across all libraries" tone="blue" />
      <StatCard icon={<ArrowDownToLine size={18}/>} label="Available space" value={stats ? bytes(stats.free_bytes) : '—'} detail={stats ? `${bytes(stats.total_bytes)} total capacity` : 'NAS storage'} tone="lilac" />
    </div>
    <section className="storage-panel"><div className="panel-title"><div><p className="eyebrow">DISK USAGE</p><h3>Storage health</h3></div><span className="online-pill"><span/> Healthy</span></div><div className="storage-track"><span style={{ width: `${usage}%` }}/></div><div className="storage-caption"><span>{stats ? `${Math.round(usage)}% used` : 'Loading disk usage'}</span><span>{stats ? `${bytes(stats.free_bytes)} available` : ''}</span></div></section>
    <section className="workspace-grid">
      <WorkspaceCard icon={<HardDrive size={20}/>} tone="blue" title="Drive" count={items.length} detail="All files and folders" onClick={() => onNavigate('drive')} />
      <WorkspaceCard icon={<AudioLines size={20}/>} tone="mint" title="Music" count={items.filter(item => item.kind === 'music').length} detail="Audio ready to play" onClick={() => onNavigate('music')} />
      <WorkspaceCard icon={<Film size={20}/>} tone="peach" title="Movies" count={items.filter(item => item.kind === 'movie').length} detail="Video ready to stream" onClick={() => onNavigate('movies')} />
    </section>
    <section className="admin-panel"><div className="panel-title"><div><p className="eyebrow">ADMINISTRATION</p><h3>Server tools</h3></div></div><div className="admin-actions"><button className="admin-action" onClick={() => onAdmin('scan')} disabled={busy}><RefreshCw size={18}/><span><strong>Scan library</strong><small>Index files added outside the apps</small></span><ChevronRight size={17}/></button><button className="admin-action" onClick={() => onAdmin('backup')} disabled={busy}><Database size={18}/><span><strong>Back up database</strong><small>Create a point-in-time catalog backup</small></span><ChevronRight size={17}/></button></div></section>
    <section className="activity-panel"><div className="panel-title"><div><p className="eyebrow">RECENT ACTIVITY</p><h3>Latest changes</h3></div></div>{audit.length ? <div className="activity-list">{audit.map(event => <div className="activity-row" key={event.id}><span className="activity-dot"/><span className="activity-copy"><strong>{String(event.action).replaceAll('.', ' ')}</strong><small>{event.subject}</small></span><time>{dateLabel(event.created_at)}</time></div>)}</div> : <p className="empty-activity">Activity will appear here after you make changes.</p>}</section>
  </div>;
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

function MediaCard({ item, liked, onOpen, onEdit, onDelete, onFavorite, onPlaylist, playlistMode, onDownload, draggable = false, onDragStart }) {
  const kindLabel = item.kind === 'music' ? 'MUSIC' : item.kind === 'movie' ? item.media_type === 'show' ? 'TV SHOW' : 'MOVIE' : extension(item.name);
  const artwork = item.artwork_url || (item.artwork_path ? apiUrl(`/api/artwork/${item.id}`) : null);
  const ArtIcon = item.kind === 'music' ? FileAudio : item.kind === 'movie' ? FileVideo : /\.(png|jpe?g|gif|webp|heic)$/i.test(item.name) ? FileImage : File;
  return <article className={`asset-card ${item.kind}-asset`} draggable={draggable} onDragStart={onDragStart}><button className="asset-main" onClick={onOpen}>
    <div className={`asset-preview ${item.kind}`}>
      {artwork && item.kind !== 'file' ? <img src={`${artwork}${artwork.includes('?') ? '&' : '?'}token=${encodeURIComponent(getToken())}`} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none'; }} /> : null}
      <ArtIcon size={37}/><span>{kindLabel}</span>
    </div>
    <div className="asset-info"><strong title={item.name}>{item.title || item.name}</strong><small>{item.kind === 'music' ? [item.artist, item.album].filter(Boolean).join(' · ') || item.name : item.kind === 'movie' ? [item.media_type === 'show' ? 'TV show' : 'Movie', item.language, item.genre].filter(Boolean).join(' · ') : item.name}{item.size ? ` · ${bytes(item.size)}` : ''}</small></div>
  </button><button className={`favorite-action ${liked ? 'liked' : ''}`} title={liked ? 'Remove from favorites' : 'Add to favorites'} onClick={onFavorite}><Heart size={16} fill={liked ? 'currentColor' : 'none'}/></button><CardMenu onEdit={onEdit} onDelete={onDelete} onPlaylist={onPlaylist} playlistMode={playlistMode} onDownload={onDownload} /></article>;
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
