import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { FileIcon } from './components/FileIcon';
import { DriveFolder, DriveMedia, DriveStats, driveApi, formatDriveBytes } from './driveApi';
import { colors } from './theme';

type Tab = 'Home' | 'Files' | 'Favorites' | 'Search';
type Breadcrumb = { id: number | null; name: string };
type RenameTarget = DriveFolder | DriveMedia;

const RECENTS_KEY = 'mobile-drive.recent-ids';

export default function DriveApp() {
  return <SafeAreaProvider><FileManager /></SafeAreaProvider>;
}

function FileManager() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('Home');
  const [media, setMedia] = useState<DriveMedia[]>([]);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [favorites, setFavorites] = useState<DriveMedia[]>([]);
  const [stats, setStats] = useState<DriveStats | null>(null);
  const [path, setPath] = useState<Breadcrumb[]>([{ id: null, name: 'My Drive' }]);
  const [query, setQuery] = useState('');
  const [serverResults, setServerResults] = useState<DriveMedia[]>([]);
  const [useGrid, setUseGrid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [nameDialog, setNameDialog] = useState<'folder' | 'rename' | null>(null);
  const [nameValue, setNameValue] = useState('');
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [preview, setPreview] = useState<DriveMedia | null>(null);
  const [recentIds, setRecentIds] = useState<number[]>([]);

  const currentFolderId = path[path.length - 1]?.id ?? null;
  const currentFolderName = path[path.length - 1]?.name ?? 'My Drive';
  const childFolders = useMemo(() => folders.filter((folder) => folder.parent_id === currentFolderId), [folders, currentFolderId]);
  const childMedia = useMemo(() => media.filter((item) => (item.folder_id ?? null) === currentFolderId), [media, currentFolderId]);
  const folderCount = (folderId: number) => folders.filter((folder) => folder.parent_id === folderId).length + media.filter((item) => item.folder_id === folderId).length;
  const recentItems = useMemo(() => recentIds.map((id) => media.find((item) => item.id === id)).filter((item): item is DriveMedia => !!item), [media, recentIds]);
  const storagePercent = stats && stats.total_bytes > 0 ? Math.min(100, stats.bytes / stats.total_bytes * 100) : 0;

  const refresh = useCallback(async (showSpinner = true) => {
    if (showSpinner) setBusy(true);
    setError('');
    try {
      const [nextMedia, nextFolders, nextFavorites, nextStats] = await Promise.all([
        driveApi.library(), driveApi.folders(), driveApi.favorites(), driveApi.stats(),
      ]);
      setMedia(nextMedia);
      setFolders(nextFolders);
      setFavorites(nextFavorites);
      setStats(nextStats);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect to the NAS.');
    } finally {
      setBusy(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([refresh(), AsyncStorage.getItem(RECENTS_KEY)]).then(([, saved]) => {
      if (saved) setRecentIds(JSON.parse(saved) as number[]);
    });
  }, [refresh]);

  useEffect(() => {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      setServerResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void driveApi.search(cleanQuery).then((result) => {
        if (!cancelled) setServerResults(result);
      }).catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Search failed.');
      });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  async function markRecent(item: DriveMedia) {
    const next = [item.id, ...recentIds.filter((id) => id !== item.id)].slice(0, 40);
    setRecentIds(next);
    await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  }

  function openMedia(item: DriveMedia) {
    void markRecent(item);
    if (/^(jpe?g|png|gif|heic|webp|bmp)$/i.test(item.name.split('.').pop() || '')) {
      setPreview(item);
      return;
    }
    void Linking.openURL(driveApi.streamUrl(item)).catch(() => setMessage(`Could not open ${item.name}.`));
  }

  async function uploadFiles() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
      if (result.canceled) return;
      setBusy(true);
      setMessage('');
      for (const asset of result.assets) {
        const form = new FormData();
        form.append('file', { uri: asset.uri, name: asset.name, type: asset.mimeType || 'application/octet-stream' } as unknown as Blob);
        await driveApi.upload(form, currentFolderId);
      }
      setMessage(`${result.assets.length} file${result.assets.length === 1 ? '' : 's'} uploaded to your NAS.`);
      await refresh(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  function startCreateFolder() {
    setNameValue('');
    setNameDialog('folder');
  }

  function startRename(target: RenameTarget) {
    setRenameTarget(target);
    setNameValue(target.name);
    setNameDialog('rename');
  }

  async function saveName() {
    const name = nameValue.trim();
    if (!name || name.includes('/') || name.includes('\\')) {
      setError('Enter a valid name without a slash.');
      return;
    }
    try {
      if (nameDialog === 'folder') await driveApi.createFolder(name, currentFolderId);
      else if (renameTarget) await driveApi.rename(renameTarget, name);
      setNameDialog(null);
      setRenameTarget(null);
      await refresh(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the name.');
    }
  }

  function showActions(target: RenameTarget) {
    const isFile = 'kind' in target;
    const isFavorite = isFile && favorites.some((item) => item.id === target.id);
    const actions: { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' }[] = [
      ...(isFile ? [{ text: isFavorite ? 'Remove from favorites' : 'Add to favorites', onPress: () => void toggleFavorite(target as DriveMedia) }] : []),
      { text: 'Rename', onPress: () => startRename(target) },
      { text: isFile ? 'Delete file' : 'Delete folder', style: 'destructive', onPress: () => confirmDelete(target) },
      { text: 'Cancel', style: 'cancel' },
    ];
    Alert.alert(target.name, undefined, actions);
  }

  async function toggleFavorite(item: DriveMedia) {
    const exists = favorites.some((favorite) => favorite.id === item.id);
    setFavorites((previous) => exists ? previous.filter((favorite) => favorite.id !== item.id) : [item, ...previous]);
    try {
      await driveApi.setFavorite(item, !exists);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update favorite.');
      await refresh(false);
    }
  }

  function confirmDelete(target: RenameTarget) {
    Alert.alert(`Delete ${'kind' in target ? 'file' : 'folder'}?`, target.name, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void (async () => {
        try {
          await driveApi.remove(target);
          await refresh(false);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Could not delete this item.');
        }
      })() },
    ]);
  }

  async function shareItem(item: DriveMedia) {
    try {
      const url = driveApi.streamUrl(item);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(url, { dialogTitle: item.name });
      else await Linking.openURL(url);
    } catch {
      setMessage(`Could not share ${item.name}.`);
    }
  }

  function goToFolder(folder: DriveFolder) {
    setPath((previous) => [...previous, { id: folder.id, name: folder.name }]);
    setTab('Files');
    setQuery('');
  }

  function openBreadcrumb(index: number) {
    setPath((previous) => previous.slice(0, index + 1));
    setTab('Files');
  }

  function renderHeader(title: string, action?: React.ReactNode) {
    return <View style={styles.header}><Text numberOfLines={1} style={styles.headerTitle}>{title}</Text>{action}</View>;
  }

  function renderSearch() {
    return <View style={styles.searchBox}>
      <Ionicons name="search" size={19} color={colors.textMuted} />
      <TextInput value={query} onChangeText={setQuery} placeholder="Search files on your NAS" placeholderTextColor={colors.textMuted} style={styles.searchInput} returnKeyType="search" />
      {query ? <Pressable onPress={() => setQuery('')}><Ionicons name="close-circle" size={18} color={colors.textMuted} /></Pressable> : null}
    </View>;
  }

  function renderFolder(folder: DriveFolder, grid = useGrid) {
    const count = folderCount(folder.id);
    return <Pressable key={`folder-${folder.id}`} onPress={() => goToFolder(folder)} onLongPress={() => showActions(folder)} style={[styles.entryCard, grid ? styles.gridCard : styles.listCard]}>
      <FileIcon item={folder} folderHasItems={count > 0} size={grid ? 83 : 60} />
      <View style={styles.entryCopy}>
        <Text numberOfLines={grid ? 2 : 1} style={[styles.entryName, grid && styles.gridName]}>{folder.name}</Text>
        <Text style={styles.entryMeta}>{count} {count === 1 ? 'item' : 'items'}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Actions for ${folder.name}`} onPress={() => showActions(folder)} style={grid ? styles.gridMore : styles.moreButton}><Ionicons name="ellipsis-vertical" size={18} color={colors.textSecondary} /></Pressable>
    </Pressable>;
  }

  function renderMedia(item: DriveMedia, grid = useGrid) {
    const isFavorite = favorites.some((favorite) => favorite.id === item.id);
    return <Pressable key={`media-${item.id}`} onPress={() => openMedia(item)} onLongPress={() => showActions(item)} style={[styles.entryCard, grid ? styles.gridCard : styles.listCard]}>
      <View style={styles.fileThumbnail}>
        <FileIcon item={item} size={grid ? 83 : 60} />
        {isFavorite ? <Ionicons name="heart" size={14} color="#F04452" style={styles.favoriteBadge} /> : null}
      </View>
      <View style={styles.entryCopy}>
        <Text numberOfLines={grid ? 2 : 1} style={[styles.entryName, grid && styles.gridName]}>{item.name}</Text>
        <Text numberOfLines={1} style={styles.entryMeta}>{formatDriveBytes(item.size)} · {item.kind}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Actions for ${item.name}`} onPress={() => showActions(item)} style={grid ? styles.gridMore : styles.moreButton}><Ionicons name="ellipsis-vertical" size={18} color={colors.textSecondary} /></Pressable>
    </Pressable>;
  }

  function renderEntries(fileItems: DriveMedia[], folderItems: DriveFolder[] = [], grid = useGrid) {
    const count = fileItems.length + folderItems.length;
    if (count === 0) return <View style={styles.emptyState}><Image source={require('../thumbnials/empty folder.png')} style={{ width: 104, height: 83, marginBottom: 4 }} resizeMode="contain" /><Text style={styles.emptyTitle}>Nothing here yet</Text><Text style={styles.emptyText}>Upload files or create a folder to keep everything synced with your NAS.</Text></View>;
    return <View style={grid ? styles.grid : styles.list}>{folderItems.map((folder) => renderFolder(folder, grid))}{fileItems.map((item) => renderMedia(item, grid))}</View>;
  }

  function renderHome() {
    const storageUsedPercent = Math.round(storagePercent);
    return <>
      {renderHeader('My Drive', <Pressable accessibilityRole="button" accessibilityLabel="Refresh NAS files" onPress={() => void refresh()} style={styles.headerAction}><Ionicons name="refresh" size={21} color={colors.accent} /></Pressable>)}
      <View style={styles.pageContent}>
        {renderSearch()}
        <View style={styles.storageCard}>
          <View style={styles.storageIcon}><Ionicons name="cloud" size={23} color={colors.accent} /></View>
          <View style={styles.storageCopy}><Text style={styles.storageTitle}>NAS storage</Text><Text style={styles.storageMeta}>{stats ? `${formatDriveBytes(stats.bytes)} used · ${formatDriveBytes(stats.free_bytes)} free` : 'Loading storage...'}</Text></View>
          <Text style={styles.storagePercent}>{stats ? `${storageUsedPercent}%` : '—'}</Text>
        </View>
        <View style={styles.quickActions}>
          <Pressable onPress={() => void uploadFiles()} style={styles.quickAction}><Ionicons name="cloud-upload-outline" size={21} color={colors.accent} /><Text style={styles.quickActionText}>Upload</Text></Pressable>
          <Pressable onPress={startCreateFolder} style={styles.quickAction}><Ionicons name="folder-outline" size={21} color={colors.accent} /><Text style={styles.quickActionText}>New folder</Text></Pressable>
          <Pressable onPress={() => setUseGrid((value) => !value)} style={styles.quickAction}><Ionicons name={useGrid ? 'list-outline' : 'grid-outline'} size={21} color={colors.accent} /><Text style={styles.quickActionText}>{useGrid ? 'List view' : 'Grid view'}</Text></Pressable>
        </View>
        <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Recent files</Text><Pressable onPress={() => { setPath([{ id: null, name: 'My Drive' }]); setTab('Files'); }}><Text style={styles.linkText}>Browse all</Text></Pressable></View>
        {renderEntries(recentItems.slice(0, 6), [], true)}
        <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Folders</Text><Text style={styles.sectionCount}>{folders.length}</Text></View>
        {renderEntries([], folders.filter((folder) => folder.parent_id == null).slice(0, 6), true)}
      </View>
    </>;
  }

  function renderFiles() {
    const showingSearch = tab === 'Search' && query.trim();
    const visibleItems = showingSearch ? serverResults : tab === 'Favorites' ? favorites : childMedia;
    const visibleFolders = !showingSearch && tab === 'Files' ? childFolders : [];
    return <>
      {renderHeader(tab === 'Favorites' ? 'Favorites' : tab === 'Search' ? 'Search' : currentFolderName, <View style={styles.headerActions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Upload to NAS" onPress={() => void uploadFiles()} style={styles.headerAction}><Ionicons name="cloud-upload-outline" size={22} color={colors.accent} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={useGrid ? 'Switch to list' : 'Switch to grid'} onPress={() => setUseGrid((value) => !value)} style={styles.headerAction}><Ionicons name={useGrid ? 'list-outline' : 'grid-outline'} size={22} color={colors.accent} /></Pressable>
      </View>)}
      <View style={styles.pageContent}>
        {tab === 'Search' ? renderSearch() : null}
        {tab === 'Files' ? <View style={styles.breadcrumbs}>{path.map((crumb, index) => <Pressable key={`${crumb.id}-${index}`} onPress={() => openBreadcrumb(index)} style={styles.breadcrumb}><Text numberOfLines={1} style={[styles.breadcrumbText, index === path.length - 1 && styles.breadcrumbSelected]}>{crumb.name}</Text>{index < path.length - 1 ? <Ionicons name="chevron-forward" size={14} color={colors.textMuted} /> : null}</Pressable>)}</View> : null}
        <View style={styles.listHeading}><Text style={styles.sectionTitle}>{showingSearch ? 'Search results' : tab === 'Favorites' ? 'Starred on your NAS' : 'Files and folders'}</Text><Text style={styles.sectionCount}>{visibleItems.length + visibleFolders.length}</Text></View>
        {renderEntries(visibleItems, visibleFolders)}
      </View>
    </>;
  }

  const page = tab === 'Home' ? renderHome() : renderFiles();

  return <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
    <View style={styles.screen}>
      {(busy || refreshing) ? <View style={styles.loadingOverlay}><ActivityIndicator size="large" color={colors.accent} /></View> : null}
      <ScrollView showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void refresh(false); }} tintColor={colors.accent} />} contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 18) + 72 }]}>
        {page}
        {error ? <Text style={styles.errorMessage}>{error}</Text> : null}
        {message ? <Text style={styles.statusMessage}>{message}</Text> : null}
      </ScrollView>
      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {(['Home', 'Files', 'Favorites', 'Search'] as Tab[]).map((item) => {
          const selected = tab === item;
          const icon = item === 'Home' ? 'home' : item === 'Files' ? 'folder' : item === 'Favorites' ? 'heart' : 'search';
          return <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => { setTab(item); if (item !== 'Search') setQuery(''); if (item === 'Files') setPath([{ id: null, name: 'My Drive' }]); }} style={styles.tabButton}>
            <Ionicons name={`${icon}${selected ? '' : '-outline'}` as React.ComponentProps<typeof Ionicons>['name']} size={21} color={selected ? colors.accent : colors.textMuted} />
            <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{item}</Text>
          </Pressable>;
        })}
      </View>
    </View>

    <Modal visible={!!nameDialog} transparent animationType="fade" onRequestClose={() => setNameDialog(null)}>
      <View style={styles.modalBackdrop}><View style={styles.dialog}>
        <Text style={styles.dialogTitle}>{nameDialog === 'folder' ? 'New folder' : 'Rename'}</Text>
        <TextInput autoFocus value={nameValue} onChangeText={setNameValue} placeholder="Name" placeholderTextColor={colors.textMuted} style={styles.nameInput} onSubmitEditing={() => void saveName()} />
        <View style={styles.dialogActions}><Pressable onPress={() => setNameDialog(null)} style={styles.dialogButton}><Text style={styles.dialogCancel}>Cancel</Text></Pressable><Pressable onPress={() => void saveName()} style={styles.dialogButton}><Text style={styles.dialogConfirm}>{nameDialog === 'folder' ? 'Create' : 'Save'}</Text></Pressable></View>
      </View></View>
    </Modal>

    <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
      <View style={styles.previewScreen}><View style={styles.previewHeader}>
        <Pressable onPress={() => setPreview(null)} style={styles.previewAction}><Ionicons name="close" size={23} color="#fff" /></Pressable>
        <Text numberOfLines={1} style={styles.previewTitle}>{preview?.name}</Text>
        {preview ? <Pressable onPress={() => void shareItem(preview)} style={styles.previewAction}><Ionicons name="share-outline" size={21} color="#fff" /></Pressable> : null}
      </View>
      {preview ? <Image source={{ uri: driveApi.streamUrl(preview) }} style={{ width: '100%', height: '80%' }} resizeMode="contain" /> : null}
      </View>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, screen: { flex: 1, backgroundColor: colors.background }, scrollContent: { flexGrow: 1 },
  header: { minHeight: 65, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 19 }, headerTitle: { flex: 1, color: colors.text, fontSize: 25, fontWeight: '700' }, headerActions: { flexDirection: 'row', alignItems: 'center' }, headerAction: { width: 42, height: 44, alignItems: 'center', justifyContent: 'center' },
  pageContent: { paddingHorizontal: 17, paddingBottom: 22 }, searchBox: { height: 45, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.surfaceSubtle, marginBottom: 16 }, searchInput: { flex: 1, height: '100%', color: colors.text, fontSize: 14 },
  storageCard: { minHeight: 83, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: colors.border, marginBottom: 13 }, storageIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.accentPale, marginRight: 12 }, storageCopy: { flex: 1 }, storageTitle: { color: colors.text, fontSize: 15, fontWeight: '600' }, storageMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 4 }, storagePercent: { color: colors.accentDark, fontSize: 15, fontWeight: '700' }, quickActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 10 }, quickAction: { minHeight: 47, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, backgroundColor: colors.accentPale }, quickActionText: { color: colors.accentDark, fontSize: 11, fontWeight: '600' },
  sectionHeading: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 7 }, sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '600' }, sectionCount: { color: colors.textMuted, fontSize: 12 }, linkText: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 }, list: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, entryCard: { position: 'relative' }, gridCard: { width: '33.333%', minHeight: 137, alignItems: 'center', paddingHorizontal: 4, paddingTop: 8, paddingBottom: 10 }, listCard: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingVertical: 5 }, fileThumbnail: { position: 'relative', width: 83, height: 83, alignItems: 'center', justifyContent: 'center' }, entryCopy: { flex: 1 }, entryName: { color: colors.text, fontSize: 13, fontWeight: '500' }, gridName: { width: '100%', textAlign: 'center', marginTop: 2 }, entryMeta: { color: colors.textMuted, fontSize: 10, marginTop: 4 }, moreButton: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' }, gridMore: { position: 'absolute', top: 0, right: 0, zIndex: 1, width: 27, height: 29, alignItems: 'center', justifyContent: 'center' }, favoriteBadge: { position: 'absolute', top: 3, right: 1, backgroundColor: '#fff', borderRadius: 8, overflow: 'hidden' },
  listHeading: { minHeight: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, breadcrumbs: { minHeight: 39, flexDirection: 'row', alignItems: 'center', gap: 5, overflow: 'hidden' }, breadcrumb: { maxWidth: 150, flexDirection: 'row', alignItems: 'center', gap: 4 }, breadcrumbText: { color: colors.textMuted, fontSize: 12 }, breadcrumbSelected: { color: colors.text, fontWeight: '600' },
  emptyState: { alignItems: 'center', paddingHorizontal: 22, paddingTop: 28, paddingBottom: 34 }, emptyFolderImage: { width: 104, height: 83, marginBottom: 4 }, emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'center' }, emptyText: { maxWidth: 270, color: colors.textMuted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 6 },
  errorMessage: { color: '#B42318', backgroundColor: '#FEF3F2', padding: 12, borderRadius: 9, marginHorizontal: 17, marginBottom: 12, fontSize: 12 }, statusMessage: { color: colors.textSecondary, fontSize: 12, marginHorizontal: 17, marginBottom: 12 }, loadingOverlay: { ...StyleSheet.absoluteFill, zIndex: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.6)' },
  tabBar: { position: 'absolute', bottom: 0, left: 0, right: 0, minHeight: 62, flexDirection: 'row', justifyContent: 'space-around', paddingTop: 7, paddingHorizontal: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surface }, tabButton: { minWidth: 63, minHeight: 47, alignItems: 'center', justifyContent: 'center', gap: 2 }, tabLabel: { color: colors.textMuted, fontSize: 10 }, tabLabelSelected: { color: colors.accent, fontWeight: '600' },
  modalBackdrop: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, backgroundColor: 'rgba(20,30,45,0.3)' }, dialog: { padding: 20, borderRadius: 13, backgroundColor: colors.surface }, dialogTitle: { color: colors.text, fontSize: 18, fontWeight: '600', marginBottom: 15 }, nameInput: { height: 45, paddingHorizontal: 11, borderWidth: 1, borderColor: colors.border, borderRadius: 8, color: colors.text, fontSize: 14 }, dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 18, marginTop: 18 }, dialogButton: { minWidth: 55, minHeight: 35, alignItems: 'center', justifyContent: 'center' }, dialogCancel: { color: colors.textSecondary, fontSize: 14 }, dialogConfirm: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  previewScreen: { flex: 1, justifyContent: 'center', backgroundColor: '#101318' }, previewHeader: { position: 'absolute', zIndex: 1, top: 16, left: 8, right: 8, flexDirection: 'row', alignItems: 'center' }, previewAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, previewTitle: { flex: 1, color: '#fff', fontSize: 14, textAlign: 'center' }, previewImage: { width: '100%', height: '80%' },
});
