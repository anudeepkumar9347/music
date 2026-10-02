import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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

import { MediaCard } from './components/MediaCard';
import { VideoPlayerModal } from './components/VideoPlayerModal';
import { MOVIE_API_URL } from './config';
import { MediaItem, MediaKind, MovieApi } from './movieApi';
import { colors } from './theme';

type Tab = 'Home' | 'Browse' | 'Search' | 'Library';
type Collection = 'Favorites' | 'Recently Watched';

const STORAGE_KEYS = {
  config: 'mobile-movies.api.config',
  favorites: 'mobile-movies.favorites',
  recent: 'mobile-movies.recent',
};

const itemKey = (item: MediaItem) => `${item.type}:${item.id}`;

async function readSavedConfig(): Promise<string | null> {
  try {
    const secureConfig = await SecureStore.getItemAsync(STORAGE_KEYS.config);
    if (secureConfig) return secureConfig;
  } catch {
    // Secure storage is unavailable on web; use the local fallback below.
  }
  return AsyncStorage.getItem(STORAGE_KEYS.config);
}

async function saveConfig(value: string) {
  try {
    await SecureStore.setItemAsync(STORAGE_KEYS.config, value);
  } catch {
    await AsyncStorage.setItem(STORAGE_KEYS.config, value);
  }
}

export default function MovieApp() {
  return (
    <SafeAreaProvider>
      <MainApp />
    </SafeAreaProvider>
  );
}

function MainApp() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('Home');
  const [contentType, setContentType] = useState<MediaKind>('movie');
  const [collection, setCollection] = useState<Collection>('Favorites');
  const [movies, setMovies] = useState<MediaItem[]>([]);
  const [shows, setShows] = useState<MediaItem[]>([]);
  const [favorites, setFavorites] = useState<MediaItem[]>([]);
  const [recent, setRecent] = useState<MediaItem[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [playingMedia, setPlayingMedia] = useState<MediaItem | null>(null);
  const [api, setApi] = useState<MovieApi | null>(null);
  const [apiUrl, setApiUrl] = useState(MOVIE_API_URL);
  const [isConnected, setIsConnected] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isSettingsConnecting, setIsSettingsConnecting] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MediaItem[]>([]);
  const [selectedSearchType, setSelectedSearchType] = useState<'all' | MediaKind>('all');
  const [serverMessage, setServerMessage] = useState('');
  const [showBrandSplash, setShowBrandSplash] = useState(true);

  const allMedia = useMemo(() => [...movies, ...shows], [movies, shows]);
  const genres = useMemo(() => {
    const values = allMedia.flatMap((item) => item.genres);
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
  }, [allMedia]);
  const visibleMedia = (contentType === 'movie' ? movies : shows).filter((item) =>
    !selectedGenre || item.genres.includes(selectedGenre),
  );

  useEffect(() => {
    const splashTimer = setTimeout(() => setShowBrandSplash(false), 1800);
    void restoreAndSync();
    return () => clearTimeout(splashTimer);
  }, []);

  useEffect(() => {
    const search = query.trim();
    if (!search) {
      setSearchResults([]);
      setIsSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void searchCatalog(search, () => cancelled);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, api, allMedia]);

  async function restoreAndSync() {
    try {
      const [savedFavorites, savedRecent, savedConfig] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.favorites),
        AsyncStorage.getItem(STORAGE_KEYS.recent),
        readSavedConfig(),
      ]);
      if (savedFavorites) setFavorites(JSON.parse(savedFavorites) as MediaItem[]);
      if (savedRecent) setRecent(JSON.parse(savedRecent) as MediaItem[]);
      const savedUrl = savedConfig ? (JSON.parse(savedConfig) as { url?: string }).url : undefined;
      const targetUrl = savedUrl?.trim() || MOVIE_API_URL;
      setApiUrl(targetUrl);
      await syncCatalog(targetUrl, false);
    } catch {
      setServerMessage('Could not restore saved app data.');
    }
  }

  async function syncCatalog(url = apiUrl, showFeedback = true) {
    const baseUrl = url.trim().replace(/\/+$/, '');
    if (!baseUrl) {
      setServerMessage('Enter your NAS address to connect.');
      return false;
    }

    setIsSyncing(true);
    const nextApi = new MovieApi({ url: baseUrl });
    try {
      await nextApi.ping();
      const [movieResult, showResult] = await Promise.allSettled([
        nextApi.movies(),
        nextApi.shows(),
      ]);
      if (movieResult.status === 'rejected' && showResult.status === 'rejected') {
        throw movieResult.reason;
      }

      const nextMovies = movieResult.status === 'fulfilled' ? movieResult.value : [];
      const nextShows = showResult.status === 'fulfilled' ? showResult.value : [];
      setMovies(nextMovies);
      setShows(nextShows);
      setApi(nextApi);
      setApiUrl(baseUrl);
      setIsConnected(true);

      const serverFavorites = await nextApi.favorites().then((items) => items, () => null);
      if (serverFavorites !== null) {
        setFavorites(serverFavorites);
        await AsyncStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(serverFavorites));
      }
      await saveConfig(JSON.stringify({ url: baseUrl }));
      if (showFeedback) {
        setServerMessage(`Synced ${nextMovies.length} movies and ${nextShows.length} shows.`);
      }
      return true;
    } catch (error) {
      setApi(null);
      setIsConnected(false);
      if (showFeedback) {
        setServerMessage(error instanceof Error ? error.message : 'Could not connect to the NAS.');
      }
      return false;
    } finally {
      setIsSyncing(false);
    }
  }

  async function searchCatalog(search: string, isCancelled: () => boolean) {
    setIsSearchLoading(true);
    const localResults = allMedia.filter((item) =>
      `${item.title} ${item.synopsis ?? ''} ${item.genres.join(' ')}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
    );
    try {
      const results = api ? await api.search(search) : localResults;
      if (!isCancelled()) setSearchResults(results);
    } catch {
      if (!isCancelled()) setSearchResults(localResults);
    } finally {
      if (!isCancelled()) setIsSearchLoading(false);
    }
  }

  async function toggleFavorite(item: MediaItem) {
    const alreadyFavorite = favorites.some((saved) => itemKey(saved) === itemKey(item));
    const nextFavorites = alreadyFavorite
      ? favorites.filter((saved) => itemKey(saved) !== itemKey(item))
      : [item, ...favorites];
    setFavorites(nextFavorites);
    await AsyncStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(nextFavorites));

    if (api) {
      try {
        await api.setFavorite(item, !alreadyFavorite);
      } catch {
        setServerMessage('Saved on this device; NAS favorite sync failed.');
      }
    }
  }

  async function openDetails(item: MediaItem) {
    setSelectedMedia(item);
    if (!api) return;
    setIsDetailLoading(true);
    try {
      setSelectedMedia(await api.detail(item.type, item.id));
    } catch {
      setServerMessage('Showing saved catalog details; the NAS detail route was unavailable.');
    } finally {
      setIsDetailLoading(false);
    }
  }

  async function playMedia(item: MediaItem) {
    const source = api?.streamUrl(item) ?? item.streamUrl;
    if (!source) {
      Alert.alert('No stream available', 'This item does not include a playable stream URL.');
      return;
    }
    const nextRecent = [item, ...recent.filter((saved) => itemKey(saved) !== itemKey(item))].slice(0, 40);
    setRecent(nextRecent);
    await AsyncStorage.setItem(STORAGE_KEYS.recent, JSON.stringify(nextRecent));
    setPlayingMedia({ ...item, streamUrl: source });
  }

  function closeSettings() {
    setIsSettingsOpen(false);
  }

  function renderCard(item: MediaItem, style?: object) {
    const favorite = favorites.some((saved) => itemKey(saved) === itemKey(item));
    return (
      <MediaCard
        key={itemKey(item)}
        item={item}
        isFavorite={favorite}
        onOpen={() => void openDetails(item)}
        onToggleFavorite={() => void toggleFavorite(item)}
        style={style}
      />
    );
  }

  function renderRow(title: string, items: MediaItem[]) {
    if (items.length === 0) return null;
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mediaRow}>
          {items.map((item) => renderCard(item))}
        </ScrollView>
      </View>
    );
  }

  function renderMediaGrid(items: MediaItem[]) {
    return (
      <View style={styles.mediaGrid}>
        {items.map((item) => renderCard(item, styles.gridCard))}
      </View>
    );
  }

  function renderEmpty(title: string, message: string, showSettings = false) {
    return (
      <View style={styles.emptyState}>
        <View style={styles.emptyIcon}>
          <Ionicons name={isConnected ? 'film-outline' : 'server-outline'} size={25} color={colors.green} />
        </View>
        <Text style={styles.emptyTitle}>{title}</Text>
        <Text style={styles.emptyMessage}>{message}</Text>
        {showSettings ? (
          <Pressable onPress={() => setIsSettingsOpen(true)} style={styles.secondaryButton}>
            <Ionicons name="settings-outline" size={17} color={colors.text} />
            <Text style={styles.secondaryButtonLabel}>NAS settings</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  function renderHome() {
    const currentItems = contentType === 'movie' ? movies : shows;
    return (
      <>
        <View style={styles.hero}>
          <View style={styles.heroCopy}>
            <Text style={styles.heroEyebrow}>{isConnected ? 'NAS LIBRARY' : 'YOUR NAS LIBRARY'}</Text>
            <Text style={styles.heroTitle}>{isConnected ? 'Pick up a story.' : 'Connect your collection.'}</Text>
            <Text style={styles.heroSubtitle}>
              {isConnected ? `${movies.length} movies · ${shows.length} shows synced` : 'Browse and play your movies and shows from home.'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => isConnected ? setTab('Browse') : setIsSettingsOpen(true)}
            style={styles.playerButton}
          >
            <Ionicons name={isConnected ? 'play' : 'server-outline'} size={18} color={colors.background} />
            <Text style={styles.playerButtonLabel}>{isConnected ? 'Browse Movies' : 'Connect NAS'}</Text>
          </Pressable>
        </View>
        <View style={styles.segmentedControl} accessibilityRole="tablist">
          {(['movie', 'show'] as const).map((type) => {
            const selected = contentType === type;
            const label = type === 'movie' ? 'Movies' : 'Shows';
            return (
              <Pressable
                key={type}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => { setContentType(type); setSelectedGenre(null); }}
                style={[styles.segment, selected && styles.segmentSelected]}
              >
                <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        {recent.length > 0 ? renderRow('Recently Watched', recent.slice(0, 10)) : null}
        {currentItems.length > 0 ? renderRow(contentType === 'movie' ? 'Movies' : 'Shows', currentItems.slice(0, 20)) : null}
        {favorites.length > 0 ? renderRow('My List', favorites.slice(0, 10)) : null}
        {currentItems.length === 0 && renderEmpty(
          isConnected ? `No ${contentType === 'movie' ? 'movies' : 'shows'} found` : 'NAS not connected',
          isConnected ? 'This collection is empty on the connected server.' : 'Add the NAS address to sync its movie and show catalog.',
          !isConnected,
        )}
        {serverMessage ? <Text style={styles.inlineMessage}>{serverMessage}</Text> : null}
      </>
    );
  }

  function renderBrowse() {
    return (
      <>
        <View style={styles.segmentedControl} accessibilityRole="tablist">
          {(['movie', 'show'] as const).map((type) => {
            const selected = contentType === type;
            return (
              <Pressable
                key={type}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => { setContentType(type); setSelectedGenre(null); }}
                style={[styles.segment, selected && styles.segmentSelected]}
              >
                <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                  {type === 'movie' ? 'Movies' : 'Shows'}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {genres.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.genreList}>
            <GenreChip label="All" selected={!selectedGenre} onPress={() => setSelectedGenre(null)} />
            {genres.map((genre) => (
              <GenreChip key={genre} label={genre} selected={selectedGenre === genre} onPress={() => setSelectedGenre(genre)} />
            ))}
          </ScrollView>
        ) : null}
        {visibleMedia.length > 0
          ? renderMediaGrid(visibleMedia)
          : renderEmpty(
            isConnected ? `No ${selectedGenre ? `${selectedGenre} ` : ''}${contentType === 'movie' ? 'movies' : 'shows'} found` : 'Connect to your NAS',
            isConnected ? 'Try another genre or refresh the catalog.' : 'Connect your NAS to load its catalog.',
            !isConnected,
          )}
      </>
    );
  }

  function renderSearch() {
    const visibleResults = searchResults.filter((item) => selectedSearchType === 'all' || item.type === selectedSearchType);
    return (
      <>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={19} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Movies, shows, genres"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            returnKeyType="search"
          />
          {query ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={19} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.filterRow}>
          {(['all', 'movie', 'show'] as const).map((type) => (
            <GenreChip
              key={type}
              label={type === 'all' ? 'All' : type === 'movie' ? 'Movies' : 'Shows'}
              selected={selectedSearchType === type}
              onPress={() => setSelectedSearchType(type)}
            />
          ))}
        </View>
        {isSearchLoading ? <ActivityIndicator color={colors.green} style={styles.loader} /> : null}
        {query.trim() ? (
          visibleResults.length > 0
            ? renderMediaGrid(visibleResults)
            : renderEmpty('No matches', 'Try another title or search term.')
        ) : (
          <>
            {renderRow('Recently Watched', recent.slice(0, 10))}
            {recent.length === 0 ? renderEmpty('Search your library', 'Search the synced movie and show catalog.') : null}
          </>
        )}
      </>
    );
  }

  function renderLibrary() {
    const items = collection === 'Favorites' ? favorites : recent;
    return (
      <>
        <View style={styles.segmentedControl} accessibilityRole="tablist">
          {(['Favorites', 'Recently Watched'] as const).map((type) => {
            const selected = collection === type;
            return (
              <Pressable
                key={type}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setCollection(type)}
                style={[styles.segment, selected && styles.segmentSelected]}
              >
                <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{type}</Text>
              </Pressable>
            );
          })}
        </View>
        {items.length > 0
          ? renderMediaGrid(items)
          : renderEmpty(
            collection === 'Favorites' ? 'Your list is empty' : 'Nothing watched yet',
            collection === 'Favorites' ? 'Save movies and shows to find them here.' : 'Played titles will appear here.',
          )}
      </>
    );
  }

  function renderDetail() {
    if (!selectedMedia) return null;
    const isFavorite = favorites.some((saved) => itemKey(saved) === itemKey(selectedMedia));
    const itemGenres = selectedMedia.genres.join(' · ');
    return (
      <ScrollView contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
        <View style={styles.detailHeader}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => setSelectedMedia(null)} style={styles.iconButton}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </Pressable>
          <Text numberOfLines={1} style={styles.detailHeaderTitle}>{selectedMedia.title}</Text>
          <View style={styles.iconButton} />
        </View>
        <View style={styles.detailArtwork}>
          {selectedMedia.backdropUrl || selectedMedia.posterUrl ? (
            <Image
              source={{ uri: selectedMedia.backdropUrl ?? selectedMedia.posterUrl }}
              style={styles.detailImage}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.detailFallback}>
              <Ionicons name={selectedMedia.type === 'movie' ? 'film-outline' : 'tv-outline'} size={52} color={colors.green} />
            </View>
          )}
        </View>
        <View style={styles.detailInfo}>
          <Text style={styles.detailTitle}>{selectedMedia.title}</Text>
          <Text style={styles.detailMeta}>
            {[selectedMedia.year, selectedMedia.rating, selectedMedia.language, selectedMedia.type === 'movie' ? 'Movie' : 'Show'].filter(Boolean).join(' · ')}
          </Text>
          {itemGenres ? <Text style={styles.detailGenres}>{itemGenres}</Text> : null}
          <View style={styles.detailActions}>
            <Pressable onPress={() => void playMedia(selectedMedia)} style={styles.primaryButton}>
              <Ionicons name="play" size={18} color={colors.background} />
              <Text style={styles.primaryButtonLabel}>Play</Text>
            </Pressable>
            <Pressable onPress={() => void toggleFavorite(selectedMedia)} style={styles.secondaryButton}>
              <Ionicons name={isFavorite ? 'checkmark' : 'add'} size={19} color={colors.text} />
              <Text style={styles.secondaryButtonLabel}>{isFavorite ? 'In My List' : 'My List'}</Text>
            </Pressable>
          </View>
          {isDetailLoading ? <ActivityIndicator color={colors.green} style={styles.loader} /> : null}
          {selectedMedia.synopsis ? <Text style={styles.synopsis}>{selectedMedia.synopsis}</Text> : null}
        </View>
      </ScrollView>
    );
  }

  const title = selectedMedia ? '' : tab;
  const scrollContent = selectedMedia
    ? renderDetail()
    : tab === 'Home'
      ? renderHome()
      : tab === 'Browse'
        ? renderBrowse()
        : tab === 'Search'
          ? renderSearch()
          : renderLibrary();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />
      <View style={styles.screen}>
        {!selectedMedia ? (
          <View style={styles.topBar}>
            <View>
              <Text style={styles.eyebrow}>MOBILE MOVIES</Text>
              <Text style={styles.screenTitle}>{title}</Text>
            </View>
            <View style={styles.topActions}>
              <Pressable accessibilityRole="button" accessibilityLabel="Sync catalog" onPress={() => void syncCatalog()} style={styles.iconButton}>
                {isSyncing ? <ActivityIndicator size="small" color={colors.green} /> : <Ionicons name="sync-outline" size={21} color={colors.text} />}
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="NAS settings" onPress={() => setIsSettingsOpen(true)} style={styles.iconButton}>
                <Ionicons name="settings-outline" size={21} color={colors.text} />
              </Pressable>
            </View>
          </View>
        ) : null}

        <ScrollView
          key={selectedMedia ? `detail-${itemKey(selectedMedia)}` : tab}
          style={styles.scroll}
          contentContainerStyle={[styles.content, { paddingBottom: 28 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
          refreshControl={!selectedMedia ? <RefreshControl refreshing={isSyncing} onRefresh={() => void syncCatalog()} tintColor={colors.green} /> : undefined}
        >
          {scrollContent}
          {!selectedMedia ? (
            <View style={styles.creditsBox}>
              <View style={styles.omdbBadge}><Text style={styles.omdbBadgeText}>OMDb</Text></View>
              <Text style={styles.creditsText}>Movie and show metadata is provided by OMDb API.</Text>
            </View>
          ) : null}
        </ScrollView>

        {!selectedMedia ? (
          <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            {(['Home', 'Browse', 'Search', 'Library'] as const).map((item) => {
              const selected = tab === item;
              const icon = item === 'Home' ? 'home-outline' : item === 'Browse' ? 'grid-outline' : item === 'Search' ? 'search-outline' : 'bookmark-outline';
              return (
                <Pressable
                  key={item}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  onPress={() => setTab(item)}
                  style={styles.tabButton}
                >
                  <Ionicons name={icon} size={20} color={selected ? colors.green : colors.textMuted} />
                  <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{item}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {showBrandSplash ? (
          <View style={styles.brandSplash}>
            <View style={styles.brandMark}><Ionicons name="film-outline" size={76} color={colors.green} /></View>
            <Text style={styles.brandName}>Mobile Movies</Text>
            <Text style={styles.brandTagline}>STORIES WORTH WATCHING</Text>
            <View style={styles.brandAccent} />
          </View>
        ) : null}
      </View>

      <Modal visible={isSettingsOpen} animationType="slide" transparent onRequestClose={closeSettings}>
        <View style={styles.modalScrim}>
          <SafeAreaView style={styles.settingsSheet}>
            <View style={styles.settingsHeader}>
              <Text style={styles.settingsTitle}>NAS connection</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close settings" onPress={closeSettings} style={styles.iconButton}>
                <Ionicons name="close" size={23} color={colors.text} />
              </Pressable>
            </View>
            <Text style={styles.settingsLabel}>Server address</Text>
            <TextInput
              value={apiUrl}
              onChangeText={setApiUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="http://192.168.1.20:8000"
              placeholderTextColor={colors.textMuted}
              style={styles.urlInput}
            />
            <View style={styles.connectionStatus}>
              <View style={[styles.statusDot, isConnected && styles.statusDotConnected]} />
              <Text style={styles.connectionLabel}>{isConnected ? 'Connected to NAS' : 'Not connected'}</Text>
            </View>
            {serverMessage ? <Text style={styles.serverMessage}>{serverMessage}</Text> : null}
            <Pressable
              accessibilityRole="button"
              disabled={isSettingsConnecting}
              onPress={async () => {
                setIsSettingsConnecting(true);
                await syncCatalog(apiUrl);
                setIsSettingsConnecting(false);
              }}
              style={[styles.primaryButton, styles.connectButton]}
            >
              {isSettingsConnecting ? <ActivityIndicator color={colors.background} /> : <Ionicons name="sync-outline" size={18} color={colors.background} />}
              <Text style={styles.primaryButtonLabel}>{isSettingsConnecting ? 'Connecting' : 'Test and sync'}</Text>
            </Pressable>
          </SafeAreaView>
        </View>
      </Modal>

      {playingMedia ? (
        <VideoPlayerModal
          item={playingMedia}
          source={playingMedia.streamUrl ?? ''}
          onClose={() => setPlayingMedia(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

function GenreChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.genreChip, selected && styles.genreChipSelected]}>
      <Text style={[styles.genreChipLabel, selected && styles.genreChipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 8 },
  creditsBox: { marginTop: 24, paddingTop: 16, paddingBottom: 8, borderTopWidth: 1, borderTopColor: colors.divider, alignItems: 'flex-start' },
  omdbBadge: { minWidth: 58, height: 27, alignItems: 'center', justifyContent: 'center', marginBottom: 8, paddingHorizontal: 7, borderRadius: 4, backgroundColor: '#0d253f' },
  omdbBadgeText: { color: '#f5c518', fontSize: 14, fontWeight: '900', letterSpacing: -0.5 },
  creditsText: { maxWidth: 300, color: colors.textMuted, fontSize: 10, lineHeight: 15 },
  topBar: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  eyebrow: { color: colors.green, fontSize: 10, fontWeight: '700', letterSpacing: 1.1, marginBottom: 3 },
  screenTitle: { color: colors.text, fontSize: 27, fontWeight: '600' },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  hero: {
    padding: 18,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.card,
    marginBottom: 22,
  },
  heroCopy: { marginBottom: 16 },
  heroEyebrow: { color: colors.green, fontSize: 10, fontWeight: '700', letterSpacing: 1.1 },
  heroTitle: { color: colors.text, fontSize: 23, lineHeight: 29, fontWeight: '600', marginTop: 8 },
  heroSubtitle: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 6 },
  playerButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    paddingHorizontal: 15,
    borderRadius: 7,
    backgroundColor: colors.green,
  },
  playerButtonLabel: { color: colors.background, fontSize: 13, fontWeight: '600' },
  segmentedControl: {
    flexDirection: 'row',
    padding: 4,
    marginBottom: 22,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.background,
  },
  segment: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  segmentSelected: { backgroundColor: colors.card },
  segmentText: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  segmentTextSelected: { color: colors.text },
  section: { marginBottom: 28 },
  sectionTitle: { color: colors.text, fontSize: 19, fontWeight: '600', marginBottom: 13 },
  mediaRow: { gap: 12, paddingRight: 20 },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 22, paddingBottom: 20 },
  gridCard: { width: '48%' },
  genreList: { gap: 8, paddingBottom: 18 },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  genreChip: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 17, backgroundColor: colors.card },
  genreChipSelected: { backgroundColor: colors.greenDark, borderWidth: 1, borderColor: colors.green },
  genreChipLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '500' },
  genreChipLabelSelected: { color: colors.greenLight },
  emptyState: { alignItems: 'center', paddingHorizontal: 22, paddingTop: 66, paddingBottom: 52 },
  emptyIcon: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 27, backgroundColor: colors.greenDark, marginBottom: 15 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '600', textAlign: 'center' },
  emptyMessage: { maxWidth: 290, color: colors.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8 },
  inlineMessage: { color: colors.textMuted, fontSize: 12, lineHeight: 18, textAlign: 'center', paddingVertical: 12 },
  secondaryButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14, borderRadius: 7, borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.card, marginTop: 18 },
  secondaryButtonLabel: { color: colors.text, fontSize: 13, fontWeight: '500' },
  primaryButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18, borderRadius: 7, backgroundColor: colors.green },
  primaryButtonLabel: { color: colors.background, fontSize: 14, fontWeight: '600' },
  searchBar: { height: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13, borderRadius: 8, backgroundColor: colors.card, marginBottom: 16 },
  searchInput: { flex: 1, height: '100%', color: colors.text, fontSize: 14 },
  loader: { marginVertical: 20 },
  detailContent: { paddingBottom: 30 },
  detailHeader: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  detailHeaderTitle: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '500', textAlign: 'center' },
  detailArtwork: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.card },
  detailImage: { width: '100%', height: '100%' },
  detailFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardElevated },
  detailInfo: { paddingHorizontal: 20, paddingTop: 20 },
  detailTitle: { color: colors.text, fontSize: 25, lineHeight: 31, fontWeight: '600' },
  detailMeta: { color: colors.textSecondary, fontSize: 13, marginTop: 8 },
  detailGenres: { color: colors.greenLight, fontSize: 13, marginTop: 9 },
  detailActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  synopsis: { color: colors.textSecondary, fontSize: 14, lineHeight: 22, marginTop: 20 },
  tabBar: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: 8, paddingHorizontal: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.tabBarBorder, backgroundColor: colors.tabBar },
  tabButton: { minWidth: 72, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 3 },
  tabLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '500' },
  tabLabelSelected: { color: colors.green },
  modalScrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.72)' },
  settingsSheet: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 20, borderTopLeftRadius: 14, borderTopRightRadius: 14, backgroundColor: colors.card },
  settingsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  settingsTitle: { color: colors.text, fontSize: 21, fontWeight: '600' },
  settingsLabel: { color: colors.textSecondary, fontSize: 12, marginBottom: 8 },
  urlInput: { minHeight: 48, paddingHorizontal: 13, borderRadius: 7, borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.background, color: colors.text, fontSize: 14 },
  connectionStatus: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 15 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textMuted },
  statusDotConnected: { backgroundColor: colors.green },
  connectionLabel: { color: colors.textSecondary, fontSize: 13 },
  serverMessage: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 12 },
  connectButton: { marginTop: 20 },
  brandSplash: { ...StyleSheet.absoluteFill, zIndex: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  brandMark: { width: 142, height: 142, alignItems: 'center', justifyContent: 'center', borderRadius: 42, borderWidth: 1, borderColor: colors.greenDark, backgroundColor: colors.card },
  brandName: { color: colors.text, fontSize: 25, fontWeight: '600', marginTop: 25 },
  brandTagline: { color: colors.textSecondary, fontSize: 11, fontWeight: '500', marginTop: 7 },
  brandAccent: { width: 32, height: 3, borderRadius: 2, backgroundColor: colors.green, marginTop: 18 },
});
