import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text as NativeText,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { Album, ApiConfig, MusicApi, Playlist, Track } from './src/musicApi';
import { MUSIC_API_URL } from './src/config';
import { getColors, AppColors } from './src/theme';
import { Artwork } from './src/components/Artwork';

type Tab = 'ListenNow' | 'Library' | 'Search';
type LibrarySubScreen =
  | 'LibraryHome'
  | 'Playlists'
  | 'PlaylistDetail'
  | 'Artists'
  | 'ArtistDetail'
  | 'Songs'
  | 'Favorites'
  | 'AlbumDetail';

type SortOption = 'Title' | 'Recently Added' | 'Newest First' | 'Oldest First';

const ALPHABET_SCRUBBER = [
  '.', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '#', '?',
];

const STORAGE_KEYS = {
  config: 'sonora.api.config',
  playlists: 'sonora.playlists',
  favorites: 'sonora.favorites',
  recent: 'sonora.recent',
  theme: 'sonora.theme',
};

const SYSTEM_FONT_FAMILY = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  web: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
});

function Text(props: React.ComponentProps<typeof NativeText>) {
  return <NativeText {...props} style={[{ fontFamily: SYSTEM_FONT_FAMILY }, props.style]} />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <MainApp />
    </SafeAreaProvider>
  );
}

function MainApp() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  // Responsive artwork size for the Now Playing full screen modal
  const NOW_PLAYING_ARTWORK_SIZE = Math.min(
    windowWidth - 52,
    windowHeight * 0.42,
    340
  );

  // ============================================================
  // THEME STATE
  // ============================================================
  const [isDarkTheme, setIsDarkTheme] = useState(true);
  const C: AppColors = useMemo(() => getColors(isDarkTheme), [isDarkTheme]);

  function toggleTheme() {
    const next = !isDarkTheme;
    setIsDarkTheme(next);
    void AsyncStorage.setItem(STORAGE_KEYS.theme, next ? 'dark' : 'light');
  }

  // ============================================================
  // NAVIGATION STATE
  // ============================================================
  const [activeTab, setActiveTab] = useState<Tab>('ListenNow');
  const [libraryScreen, setLibraryScreen] = useState<LibrarySubScreen>('LibraryHome');
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [isLibraryEditing, setIsLibraryEditing] = useState(false);

  // ============================================================
  // MODALS & POPUPS
  // ============================================================
  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false);
  const [isServerSettingsOpen, setIsServerSettingsOpen] = useState(false);
  const [isNewPlaylistOpen, setIsNewPlaylistOpen] = useState(false);
  const [isAddToPlaylistOpen, setIsAddToPlaylistOpen] = useState(false);
  const [isRenamePlaylistOpen, setIsRenamePlaylistOpen] = useState(false);
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const [contextMenuTrack, setContextMenuTrack] = useState<Track | null>(null);
  const [showQueue, setShowQueue] = useState(false);

  // ============================================================
  // FORM STATES
  // ============================================================
  const [newPlaylistTitle, setNewPlaylistTitle] = useState('');
  const [newPlaylistDescription, setNewPlaylistDescription] = useState('');
  const [renamePlaylistTitle, setRenamePlaylistTitle] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('Title');
  const [searchQuery, setSearchQuery] = useState('');
  const [playlistSearchQuery, setPlaylistSearchQuery] = useState('');
  const [serverUrl, setServerUrl] = useState(MUSIC_API_URL);
  const [serverStatusMessage, setServerStatusMessage] = useState('');
  const [isConnectingServer, setIsConnectingServer] = useState(false);
  const [isLibraryLoading, setIsLibraryLoading] = useState(false);
  const [showBrandSplash, setShowBrandSplash] = useState(true);

  // ============================================================
  // REAL MUSIC & PLAYBACK STATE (No mock data)
  // ============================================================
  const [tracks, setTracks] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [favorites, setFavorites] = useState<Track[]>([]);
  const [recentTracks, setRecentTracks] = useState<Track[]>([]);
  const [queue, setQueue] = useState<Track[]>([]);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [hasStartedPlayback, setHasStartedPlayback] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const [client, setClient] = useState<MusicApi | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Editable Library Categories
  const [libraryCategories, setLibraryCategories] = useState([
    { id: 'playlists', title: 'Playlists', icon: 'list' as const, checked: true },
    { id: 'artists', title: 'Artists', icon: 'mic' as const, checked: true },
    { id: 'albums', title: 'Albums', icon: 'albums' as const, checked: true },
    { id: 'songs', title: 'Songs', icon: 'musical-note' as const, checked: true },
    { id: 'favorites', title: 'Favorites', icon: 'heart' as const, checked: true },
  ]);

  // Audio Player Hook
  const player = useAudioPlayer(null, { updateInterval: 500 });
  const playback = useAudioPlayerStatus(player);

  // Configure audio session on mount
  useEffect(() => {
    const splashTimer = setTimeout(() => setShowBrandSplash(false), 2000);
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    });
    void initializeAppAndLoadServer();
    return () => clearTimeout(splashTimer);
  }, []);

  // Update lock screen metadata when current track changes
  useEffect(() => {
    if (!currentTrack || !hasStartedPlayback) {
      player.clearLockScreenControls();
      return;
    }
    try {
      player.setActiveForLockScreen(true, {
        title: currentTrack.title,
        artist: currentTrack.artist,
        albumTitle: currentTrack.album,
        artworkUrl: currentTrack.coverArt,
      }, {
        showSeekForward: true,
        showSeekBackward: true,
      });
    } catch {}
  }, [currentTrack, hasStartedPlayback, player]);

  // Auto-advance track when current track completes
  useEffect(() => {
    if (playback.didJustFinish) {
      void playNextTrack();
    }
  }, [playback.didJustFinish]);

  // ============================================================
  // INITIALIZATION
  // ============================================================
  async function initializeAppAndLoadServer() {
    setIsLibraryLoading(true);
    try {
      // 1. Restore local data
      const savedPlaylists = await AsyncStorage.getItem(STORAGE_KEYS.playlists);
      const savedFavorites = await AsyncStorage.getItem(STORAGE_KEYS.favorites);
      const savedRecents = await AsyncStorage.getItem(STORAGE_KEYS.recent);
      const savedTheme = await AsyncStorage.getItem(STORAGE_KEYS.theme);

      if (savedPlaylists) setPlaylists(JSON.parse(savedPlaylists) as Playlist[]);
      if (savedFavorites) setFavorites(JSON.parse(savedFavorites) as Track[]);
      if (savedRecents) setRecentTracks(JSON.parse(savedRecents) as Track[]);
      if (savedTheme) setIsDarkTheme(savedTheme !== 'light');

      // 2. Read saved API URL
      let targetUrl = MUSIC_API_URL;
      const savedConfig = await AsyncStorage.getItem(STORAGE_KEYS.config);
      if (savedConfig) {
        try {
          const parsed = JSON.parse(savedConfig) as ApiConfig;
          if (parsed.url && parsed.url.trim()) {
            targetUrl = parsed.url.trim();
          }
        } catch {}
      }
      setServerUrl(targetUrl);

      // 3. Auto-pull from NAS
      if (targetUrl) {
        await connectServer(targetUrl, false);
      }
    } catch {
      // Offline – handled gracefully
    } finally {
      setIsLibraryLoading(false);
    }
  }

  // ============================================================
  // SERVER CONNECTION
  // ============================================================
  async function connectServer(url: string, showFeedback = true): Promise<boolean> {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (!trimmed) {
      if (showFeedback) setServerStatusMessage('Please enter a server address.');
      return false;
    }
    setIsConnectingServer(true);
    const nextClient = new MusicApi({ url: trimmed });
    try {
      await nextClient.ping();
      const serverAlbums = await nextClient.albums(100);
      const songLists = await Promise.all(
        serverAlbums.map((a) => nextClient.albumTracks(a.id).catch(() => []))
      );
      const serverTracks = songLists.flat();
      const serverFavs = await nextClient.favorites().then((items) => items, () => null);

      setClient(nextClient);
      setIsConnected(true);
      setAlbums(serverAlbums);
      setTracks(serverTracks);

      if (serverFavs) {
        setFavorites(serverFavs);
        await AsyncStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(serverFavs));
      }

      if (!currentTrack && serverTracks.length > 0) {
        setCurrentTrack(serverTracks[0]);
        setQueue(serverTracks);
      }

      await AsyncStorage.setItem(
        STORAGE_KEYS.config,
        JSON.stringify({ url: trimmed })
      );

      if (showFeedback) {
        setServerStatusMessage(
          `Connected! ${serverTracks.length} tracks, ${serverAlbums.length} albums.`
        );
      }
      return true;
    } catch (err) {
      setIsConnected(false);
      if (showFeedback) {
        setServerStatusMessage(
          err instanceof Error
            ? `Connection failed: ${err.message}`
            : 'Could not connect to the server.'
        );
      }
      return false;
    } finally {
      setIsConnectingServer(false);
    }
  }

  // ============================================================
  // PLAYBACK
  // ============================================================
  async function playTrack(track: Track, newQueue?: Track[]) {
    try {
      const stream = client ? client.streamUrl(track) : track.streamUrl;
      if (!stream) {
        Alert.alert('Cannot Play Track', 'No audio stream available.');
        return;
      }
      // Stop the old web audio element first. Expo's web player otherwise
      // resumes automatically during replace() when the previous track was playing.
      player.pause();
      player.replace({ uri: stream, name: track.title });
      player.play();
      setHasStartedPlayback(true);
      setCurrentTrack(track);

      const resolvedQueue =
        newQueue && newQueue.length > 0 ? newQueue : queue.length > 0 ? queue : [track];
      setQueue(resolvedQueue);

      const nextRecent = [
        track,
        ...recentTracks.filter((t) => t.id !== track.id),
      ].slice(0, 30);
      setRecentTracks(nextRecent);
      void AsyncStorage.setItem(STORAGE_KEYS.recent, JSON.stringify(nextRecent));
    } catch (err) {
      Alert.alert(
        'Playback Error',
        err instanceof Error ? err.message : 'Could not play audio track.'
      );
    }
  }

  async function playNextTrack() {
    if (!queue.length) return;
    const currentIndex = queue.findIndex((t) => t.id === currentTrack?.id);
    if (repeat && currentTrack) {
      await player.seekTo(0);
      player.play();
      return;
    }
    const nextIndex = shuffle
      ? Math.floor(Math.random() * queue.length)
      : (currentIndex + 1) % queue.length;
    if (queue[nextIndex]) await playTrack(queue[nextIndex], queue);
  }

  async function playPreviousTrack() {
    if (playback.currentTime > 3) {
      await player.seekTo(0);
      return;
    }
    if (!queue.length) return;
    const currentIndex = queue.findIndex((t) => t.id === currentTrack?.id);
    const prevIndex = (currentIndex - 1 + queue.length) % queue.length;
    if (queue[prevIndex]) await playTrack(queue[prevIndex], queue);
  }

  // ============================================================
  // FAVORITES
  // ============================================================
  function toggleFavorite(track: Track) {
    const isFav = favorites.some((t) => t.id === track.id);
    const updated = isFav
      ? favorites.filter((t) => t.id !== track.id)
      : [track, ...favorites];
    setFavorites(updated);
    void AsyncStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(updated));
    if (client) void client.setFavorite(track.id, !isFav).catch(() => {});
  }

  // ============================================================
  // PLAYLIST CRUD
  // ============================================================
  function savePlaylists(updated: Playlist[]) {
    setPlaylists(updated);
    void AsyncStorage.setItem(STORAGE_KEYS.playlists, JSON.stringify(updated));
  }

  function handleCreatePlaylist() {
    if (!newPlaylistTitle.trim()) {
      Alert.alert('Name Required', 'Please enter a name for your playlist.');
      return;
    }
    const newPlaylist: Playlist = {
      id: `playlist-${Date.now()}`,
      name: newPlaylistTitle.trim(),
      description: newPlaylistDescription.trim(),
      updatedAt: new Date().toLocaleDateString(),
      coverArt: undefined,
      tracks: [],
    };
    const updated = [newPlaylist, ...playlists];
    savePlaylists(updated);
    setNewPlaylistTitle('');
    setNewPlaylistDescription('');
    setIsNewPlaylistOpen(false);
    setSelectedPlaylist(newPlaylist);
    setLibraryScreen('PlaylistDetail');
  }

  // Add a track to an existing playlist
  function addTrackToPlaylist(track: Track, playlist: Playlist) {
    const alreadyIn = playlist.tracks.some((t) => t.id === track.id);
    if (alreadyIn) {
      Alert.alert('Already Added', `"${track.title}" is already in "${playlist.name}".`);
      return;
    }
    const updatedPlaylist: Playlist = {
      ...playlist,
      tracks: [...playlist.tracks, track],
      updatedAt: new Date().toLocaleDateString(),
    };
    const updated = playlists.map((p) => (p.id === playlist.id ? updatedPlaylist : p));
    savePlaylists(updated);
    // Keep selectedPlaylist in sync
    if (selectedPlaylist?.id === playlist.id) setSelectedPlaylist(updatedPlaylist);
  }

  // Remove a track from the current playlist
  function removeTrackFromPlaylist(track: Track) {
    if (!selectedPlaylist) return;
    const updatedPlaylist: Playlist = {
      ...selectedPlaylist,
      tracks: selectedPlaylist.tracks.filter((t) => t.id !== track.id),
      updatedAt: new Date().toLocaleDateString(),
    };
    const updated = playlists.map((p) =>
      p.id === selectedPlaylist.id ? updatedPlaylist : p
    );
    savePlaylists(updated);
    setSelectedPlaylist(updatedPlaylist);
  }

  // Delete a playlist entirely
  function deletePlaylist(playlist: Playlist) {
    Alert.alert(
      'Delete Playlist',
      `Are you sure you want to delete "${playlist.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const updated = playlists.filter((p) => p.id !== playlist.id);
            savePlaylists(updated);
            setLibraryScreen('Playlists');
            setSelectedPlaylist(null);
          },
        },
      ]
    );
  }

  // Rename a playlist
  function handleRenamePlaylist() {
    if (!selectedPlaylist || !renamePlaylistTitle.trim()) return;
    const updatedPlaylist: Playlist = {
      ...selectedPlaylist,
      name: renamePlaylistTitle.trim(),
      updatedAt: new Date().toLocaleDateString(),
    };
    const updated = playlists.map((p) =>
      p.id === selectedPlaylist.id ? updatedPlaylist : p
    );
    savePlaylists(updated);
    setSelectedPlaylist(updatedPlaylist);
    setRenamePlaylistTitle('');
    setIsRenamePlaylistOpen(false);
  }

  // ============================================================
  // DERIVED DATA
  // ============================================================
  const artistsList = useMemo(() => {
    const map = new Map<string, Track[]>();
    for (const track of tracks) {
      const art = track.artist || 'Unknown Artist';
      if (!map.has(art)) map.set(art, []);
      map.get(art)!.push(track);
    }
    return Array.from(map.entries())
      .map(([artist, artistTracks]) => ({
        name: artist,
        tracks: artistTracks,
        coverArt: artistTracks[0]?.coverArt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tracks]);

  const sortedTracks = useMemo(() => {
    const list = [...tracks];
    if (sortOption === 'Title') return list.sort((a, b) => a.title.localeCompare(b.title));
    if (sortOption === 'Recently Added' || sortOption === 'Newest First') return list.reverse();
    return list;
  }, [tracks, sortOption]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q)
    );
  }, [tracks, searchQuery]);

  const filteredPlaylists = useMemo(() => {
    const q = playlistSearchQuery.trim().toLowerCase();
    if (!q) return playlists;
    return playlists.filter((p) => p.name.toLowerCase().includes(q));
  }, [playlists, playlistSearchQuery]);

  function formatTime(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  // ============================================================
  // RENDERERS
  // ============================================================

  // ---- MINI PLAYER (BlurView frosted glass) ----
  const renderMiniPlayer = () => {
    if (!currentTrack) return null;
    return (
      <TouchableOpacity
        activeOpacity={0.92}
        style={[
          styles.miniPlayer,
          {
            bottom: 58 + insets.bottom,
            borderColor: isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
          },
        ]}
        onPress={() => setIsNowPlayingOpen(true)}
      >
        <BlurView
          intensity={isDarkTheme ? 80 : 70}
          tint={isDarkTheme ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.miniPlayerContent}>
          <Artwork uri={currentTrack.coverArt} title={currentTrack.title} size={42} radius={6} />
          <View style={styles.miniTextWrapper}>
            <Text numberOfLines={1} style={[styles.miniTitle, { color: C.text }]}>
              {currentTrack.title}
            </Text>
            <Text numberOfLines={1} style={[styles.miniArtist, { color: C.b200 }]}>
              {currentTrack.artist}
            </Text>
          </View>
          <TouchableOpacity
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.miniButton}
            onPress={() => (playback.playing ? player.pause() : player.play())}
          >
            <Ionicons name={playback.playing ? 'pause' : 'play'} size={22} color={C.text} />
          </TouchableOpacity>
          <TouchableOpacity
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.miniButton}
            onPress={() => void playNextTrack()}
          >
            <Ionicons name="play-skip-forward" size={22} color={C.text} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  // ---- TAB BAR (BlurView frosted glass) ----
  const renderTabBar = () => (
    <View
      style={[
        styles.tabBar,
        {
          height: 54 + insets.bottom,
          paddingBottom: insets.bottom > 0 ? insets.bottom - 4 : 4,
          borderTopColor: isDarkTheme ? C.tabBarBorder : 'rgba(0,0,0,0.12)',
        },
      ]}
    >
      <BlurView
        intensity={isDarkTheme ? 90 : 80}
        tint={isDarkTheme ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.tabBarInner}>
        <TouchableOpacity
          activeOpacity={0.7}
          style={styles.tabItem}
          onPress={() => setActiveTab('ListenNow')}
        >
          <Ionicons
            name={activeTab === 'ListenNow' ? 'play-circle' : 'play-circle-outline'}
            size={25}
            color={activeTab === 'ListenNow' ? C.red : C.b200}
          />
          <Text style={[styles.tabLabel, { color: activeTab === 'ListenNow' ? C.red : C.b200 }]}>
            Listen Now
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.7}
          style={styles.tabItem}
          onPress={() => { setActiveTab('Library'); setLibraryScreen('LibraryHome'); }}
        >
          <Ionicons
            name="library"
            size={24}
            color={activeTab === 'Library' ? C.red : C.b200}
          />
          <Text style={[styles.tabLabel, { color: activeTab === 'Library' ? C.red : C.b200 }]}>
            Library
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.7}
          style={styles.tabItem}
          onPress={() => setActiveTab('Search')}
        >
          <Ionicons
            name="search-outline"
            size={24}
            color={activeTab === 'Search' ? C.red : C.b200}
          />
          <Text style={[styles.tabLabel, { color: activeTab === 'Search' ? C.red : C.b200 }]}>
            Search
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ============================================================
  // TAB 1: LISTEN NOW
  // ============================================================
  const renderListenNow = () => (
    <ScrollView
      style={[styles.screenScroll, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: 130 + insets.bottom }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header with server icon + theme toggle */}
      <View style={[styles.largeHeader, { paddingTop: Math.max(insets.top, 14) }]}>
        <View>
          <Text style={[styles.largeTitle, { color: C.text }]}>Listen Now</Text>
          <Text style={[styles.headerSubtitle, { color: C.b200 }]}>
            {isConnected ? '● Connected to NAS' : '● Offline · Check Server'}
          </Text>
        </View>
        <View style={styles.headerIconsRow}>
          {/* Light/Dark Theme Toggle */}
          <TouchableOpacity onPress={toggleTheme} style={[styles.serverIconButton, { backgroundColor: C.cardSecondary, marginRight: 10 }]}>
            <Ionicons
              name={isDarkTheme ? 'sunny-outline' : 'moon-outline'}
              size={20}
              color={C.text}
            />
          </TouchableOpacity>
          {/* Server Settings */}
          <TouchableOpacity
            onPress={() => setIsServerSettingsOpen(true)}
            style={[styles.serverIconButton, { backgroundColor: C.cardSecondary }]}
          >
            <Ionicons
              name="server-outline"
              size={22}
              color={isConnected ? '#34C759' : C.red}
            />
          </TouchableOpacity>
        </View>
      </View>

      {isLibraryLoading && tracks.length === 0 && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.red} />
          <Text style={[styles.loadingText, { color: C.b200 }]}>Connecting to NAS & loading library...</Text>
        </View>
      )}

      {tracks.length > 0 ? (
        <View style={[styles.personalHeroCard, { backgroundColor: C.cardSecondary }]}>
          <View style={styles.personalHeroLeft}>
            <Text style={[styles.heroKicker, { color: C.red }]}>MUSIC ON YOUR NAS</Text>
            <Text style={[styles.heroTitle, { color: C.text }]}>Your Library, At Home</Text>
            <Text style={[styles.heroDetail, { color: C.b100 }]}>
              {tracks.length} songs · {albums.length} albums
            </Text>
          </View>
          <TouchableOpacity
            activeOpacity={0.8}
            style={[styles.heroPlayCircle, { backgroundColor: C.red }]}
            onPress={() => {
              setShuffle(true);
              const rand = Math.floor(Math.random() * tracks.length);
              if (tracks[rand]) void playTrack(tracks[rand], tracks);
            }}
          >
            <Ionicons name="shuffle" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      ) : !isLibraryLoading ? (
        <View style={[styles.emptyServerCard, { backgroundColor: C.card, borderColor: C.divider }]}>
          <Ionicons name="server-outline" size={44} color={C.red} />
          <Text style={[styles.emptyServerTitle, { color: C.text }]}>Connect to Your NAS</Text>
          <Text style={[styles.emptyServerSubtitle, { color: C.b200 }]}>
            Set your server address in settings to stream music from your home server.
          </Text>
          <TouchableOpacity
            style={[styles.emptyServerButton, { backgroundColor: C.red }]}
            onPress={() => setIsServerSettingsOpen(true)}
          >
            <Text style={styles.emptyServerButtonText}>Open Server Settings</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Recently Added Albums */}
      {albums.length > 0 && (
        <View style={styles.sectionContainer}>
          <Text style={[styles.sectionHeaderTitle, { color: C.text }]}>Recently Added</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
            {albums.slice(0, 12).map((album) => (
              <TouchableOpacity
                key={album.id}
                activeOpacity={0.8}
                style={styles.cardItem}
                onPress={() => {
                  setSelectedAlbum(album);
                  setLibraryScreen('AlbumDetail');
                  setActiveTab('Library');
                }}
              >
                <Artwork uri={album.coverArt} title={album.name} size={148} radius={8} />
                <Text numberOfLines={1} style={[styles.cardTitle, { color: C.text }]}>{album.name}</Text>
                <Text numberOfLines={1} style={[styles.cardSubtitle, { color: C.b200 }]}>{album.artist}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Recently Played */}
      {recentTracks.length > 0 && (
        <View style={styles.sectionContainer}>
          <Text style={[styles.sectionHeaderTitle, { color: C.text }]}>Recently Played</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
            {recentTracks.slice(0, 10).map((track) => (
              <TouchableOpacity
                key={track.id}
                activeOpacity={0.8}
                style={styles.cardItem}
                onPress={() => void playTrack(track, recentTracks)}
              >
                <Artwork uri={track.coverArt} title={track.title} size={148} radius={8} />
                <Text numberOfLines={1} style={[styles.cardTitle, { color: C.text }]}>{track.title}</Text>
                <Text numberOfLines={1} style={[styles.cardSubtitle, { color: C.b200 }]}>{track.artist}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* All Albums Grid */}
      {albums.length > 0 && (
        <View style={styles.recentlyAddedSection}>
          <Text style={[styles.recentlyAddedTitle, { color: C.text }]}>All Albums</Text>
          <View style={styles.twoColumnGrid}>
            {albums.map((album) => (
              <TouchableOpacity
                key={album.id}
                activeOpacity={0.8}
                style={styles.gridAlbumCard}
                onPress={() => {
                  setSelectedAlbum(album);
                  setLibraryScreen('AlbumDetail');
                  setActiveTab('Library');
                }}
              >
                <Artwork uri={album.coverArt} title={album.name} size="100%" radius={10} />
                <Text numberOfLines={1} style={[styles.gridAlbumTitle, { color: C.text }]}>{album.name}</Text>
                <Text numberOfLines={1} style={[styles.gridAlbumSubtitle, { color: C.b200 }]}>{album.artist}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );

  // ============================================================
  // TAB 2: LIBRARY
  // ============================================================
  const renderLibraryHome = () => (
    <ScrollView
      style={[styles.screenScroll, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: 130 + insets.bottom }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.largeHeader, { paddingTop: Math.max(insets.top, 14) }]}>
        <Text style={[styles.largeTitle, { color: C.text }]}>Library</Text>
        <TouchableOpacity onPress={() => setIsLibraryEditing(!isLibraryEditing)} style={styles.headerButton}>
          <Text style={[styles.headerActionRed, { color: C.red }]}>{isLibraryEditing ? 'Done' : 'Edit'}</Text>
        </TouchableOpacity>
      </View>
      <View style={[styles.titleDivider, { backgroundColor: C.divider }]} />

      {isLibraryEditing ? (
        <View style={styles.editList}>
          {libraryCategories.map((item) => (
            <View key={item.id} style={[styles.editRow, { borderBottomColor: C.divider }]}>
              <TouchableOpacity
                onPress={() => setLibraryCategories((prev) => prev.map((c) => c.id === item.id ? { ...c, checked: !c.checked } : c))}
                style={styles.checkCircle}
              >
                {item.checked ? (
                  <Ionicons name="checkmark-circle" size={24} color={C.red} />
                ) : (
                  <View style={[styles.uncheckedCircle, { borderColor: C.b300 }]} />
                )}
              </TouchableOpacity>
              <Ionicons name={item.icon} size={22} color={C.red} style={{ marginLeft: 14 }} />
              <Text style={[styles.menuRowTitle, { color: C.text }]}>{item.title}</Text>
              <Ionicons name="reorder-three" size={28} color={C.b400} style={{ marginLeft: 'auto' }} />
            </View>
          ))}
        </View>
      ) : (
        <View style={[styles.libraryMenu, { }]}>
          <TouchableOpacity style={styles.menuRow} activeOpacity={0.7} onPress={() => setLibraryScreen('Playlists')}>
            <Ionicons name="list" size={23} color={C.red} />
            <Text style={[styles.menuRowTitle, { color: C.text }]}>Playlists</Text>
            <Ionicons name="chevron-forward" size={18} color={C.b400} style={styles.rowChevron} />
          </TouchableOpacity>
          <View style={[styles.rowDivider, { backgroundColor: C.divider }]} />

          <TouchableOpacity style={styles.menuRow} activeOpacity={0.7} onPress={() => setLibraryScreen('Artists')}>
            <Ionicons name="mic" size={22} color={C.red} />
            <Text style={[styles.menuRowTitle, { color: C.text }]}>Artists</Text>
            <Text style={[styles.rowCountText, { color: C.b200 }]}>{artistsList.length}</Text>
            <Ionicons name="chevron-forward" size={18} color={C.b400} style={{ marginLeft: 6 }} />
          </TouchableOpacity>
          <View style={[styles.rowDivider, { backgroundColor: C.divider }]} />

          <TouchableOpacity style={styles.menuRow} activeOpacity={0.7} onPress={() => setLibraryScreen('Songs')}>
            <Ionicons name="musical-note" size={23} color={C.red} />
            <Text style={[styles.menuRowTitle, { color: C.text }]}>Songs</Text>
            <Text style={[styles.rowCountText, { color: C.b200 }]}>{tracks.length}</Text>
            <Ionicons name="chevron-forward" size={18} color={C.b400} style={{ marginLeft: 6 }} />
          </TouchableOpacity>
          <View style={[styles.rowDivider, { backgroundColor: C.divider }]} />

          <TouchableOpacity style={styles.menuRow} activeOpacity={0.7} onPress={() => setLibraryScreen('Favorites')}>
            <Ionicons name="heart" size={22} color={C.red} />
            <Text style={[styles.menuRowTitle, { color: C.text }]}>Favorites</Text>
            <Text style={[styles.rowCountText, { color: C.b200 }]}>{favorites.length}</Text>
            <Ionicons name="chevron-forward" size={18} color={C.b400} style={{ marginLeft: 6 }} />
          </TouchableOpacity>
          <View style={[styles.rowDivider, { backgroundColor: C.divider }]} />
        </View>
      )}

      {/* Albums Grid */}
      <View style={styles.recentlyAddedSection}>
        <Text style={[styles.recentlyAddedTitle, { color: C.text }]}>Recently Added</Text>
        {albums.length === 0 ? (
          <Text style={[styles.emptySectionText, { color: C.b200 }]}>No albums found on server</Text>
        ) : (
          <View style={styles.twoColumnGrid}>
            {albums.map((album) => (
              <TouchableOpacity
                key={album.id}
                activeOpacity={0.8}
                style={styles.gridAlbumCard}
                onPress={() => { setSelectedAlbum(album); setLibraryScreen('AlbumDetail'); }}
              >
                <Artwork uri={album.coverArt} title={album.name} size="100%" radius={10} />
                <Text numberOfLines={1} style={[styles.gridAlbumTitle, { color: C.text }]}>{album.name}</Text>
                <Text numberOfLines={1} style={[styles.gridAlbumSubtitle, { color: C.b200 }]}>{album.artist}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );

  // ---- SUB-SCREEN: PLAYLISTS ----
  const renderPlaylistsScreen = () => (
    <ScrollView
      style={[styles.screenScroll, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: 130 + insets.bottom }]}
    >
      <View style={[styles.subHeader, { paddingTop: Math.max(insets.top, 14) }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => setLibraryScreen('LibraryHome')}>
          <Ionicons name="chevron-back" size={24} color={C.red} />
          <Text style={[styles.backButtonText, { color: C.red }]}>Library</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setIsSortOpen(true)}>
          <Text style={[styles.headerActionRed, { color: C.red }]}>Sort</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.subScreenTitle, { color: C.text }]}>Playlists</Text>

      <View style={[styles.subSearchBar, { backgroundColor: C.inputBg }]}>
        <Ionicons name="search" size={18} color={C.b200} />
        <TextInput
          placeholder="Find in Playlists"
          placeholderTextColor={C.b200}
          value={playlistSearchQuery}
          onChangeText={setPlaylistSearchQuery}
          style={[styles.subSearchInput, { color: C.text }]}
        />
      </View>

      <TouchableOpacity activeOpacity={0.7} style={styles.playlistRow} onPress={() => setIsNewPlaylistOpen(true)}>
        <View style={[styles.playlistThumbPlaceholder, { backgroundColor: C.card }]}>
          <Ionicons name="add" size={28} color={C.b200} />
        </View>
        <Text style={[styles.newPlaylistText, { color: C.red }]}>New Playlist....</Text>
      </TouchableOpacity>
      <View style={[styles.rowDividerInset, { backgroundColor: C.divider }]} />

      {filteredPlaylists.map((pl) => (
        <React.Fragment key={pl.id}>
          <View style={styles.playlistRowWithActions}>
            <TouchableOpacity
              activeOpacity={0.7}
              style={[styles.playlistRow, { flex: 1 }]}
              onPress={() => { setSelectedPlaylist(pl); setLibraryScreen('PlaylistDetail'); }}
            >
              <Artwork uri={pl.coverArt} title={pl.name} size={48} radius={6} />
              <View style={{ flex: 1, marginLeft: 16 }}>
                <Text numberOfLines={1} style={[styles.playlistTitleText, { color: C.text }]}>{pl.name}</Text>
                <Text style={{ fontSize: 13, color: C.b200, marginTop: 2 }}>{pl.tracks.length} songs</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.b400} style={{ marginLeft: 'auto' }} />
            </TouchableOpacity>
          </View>
          <View style={[styles.rowDividerInset, { backgroundColor: C.divider }]} />
        </React.Fragment>
      ))}
    </ScrollView>
  );

  // ---- SUB-SCREEN: PLAYLIST / ALBUM DETAIL ----
  const renderDetailScreen = () => {
    const isAlbum = libraryScreen === 'AlbumDetail';
    const isPlaylist = libraryScreen === 'PlaylistDetail';
    const detailTitle = isAlbum ? selectedAlbum?.name ?? 'Album' : selectedPlaylist?.name ?? 'Playlist';
    const detailSubtitle = isAlbum
      ? selectedAlbum?.artist?.toUpperCase() ?? 'ALBUM'
      : selectedPlaylist?.updatedAt ?? 'PLAYLIST';
    const detailArtwork = isAlbum ? selectedAlbum?.coverArt : selectedPlaylist?.coverArt;
    const detailTracks = isAlbum
      ? tracks.filter((t) => t.albumId === selectedAlbum?.id || t.album === selectedAlbum?.name)
      : selectedPlaylist?.tracks ?? [];

    return (
      <ScrollView
        style={[styles.screenScroll, { backgroundColor: C.background }]}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 130 + insets.bottom }]}
      >
        <View style={[styles.subHeader, { paddingTop: Math.max(insets.top, 14) }]}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => setLibraryScreen(isAlbum ? 'LibraryHome' : 'Playlists')}
          >
            <Ionicons name="chevron-back" size={26} color={C.red} />
          </TouchableOpacity>
          {/* Playlist actions: rename + delete */}
          {isPlaylist && selectedPlaylist && (
            <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
              <TouchableOpacity
                onPress={() => {
                  setRenamePlaylistTitle(selectedPlaylist.name);
                  setIsRenamePlaylistOpen(true);
                }}
              >
                <Ionicons name="pencil-outline" size={22} color={C.red} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => deletePlaylist(selectedPlaylist)}>
                <Ionicons name="trash-outline" size={22} color={C.red} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.detailHeroWrapper}>
          <Artwork uri={detailArtwork} title={detailTitle} size={250} radius={14} />
          <Text style={[styles.detailTitleText, { color: C.text }]}>{detailTitle}</Text>
          <Text style={[styles.detailSubtitleText, { color: C.b200 }]}>{detailSubtitle}</Text>
        </View>

        <View style={styles.pillRow}>
          <TouchableOpacity
            activeOpacity={0.8}
            style={[styles.pillButton, { backgroundColor: C.pill }]}
            onPress={() => { if (detailTracks[0]) void playTrack(detailTracks[0], detailTracks); }}
          >
            <Ionicons name="play" size={20} color={C.red} />
            <Text style={[styles.pillButtonText, { color: C.red }]}>Play</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.8}
            style={[styles.pillButton, { backgroundColor: C.pill }]}
            onPress={() => {
              setShuffle(true);
              if (detailTracks.length) {
                const randIndex = Math.floor(Math.random() * detailTracks.length);
                void playTrack(detailTracks[randIndex], detailTracks);
              }
            }}
          >
            <Ionicons name="shuffle" size={20} color={C.red} />
            <Text style={[styles.pillButtonText, { color: C.red }]}>Shuffle</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.titleDivider, { backgroundColor: C.divider }]} />

        {detailTracks.map((t) => (
          <View key={t.id} style={[styles.trackRow, { borderBottomColor: C.divider }]}>
            <TouchableOpacity
              activeOpacity={0.7}
              style={styles.trackHitArea}
              onPress={() => void playTrack(t, detailTracks)}
            >
              <Artwork uri={t.coverArt} title={t.title} size={44} radius={6} />
              <View style={styles.trackInfo}>
                <Text numberOfLines={1} style={[styles.trackTitle, { color: C.text }]}>{t.title}</Text>
                <Text numberOfLines={1} style={[styles.trackArtist, { color: C.b200 }]}>{t.artist}</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setContextMenuTrack(t);
                setIsContextMenuOpen(true);
              }}
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={C.b300} />
            </TouchableOpacity>

            {/* Remove from playlist button */}
            {isPlaylist && (
              <TouchableOpacity
                style={{ marginLeft: 8 }}
                onPress={() => removeTrackFromPlaylist(t)}
              >
                <Ionicons name="remove-circle-outline" size={22} color={C.red} />
              </TouchableOpacity>
            )}
          </View>
        ))}

        <Text style={[styles.summaryFooter, { color: C.b200 }]}>
          {detailTracks.length} song{detailTracks.length !== 1 ? 's' : ''},{' '}
          {Math.max(1, Math.round(detailTracks.length * 3.5))} minutes
        </Text>
      </ScrollView>
    );
  };

  // ---- SUB-SCREEN: ARTISTS ----
  const renderArtistsScreen = () => (
    <ScrollView
      style={[styles.screenScroll, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: 130 + insets.bottom }]}
    >
      <View style={[styles.subHeader, { paddingTop: Math.max(insets.top, 14) }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => setLibraryScreen('LibraryHome')}>
          <Ionicons name="chevron-back" size={24} color={C.red} />
          <Text style={[styles.backButtonText, { color: C.red }]}>Library</Text>
        </TouchableOpacity>
      </View>
      <Text style={[styles.subScreenTitle, { color: C.text }]}>Artists</Text>
      <View style={[styles.titleDivider, { backgroundColor: C.divider }]} />

      {artistsList.map((artist) => (
        <React.Fragment key={artist.name}>
          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.artistRow}
            onPress={() => { setSelectedArtist(artist.name); setLibraryScreen('ArtistDetail'); }}
          >
            <Artwork uri={artist.coverArt} title={artist.name} size={46} radius={23} />
            <View style={{ flex: 1, marginLeft: 16 }}>
              <Text style={[styles.artistNameText, { color: C.text }]}>{artist.name}</Text>
              <Text style={{ fontSize: 13, color: C.b200, marginTop: 2 }}>{artist.tracks.length} songs</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.b400} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
          <View style={[styles.rowDividerInset, { backgroundColor: C.divider }]} />
        </React.Fragment>
      ))}
    </ScrollView>
  );

  // ---- SUB-SCREEN: ARTIST DETAIL ----
  const renderArtistDetailScreen = () => {
    const artistTracks = tracks.filter((t) => t.artist === selectedArtist);
    const artistAlbums = albums.filter((a) => a.artist === selectedArtist);
    return (
      <ScrollView
        style={[styles.screenScroll, { backgroundColor: C.background }]}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 130 + insets.bottom }]}
      >
        <View style={[styles.subHeader, { paddingTop: Math.max(insets.top, 14) }]}>
          <TouchableOpacity style={styles.backButton} onPress={() => setLibraryScreen('Artists')}>
            <Ionicons name="chevron-back" size={24} color={C.red} />
            <Text style={[styles.backButtonText, { color: C.red }]}>Artists</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsSortOpen(true)}>
            <Text style={[styles.headerActionRed, { color: C.red }]}>Sort</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.subScreenTitle, { color: C.text }]}>{selectedArtist}</Text>

        <View style={styles.pillRow}>
          <TouchableOpacity
            activeOpacity={0.8}
            style={[styles.pillButton, { backgroundColor: C.pill }]}
            onPress={() => { if (artistTracks[0]) void playTrack(artistTracks[0], artistTracks); }}
          >
            <Ionicons name="play" size={20} color={C.red} />
            <Text style={[styles.pillButtonText, { color: C.red }]}>Play</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.8}
            style={[styles.pillButton, { backgroundColor: C.pill }]}
            onPress={() => { setShuffle(true); if (artistTracks[0]) void playTrack(artistTracks[0], artistTracks); }}
          >
            <Ionicons name="shuffle" size={20} color={C.red} />
            <Text style={[styles.pillButtonText, { color: C.red }]}>Shuffle</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.titleDivider, { backgroundColor: C.divider }]} />

        <View style={styles.twoColumnGrid}>
          {artistAlbums.map((album) => (
            <TouchableOpacity
              key={album.id}
              activeOpacity={0.8}
              style={styles.gridAlbumCard}
              onPress={() => { setSelectedAlbum(album); setLibraryScreen('AlbumDetail'); }}
            >
              <Artwork uri={album.coverArt} title={album.name} size="100%" radius={10} />
              <Text numberOfLines={1} style={[styles.gridAlbumTitle, { color: C.text }]}>{album.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    );
  };

  // ---- SUB-SCREEN: SONGS ----
  const renderSongsScreen = () => (
    <View style={[styles.songsContainer, { backgroundColor: C.background }]}>
      <ScrollView
        style={styles.screenScroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 130 + insets.bottom }]}
      >
        <View style={[styles.subHeader, { paddingTop: Math.max(insets.top, 14) }]}>
          <TouchableOpacity style={styles.backButton} onPress={() => setLibraryScreen('LibraryHome')}>
            <Ionicons name="chevron-back" size={24} color={C.red} />
            <Text style={[styles.backButtonText, { color: C.red }]}>Library</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsSortOpen(true)}>
            <Text style={[styles.headerActionRed, { color: C.red }]}>Sort</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.subScreenTitle, { color: C.text }]}>Songs</Text>

        <View style={styles.pillRow}>
          <TouchableOpacity
            activeOpacity={0.8}
            style={[styles.pillButton, { backgroundColor: C.pill }]}
            onPress={() => { if (sortedTracks[0]) void playTrack(sortedTracks[0], sortedTracks); }}
          >
            <Ionicons name="play" size={20} color={C.red} />
            <Text style={[styles.pillButtonText, { color: C.red }]}>Play</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.8}
            style={[styles.pillButton, { backgroundColor: C.pill }]}
            onPress={() => {
              setShuffle(true);
              const rand = Math.floor(Math.random() * sortedTracks.length);
              if (sortedTracks[rand]) void playTrack(sortedTracks[rand], sortedTracks);
            }}
          >
            <Ionicons name="shuffle" size={20} color={C.red} />
            <Text style={[styles.pillButtonText, { color: C.red }]}>Shuffle</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.titleDivider, { backgroundColor: C.divider }]} />

        {sortedTracks.map((t) => (
          <View key={t.id} style={[styles.trackRow, { borderBottomColor: C.divider }]}>
            <TouchableOpacity
              activeOpacity={0.7}
              style={styles.trackHitArea}
              onPress={() => void playTrack(t, sortedTracks)}
            >
              <Artwork uri={t.coverArt} title={t.title} size={44} radius={6} />
              <View style={styles.trackInfo}>
                <Text numberOfLines={1} style={[styles.trackTitle, { color: C.text }]}>{t.title}</Text>
                <Text numberOfLines={1} style={[styles.trackArtist, { color: C.b200 }]}>{t.artist}</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => { setContextMenuTrack(t); setIsContextMenuOpen(true); }}
              style={{ marginRight: 8 }}
            >
              <Ionicons name="ellipsis-horizontal" size={20} color={C.b300} />
            </TouchableOpacity>

            <TouchableOpacity
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => toggleFavorite(t)}
              style={{ marginRight: 16 }}
            >
              <Ionicons
                name={favorites.some((f) => f.id === t.id) ? 'heart' : 'heart-outline'}
                size={20}
                color={favorites.some((f) => f.id === t.id) ? C.red : C.b300}
              />
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>

      {/* Alphabet Scrubber */}
      <View style={[styles.alphabetScrubber, { paddingTop: Math.max(insets.top + 60, 80) }]}>
        {ALPHABET_SCRUBBER.map((letter) => (
          <Text key={letter} style={[styles.scrubberLetter, { color: C.red }]}>{letter}</Text>
        ))}
      </View>
    </View>
  );

  // ---- SUB-SCREEN: FAVORITES ----
  const renderFavoritesScreen = () => (
    <ScrollView
      style={[styles.screenScroll, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: 130 + insets.bottom }]}
    >
      <View style={[styles.subHeader, { paddingTop: Math.max(insets.top, 14) }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => setLibraryScreen('LibraryHome')}>
          <Ionicons name="chevron-back" size={24} color={C.red} />
          <Text style={[styles.backButtonText, { color: C.red }]}>Library</Text>
        </TouchableOpacity>
      </View>
      <Text style={[styles.subScreenTitle, { color: C.text }]}>Favorites</Text>
      <View style={[styles.titleDivider, { backgroundColor: C.divider }]} />

      {favorites.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="heart-outline" size={48} color={C.b300} />
          <Text style={[styles.emptyTitle, { color: C.text }]}>No Favorite Songs Yet</Text>
          <Text style={[styles.emptySubtitle, { color: C.b200 }]}>
            Tap the heart icon on any song to add it to your favorites.
          </Text>
        </View>
      ) : (
        favorites.map((t) => (
          <View key={t.id} style={[styles.trackRow, { borderBottomColor: C.divider }]}>
            <TouchableOpacity
              activeOpacity={0.7}
              style={styles.trackHitArea}
              onPress={() => void playTrack(t, favorites)}
            >
              <Artwork uri={t.coverArt} title={t.title} size={44} radius={6} />
              <View style={styles.trackInfo}>
                <Text numberOfLines={1} style={[styles.trackTitle, { color: C.text }]}>{t.title}</Text>
                <Text numberOfLines={1} style={[styles.trackArtist, { color: C.b200 }]}>{t.artist}</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => toggleFavorite(t)}>
              <Ionicons name="heart" size={20} color={C.red} />
            </TouchableOpacity>
          </View>
        ))
      )}
    </ScrollView>
  );

  // ============================================================
  // TAB 3: SEARCH
  // ============================================================
  const renderSearch = () => (
    <ScrollView
      style={[styles.screenScroll, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: 130 + insets.bottom }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.largeTitle, { paddingHorizontal: 20, paddingTop: Math.max(insets.top, 14), color: C.text }]}>
        Search
      </Text>

      <View style={[styles.searchBarContainer, { backgroundColor: C.searchBarBg }]}>
        <Ionicons name="search" size={20} color={C.b200} />
        <TextInput
          placeholder="Artists, Songs, Albums..."
          placeholderTextColor={C.b200}
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={[styles.searchInput, { color: C.text }]}
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={18} color={C.b200} />
          </TouchableOpacity>
        )}
      </View>

      {searchQuery.trim().length > 0 ? (
        <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
          <Text style={[styles.sectionHeaderTitle, { color: C.text }]}>Matching Tracks</Text>
          {searchResults.length === 0 ? (
            <Text style={[styles.emptySearchText, { color: C.b200 }]}>No matching tracks found</Text>
          ) : (
            searchResults.map((t) => (
              <View key={t.id} style={[styles.trackRow, { borderBottomColor: C.divider }]}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  style={styles.trackHitArea}
                  onPress={() => void playTrack(t, searchResults)}
                >
                  <Artwork uri={t.coverArt} title={t.title} size={44} radius={6} />
                  <View style={styles.trackInfo}>
                    <Text numberOfLines={1} style={[styles.trackTitle, { color: C.text }]}>{t.title}</Text>
                    <Text numberOfLines={1} style={[styles.trackArtist, { color: C.b200 }]}>{t.artist} · {t.album}</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setContextMenuTrack(t); setIsContextMenuOpen(true); }}
                  style={{ marginRight: 10 }}
                >
                  <Ionicons name="ellipsis-horizontal" size={20} color={C.b300} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => toggleFavorite(t)}>
                  <Ionicons
                    name={favorites.some((f) => f.id === t.id) ? 'heart' : 'heart-outline'}
                    size={22}
                    color={favorites.some((f) => f.id === t.id) ? C.red : C.b200}
                  />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      ) : (
        <View style={{ marginTop: 24, paddingHorizontal: 20 }}>
          <Text style={[styles.sectionHeaderTitle, { color: C.text }]}>Recently Played</Text>
          {recentTracks.length === 0 ? (
            <Text style={[styles.emptySearchText, { color: C.b200 }]}>
              Play any song from your library to see it here.
            </Text>
          ) : (
            recentTracks.slice(0, 8).map((t) => (
              <View key={t.id} style={[styles.trackRow, { borderBottomColor: C.divider }]}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  style={styles.trackHitArea}
                  onPress={() => void playTrack(t, recentTracks)}
                >
                  <Artwork uri={t.coverArt} title={t.title} size={44} radius={6} />
                  <View style={styles.trackInfo}>
                    <Text numberOfLines={1} style={[styles.trackTitle, { color: C.text }]}>{t.title}</Text>
                    <Text numberOfLines={1} style={[styles.trackArtist, { color: C.b200 }]}>{t.artist}</Text>
                  </View>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );

  // ============================================================
  // MODAL 1: FULL NOW PLAYING
  // ============================================================
  const renderNowPlayingModal = () => (
    <Modal
      visible={isNowPlayingOpen}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => setIsNowPlayingOpen(false)}
    >
      <View
        style={[
          styles.nowPlayingModalContainer,
          {
            backgroundColor: C.background,
            paddingTop: Math.max(insets.top, 14),
            paddingBottom: Math.max(insets.bottom, 20),
          },
        ]}
      >
        <StatusBar barStyle={isDarkTheme ? 'light-content' : 'dark-content'} backgroundColor={C.background} />

        {/* Dismiss Handle */}
        <View style={styles.modalDismissHeader}>
          <TouchableOpacity
            hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
            onPress={() => setIsNowPlayingOpen(false)}
            style={[styles.modalHandleBar, { backgroundColor: C.b400 }]}
          />
        </View>

        {currentTrack && (
          <ScrollView contentContainerStyle={styles.nowPlayingScroll} showsVerticalScrollIndicator={false}>
            {/* Artwork */}
            <View style={[styles.nowPlayingArtworkWrapper, { width: NOW_PLAYING_ARTWORK_SIZE, height: NOW_PLAYING_ARTWORK_SIZE }]}>
              <Artwork uri={currentTrack.coverArt} title={currentTrack.title} size={NOW_PLAYING_ARTWORK_SIZE} radius={16} />
            </View>

            {/* Meta Row */}
            <View style={styles.nowPlayingMetaRow}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text numberOfLines={1} style={[styles.nowPlayingTitle, { color: C.text }]}>{currentTrack.title}</Text>
                <Text numberOfLines={1} style={[styles.nowPlayingArtist, { color: C.b100 }]}>
                  {currentTrack.artist} — {currentTrack.album}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => toggleFavorite(currentTrack)}
                style={[styles.nowPlayingDotsCircle, { backgroundColor: C.card }]}
              >
                <Ionicons
                  name={favorites.some((f) => f.id === currentTrack.id) ? 'heart' : 'heart-outline'}
                  size={24}
                  color={favorites.some((f) => f.id === currentTrack.id) ? C.red : C.text}
                />
              </TouchableOpacity>
            </View>

            {/* Scrubber */}
            <Slider
              style={styles.scrubberSlider}
              minimumValue={0}
              maximumValue={Math.max(playback.duration || currentTrack.duration, 1)}
              value={playback.currentTime}
              minimumTrackTintColor={C.text}
              maximumTrackTintColor={C.b400}
              thumbTintColor={C.text}
              onSlidingComplete={(val) => void player.seekTo(val)}
            />
            <View style={styles.scrubberTimeRow}>
              <Text style={[styles.scrubberTimeText, { color: C.b200 }]}>{formatTime(playback.currentTime)}</Text>
              <Text style={[styles.scrubberTimeText, { color: C.b200 }]}>{formatTime(playback.duration || currentTrack.duration)}</Text>
            </View>

            {/* Controls */}
            <View style={styles.nowPlayingControls}>
              <TouchableOpacity activeOpacity={0.7} onPress={() => void playPreviousTrack()}>
                <Ionicons name="play-back" size={42} color={C.text} />
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.nowPlayingPlayButton}
                onPress={() => playback.playing ? player.pause() : player.play()}
              >
                <Ionicons name={playback.playing ? 'pause' : 'play'} size={50} color={C.text} />
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.7} onPress={() => void playNextTrack()}>
                <Ionicons name="play-forward" size={42} color={C.text} />
              </TouchableOpacity>
            </View>

            {/* Volume */}
            <View style={styles.volumeRow}>
              <Ionicons name="volume-low" size={20} color={C.b200} />
              <Slider
                style={styles.volumeSlider}
                minimumValue={0}
                maximumValue={1}
                value={volume}
                minimumTrackTintColor={C.text}
                maximumTrackTintColor={C.b400}
                thumbTintColor={C.text}
                onValueChange={(val) => {
                  setVolume(val);
                  try { player.volume = val; } catch {}
                }}
              />
              <Ionicons name="volume-high" size={20} color={C.b200} />
            </View>

            {/* Secondary Controls */}
            <View style={styles.nowPlayingBottomBar}>
              <TouchableOpacity onPress={() => setShuffle(!shuffle)}>
                <Ionicons name="shuffle" size={24} color={shuffle ? C.red : C.b200} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setRepeat(!repeat)}>
                <Ionicons name="repeat" size={24} color={repeat ? C.red : C.b200} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowQueue(!showQueue)}>
                <Ionicons name="list" size={26} color={showQueue ? C.red : C.b200} />
              </TouchableOpacity>
            </View>

            {/* Up Next Drawer */}
            {showQueue && (
              <View style={[styles.queueContainer, { backgroundColor: C.card }]}>
                <View style={styles.queueHeaderRow}>
                  <Text style={[styles.queueHeaderTitle, { color: C.text }]}>Up Next</Text>
                  <Text style={{ color: C.b200, fontSize: 13 }}>{queue.length} songs</Text>
                </View>
                {queue.map((item, index) => (
                  <TouchableOpacity
                    key={`${item.id}-${index}`}
                    activeOpacity={0.7}
                    style={[styles.queueRow, { borderBottomColor: C.divider }]}
                    onPress={() => void playTrack(item, queue)}
                  >
                    <Artwork uri={item.coverArt} title={item.title} size={40} radius={6} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text
                        numberOfLines={1}
                        style={[styles.queueItemTitle, { color: item.id === currentTrack.id ? C.red : C.text }]}
                      >
                        {item.title}
                      </Text>
                      <Text numberOfLines={1} style={[styles.queueItemArtist, { color: C.b200 }]}>{item.artist}</Text>
                    </View>
                    {item.id === currentTrack.id && <Ionicons name="volume-high" size={20} color={C.red} />}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );

  // ============================================================
  // MODAL 2: SERVER SETTINGS
  // ============================================================
  const renderServerSettingsModal = () => (
    <Modal
      visible={isServerSettingsOpen}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setIsServerSettingsOpen(false)}
    >
      <View
        style={[
          styles.accountModalContainer,
          {
            backgroundColor: C.card,
            paddingTop: Math.max(insets.top, 14),
            paddingBottom: Math.max(insets.bottom, 20),
          },
        ]}
      >
        <View style={[styles.accountHeader, { borderBottomColor: C.divider }]}>
          <Text style={[styles.accountTitle, { color: C.text }]}>Server & Settings</Text>
          <TouchableOpacity style={styles.accountDoneButton} onPress={() => setIsServerSettingsOpen(false)}>
            <Text style={[styles.accountDoneRed, { color: C.red }]}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: 20 }}>
          <View style={[styles.serverCard, { backgroundColor: C.background, borderColor: C.divider }]}>
            <View style={styles.serverCardHeader}>
              <Ionicons name="server" size={22} color={isConnected ? '#34C759' : C.red} />
              <Text style={[styles.serverCardTitle, { color: C.text }]}>NAS Music Server</Text>
              <View style={[styles.statusBadge, { backgroundColor: isConnected ? '#1A3824' : '#3A1E22' }]}>
                <Text style={{ color: isConnected ? '#34C759' : C.red, fontSize: 12, fontWeight: '700' }}>
                  {isConnected ? 'ONLINE' : 'OFFLINE'}
                </Text>
              </View>
            </View>

            <Text style={[styles.serverLabel, { color: C.b200 }]}>API ADDRESS / BASE URL</Text>
            <TextInput
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="http://192.168.1.20:8000"
              placeholderTextColor={C.b300}
              autoCapitalize="none"
              keyboardType="url"
              style={[styles.serverInput, { color: C.text, backgroundColor: C.card, borderColor: C.divider }]}
            />

            {!!serverStatusMessage && (
              <Text style={{ color: isConnected ? '#34C759' : C.red, fontSize: 13, marginTop: 10 }}>
                {serverStatusMessage}
              </Text>
            )}

            <TouchableOpacity
              activeOpacity={0.8}
              disabled={isConnectingServer}
              style={[styles.serverConnectButton, { backgroundColor: C.red }, isConnectingServer && { opacity: 0.6 }]}
              onPress={() => void connectServer(serverUrl)}
            >
              {isConnectingServer ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.serverConnectButtonText}>
                  {isConnected ? 'Sync & Re-pull from NAS' : 'Connect & Save'}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Stats */}
          <View style={[styles.statsCard, { backgroundColor: C.background, borderColor: C.divider }]}>
            <Text style={[styles.statsHeaderTitle, { color: C.text }]}>Catalog Statistics</Text>
            {[
              { label: 'Total Songs', value: tracks.length },
              { label: 'Albums', value: albums.length },
              { label: 'Artists', value: artistsList.length },
              { label: 'Favorites', value: favorites.length },
            ].map((row) => (
              <View key={row.label} style={[styles.statsRow, { borderBottomColor: C.divider }]}>
                <Text style={[styles.statsLabel, { color: C.b100 }]}>{row.label}</Text>
                <Text style={[styles.statsValue, { color: C.text }]}>{row.value}</Text>
              </View>
            ))}
          </View>

          {isConnected && (
            <TouchableOpacity
              style={styles.disconnectButton}
              onPress={async () => {
                await AsyncStorage.removeItem(STORAGE_KEYS.config);
                setClient(null);
                setIsConnected(false);
                setTracks([]);
                setAlbums([]);
                setCurrentTrack(null);
                setHasStartedPlayback(false);
                setServerStatusMessage('Server disconnected.');
              }}
            >
              <Text style={[styles.disconnectButtonText, { color: C.red }]}>Disconnect Server</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </Modal>
  );

  // ============================================================
  // MODAL 3: NEW PLAYLIST
  // ============================================================
  const renderNewPlaylistModal = () => (
    <Modal
      visible={isNewPlaylistOpen}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setIsNewPlaylistOpen(false)}
    >
      <View
        style={[
          styles.accountModalContainer,
          {
            backgroundColor: C.card,
            paddingTop: Math.max(insets.top, 14),
            paddingBottom: Math.max(insets.bottom, 20),
          },
        ]}
      >
        <View style={[styles.newPlaylistHeader, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.divider }]}>
          <TouchableOpacity onPress={() => setIsNewPlaylistOpen(false)}>
            <Text style={[styles.headerActionRed, { color: C.red }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.newPlaylistModalTitle, { color: C.text }]}>New Playlist</Text>
          <TouchableOpacity onPress={handleCreatePlaylist}>
            <Text style={[styles.headerActionRed, { color: C.red }]}>Done</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.newPlaylistContent}>
          <View style={[styles.newPlaylistCoverBox, { backgroundColor: C.pill }]}>
            <Text style={{ fontSize: 64, fontWeight: '500', color: C.text }}>
              {newPlaylistTitle.trim() ? newPlaylistTitle.trim().charAt(0).toUpperCase() : '♪'}
            </Text>
          </View>

          <TextInput
            placeholder="Playlist Name"
            placeholderTextColor={C.b200}
            value={newPlaylistTitle}
            onChangeText={setNewPlaylistTitle}
            style={[styles.playlistInput, { color: C.text }]}
          />
          <View style={[styles.accountDivider, { backgroundColor: C.divider }]} />

          <TextInput
            placeholder="Description (Optional)"
            placeholderTextColor={C.b200}
            value={newPlaylistDescription}
            onChangeText={setNewPlaylistDescription}
            style={[styles.playlistInput, { color: C.text }]}
          />
          <View style={[styles.accountDivider, { backgroundColor: C.divider }]} />
        </View>
      </View>
    </Modal>
  );

  // ============================================================
  // MODAL 4: ADD TO PLAYLIST (pick existing playlist)
  // ============================================================
  const renderAddToPlaylistModal = () => (
    <Modal
      visible={isAddToPlaylistOpen}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setIsAddToPlaylistOpen(false)}
    >
      <View
        style={[
          styles.accountModalContainer,
          {
            backgroundColor: C.card,
            paddingTop: Math.max(insets.top, 14),
            paddingBottom: Math.max(insets.bottom, 20),
          },
        ]}
      >
        <View style={[styles.accountHeader, { borderBottomColor: C.divider }]}>
          <Text style={[styles.accountTitle, { color: C.text }]}>Add to Playlist</Text>
          <TouchableOpacity style={styles.accountDoneButton} onPress={() => setIsAddToPlaylistOpen(false)}>
            <Text style={[styles.accountDoneRed, { color: C.red }]}>Cancel</Text>
          </TouchableOpacity>
        </View>

        {contextMenuTrack && (
          <View style={[styles.addToPlaylistTrackRow, { borderBottomColor: C.divider }]}>
            <Artwork uri={contextMenuTrack.coverArt} title={contextMenuTrack.title} size={40} radius={6} />
            <View style={{ marginLeft: 12 }}>
              <Text numberOfLines={1} style={[styles.trackTitle, { color: C.text, fontSize: 14 }]}>{contextMenuTrack.title}</Text>
              <Text numberOfLines={1} style={[styles.trackArtist, { color: C.b200 }]}>{contextMenuTrack.artist}</Text>
            </View>
          </View>
        )}

        {/* New Playlist option */}
        <TouchableOpacity
          style={[styles.playlistPickRow, { borderBottomColor: C.divider }]}
          onPress={() => {
            setIsAddToPlaylistOpen(false);
            setIsNewPlaylistOpen(true);
          }}
        >
          <View style={[styles.playlistPickIcon, { backgroundColor: C.pill }]}>
            <Ionicons name="add" size={24} color={C.red} />
          </View>
          <Text style={[styles.playlistPickText, { color: C.red }]}>New Playlist...</Text>
        </TouchableOpacity>

        <FlatList
          data={playlists}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.playlistPickRow, { borderBottomColor: C.divider }]}
              onPress={() => {
                if (contextMenuTrack) addTrackToPlaylist(contextMenuTrack, item);
                setIsAddToPlaylistOpen(false);
              }}
            >
              <Artwork uri={item.coverArt} title={item.name} size={44} radius={6} />
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text numberOfLines={1} style={[styles.playlistPickText, { color: C.text }]}>{item.name}</Text>
                <Text style={{ color: C.b200, fontSize: 13, marginTop: 2 }}>{item.tracks.length} songs</Text>
              </View>
              {contextMenuTrack && item.tracks.some((t) => t.id === contextMenuTrack.id) && (
                <Ionicons name="checkmark-circle" size={22} color={C.red} />
              )}
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={[styles.emptySearchText, { color: C.b200, textAlign: 'center', marginTop: 32 }]}>
              No playlists yet. Create one above.
            </Text>
          }
        />
      </View>
    </Modal>
  );

  // ============================================================
  // MODAL 5: RENAME PLAYLIST
  // ============================================================
  const renderRenamePlaylistModal = () => (
    <Modal
      visible={isRenamePlaylistOpen}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setIsRenamePlaylistOpen(false)}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View
          style={[
            styles.accountModalContainer,
            {
              backgroundColor: C.card,
              paddingTop: Math.max(insets.top, 14),
              paddingBottom: Math.max(insets.bottom, 20),
            },
          ]}
        >
          <View style={[styles.newPlaylistHeader, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.divider }]}>
            <TouchableOpacity onPress={() => { setIsRenamePlaylistOpen(false); setRenamePlaylistTitle(''); }}>
              <Text style={[styles.headerActionRed, { color: C.red }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.newPlaylistModalTitle, { color: C.text }]}>Rename</Text>
            <TouchableOpacity onPress={handleRenamePlaylist}>
              <Text style={[styles.headerActionRed, { color: C.red }]}>Done</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.newPlaylistContent, { paddingTop: 32 }]}>
            <TextInput
              placeholder="Playlist Name"
              placeholderTextColor={C.b200}
              value={renamePlaylistTitle}
              onChangeText={setRenamePlaylistTitle}
              style={[styles.playlistInput, { color: C.text, fontSize: 20, fontWeight: '500' }]}
              autoFocus
            />
            <View style={[styles.accountDivider, { backgroundColor: C.divider }]} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  // ============================================================
  // POPUP: SORT MENU
  // ============================================================
  const renderSortMenu = () => (
    <Modal
      visible={isSortOpen}
      transparent
      animationType="fade"
      onRequestClose={() => setIsSortOpen(false)}
    >
      <Pressable style={styles.popupOverlay} onPress={() => setIsSortOpen(false)}>
        <View style={[styles.sortMenuCard, { backgroundColor: C.cardSecondary, borderColor: C.divider }]}>
          {(['Title', 'Recently Added', 'Newest First', 'Oldest First'] as SortOption[]).map((opt) => (
            <TouchableOpacity
              key={opt}
              style={[styles.sortOptionRow, { borderBottomColor: C.divider }]}
              onPress={() => { setSortOption(opt); setIsSortOpen(false); }}
            >
              {sortOption === opt ? (
                <Ionicons name="checkmark" size={19} color={C.text} style={{ marginRight: 8 }} />
              ) : (
                <View style={{ width: 27 }} />
              )}
              <Text style={[styles.sortOptionText, { color: C.text }]}>{opt}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Pressable>
    </Modal>
  );

  // ============================================================
  // POPUP: CONTEXT MENU
  // ============================================================
  const renderContextMenu = () => (
    <Modal
      visible={isContextMenuOpen}
      transparent
      animationType="fade"
      onRequestClose={() => setIsContextMenuOpen(false)}
    >
      <Pressable style={styles.popupOverlay} onPress={() => setIsContextMenuOpen(false)}>
        <View style={[styles.contextMenuCard, { backgroundColor: C.cardSecondary, borderColor: C.divider }]}>
          <TouchableOpacity
            style={styles.contextRow}
            onPress={() => {
              setIsContextMenuOpen(false);
              if (contextMenuTrack) setQueue([contextMenuTrack, ...queue]);
            }}
          >
            <Text style={[styles.contextWhiteText, { color: C.text }]}>Play Next</Text>
            <Ionicons name="play-skip-forward" size={20} color={C.text} />
          </TouchableOpacity>
          <View style={[styles.accountDivider, { backgroundColor: C.divider }]} />

          <TouchableOpacity
            style={styles.contextRow}
            onPress={() => {
              setIsContextMenuOpen(false);
              if (contextMenuTrack) setQueue([...queue, contextMenuTrack]);
            }}
          >
            <Text style={[styles.contextWhiteText, { color: C.text }]}>Add to Queue</Text>
            <Ionicons name="list" size={20} color={C.text} />
          </TouchableOpacity>
          <View style={[styles.accountDivider, { backgroundColor: C.divider }]} />

          <TouchableOpacity
            style={styles.contextRow}
            onPress={() => {
              setIsContextMenuOpen(false);
              if (contextMenuTrack?.albumId) {
                const alb = albums.find((a) => a.id === contextMenuTrack.albumId);
                if (alb) { setSelectedAlbum(alb); setLibraryScreen('AlbumDetail'); setActiveTab('Library'); }
              }
            }}
          >
            <Text style={[styles.contextWhiteText, { color: C.text }]}>Go to Album</Text>
            <Ionicons name="albums" size={20} color={C.text} />
          </TouchableOpacity>
          <View style={[styles.accountDivider, { backgroundColor: C.divider }]} />

          <TouchableOpacity
            style={styles.contextRow}
            onPress={() => {
              setIsContextMenuOpen(false);
              if (contextMenuTrack) toggleFavorite(contextMenuTrack);
            }}
          >
            <Text style={[styles.contextWhiteText, { color: C.text }]}>
              {contextMenuTrack && favorites.some((f) => f.id === contextMenuTrack.id)
                ? 'Remove from Favorites'
                : 'Love / Favorite'}
            </Text>
            <Ionicons
              name={contextMenuTrack && favorites.some((f) => f.id === contextMenuTrack.id) ? 'heart' : 'heart-outline'}
              size={20}
              color={C.red}
            />
          </TouchableOpacity>
          <View style={[styles.accountDivider, { backgroundColor: C.divider }]} />

          {/* ADD TO PLAYLIST — now opens picker */}
          <TouchableOpacity
            style={styles.contextRow}
            onPress={() => {
              setIsContextMenuOpen(false);
              setIsAddToPlaylistOpen(true);
            }}
          >
            <Text style={[styles.contextWhiteText, { color: C.text }]}>Add to Playlist...</Text>
            <Ionicons name="add-circle-outline" size={20} color={C.text} />
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );

  // ============================================================
  // LIBRARY SCREEN ROUTER
  // ============================================================
  const renderLibraryContent = () => {
    switch (libraryScreen) {
      case 'Playlists': return renderPlaylistsScreen();
      case 'PlaylistDetail':
      case 'AlbumDetail': return renderDetailScreen();
      case 'Artists': return renderArtistsScreen();
      case 'ArtistDetail': return renderArtistDetailScreen();
      case 'Songs': return renderSongsScreen();
      case 'Favorites': return renderFavoritesScreen();
      case 'LibraryHome':
      default: return renderLibraryHome();
    }
  };

  const renderCurrentTab = () => {
    switch (activeTab) {
      case 'ListenNow': return renderListenNow();
      case 'Library': return renderLibraryContent();
      case 'Search': return renderSearch();
    }
  };

  // ============================================================
  // ROOT RENDER
  // ============================================================
  return (
    <View style={[styles.appContainer, { backgroundColor: C.background }]}>
      <StatusBar
        barStyle={isDarkTheme ? 'light-content' : 'dark-content'}
        backgroundColor={C.background}
      />
      {showBrandSplash && (
        <View style={styles.brandSplash}>
          <View style={styles.brandLogoGlow}>
            <Image
              source={require('./assets/apple_music_icon.png')}
              style={styles.brandLogo}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.brandName}>Sonora</Text>
          <Text style={styles.brandTagline}>MUSIC, MADE PERSONAL</Text>
          <View style={styles.brandAccent} />
        </View>
      )}
      <View style={[styles.screenWrapper, { backgroundColor: C.background }]}>
        {renderCurrentTab()}
        {renderMiniPlayer()}
        {renderTabBar()}
      </View>

      {/* Modals */}
      {renderNowPlayingModal()}
      {renderServerSettingsModal()}
      {renderNewPlaylistModal()}
      {renderAddToPlaylistModal()}
      {renderRenamePlaylistModal()}
      {renderSortMenu()}
      {renderContextMenu()}
    </View>
  );
}

// ============================================================
// STATIC STYLES (theme-dynamic values passed inline)
// ============================================================
const styles = StyleSheet.create({
  appContainer: { flex: 1 },
  screenWrapper: { flex: 1 },
  brandSplash: {
    ...StyleSheet.absoluteFill,
    pointerEvents: 'none',
    zIndex: 10,
    backgroundColor: '#08080B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandLogoGlow: {
    width: 142,
    height: 142,
    borderRadius: 42,
    backgroundColor: '#151013',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FB0808',
    shadowOpacity: 0.35,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  brandLogo: { width: 112, height: 112, borderRadius: 28 },
  brandName: { color: '#FFFFFF', fontSize: 25, fontWeight: '600', marginTop: 25 },
  brandTagline: { color: '#969197', fontSize: 11, fontWeight: '500', marginTop: 7 },
  brandAccent: { width: 32, height: 3, borderRadius: 2, backgroundColor: '#FB0808', marginTop: 18 },
  screenScroll: { flex: 1 },
  scrollContent: { paddingBottom: 130 },

  // Headers
  largeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: '600',
    letterSpacing: 0,
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
    letterSpacing: 0,
  },
  headerButton: { paddingVertical: 6, paddingHorizontal: 4 },
  headerActionRed: { fontSize: 17, fontWeight: '500' },
  headerIconsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  serverIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 8,
  },

  subHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: -4,
  },
  backButtonText: {
    fontSize: 17,
    fontWeight: '500',
    marginLeft: 2,
  },
  subScreenTitle: {
    fontSize: 34,
    fontWeight: '600',
    paddingHorizontal: 20,
    marginTop: 8,
    letterSpacing: 0,
  },

  loadingContainer: { padding: 30, alignItems: 'center' },
  loadingText: { fontSize: 14, marginTop: 12 },

  // Hero Card
  personalHeroCard: {
    marginHorizontal: 20,
    marginTop: 14,
    borderRadius: 14,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  personalHeroLeft: { flex: 1, marginRight: 12 },
  heroKicker: { fontSize: 11, fontWeight: '600', letterSpacing: 0 },
  heroTitle: { fontSize: 20, fontWeight: '600', marginTop: 4 },
  heroDetail: { fontSize: 13, marginTop: 4 },
  heroPlayCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyServerCard: {
    marginHorizontal: 20,
    marginTop: 20,
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  emptyServerTitle: { fontSize: 20, fontWeight: '600', marginTop: 14 },
  emptyServerSubtitle: { fontSize: 14, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  emptyServerButton: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10, marginTop: 18 },
  emptyServerButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },

  // Sections
  sectionContainer: { marginTop: 26 },
  sectionHeaderTitle: { fontSize: 22, fontWeight: '600', paddingHorizontal: 20, marginBottom: 14 },
  horizontalScroll: { paddingHorizontal: 20, gap: 16 },
  cardItem: { width: 148 },
  cardTitle: { fontSize: 14, fontWeight: '500', marginTop: 8 },
  cardSubtitle: { fontSize: 12, marginTop: 2 },

  // Library
  libraryMenu: { paddingHorizontal: 20, marginTop: 6 },
  menuRow: { flexDirection: 'row', alignItems: 'center', height: 52 },
  menuRowTitle: { fontSize: 20, fontWeight: '500', marginLeft: 16 },
  rowCountText: { fontSize: 16, marginLeft: 'auto' },
  rowChevron: { marginLeft: 'auto' },
  rowDivider: { height: StyleSheet.hairlineWidth, marginLeft: 39 },
  rowDividerInset: { height: StyleSheet.hairlineWidth, marginHorizontal: 20 },

  editList: { paddingHorizontal: 20, marginTop: 6 },
  editRow: { flexDirection: 'row', alignItems: 'center', height: 52, borderBottomWidth: StyleSheet.hairlineWidth },
  checkCircle: { padding: 4 },
  uncheckedCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5 },

  recentlyAddedSection: { marginTop: 32, paddingHorizontal: 20 },
  recentlyAddedTitle: { fontSize: 22, fontWeight: '600', marginBottom: 14 },
  emptySectionText: { fontSize: 14, marginTop: 4 },
  twoColumnGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  gridAlbumCard: { width: '47.5%', marginBottom: 20 },
  gridAlbumTitle: { fontSize: 14, fontWeight: '500', marginTop: 8 },
  gridAlbumSubtitle: { fontSize: 12, marginTop: 2 },

  // Playlists
  subSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 42,
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 16,
  },
  subSearchInput: { flex: 1, fontSize: 16, marginLeft: 8 },
  playlistRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, height: 64 },
  playlistRowWithActions: { flexDirection: 'row', alignItems: 'center' },
  playlistThumbPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newPlaylistText: { fontSize: 17, fontWeight: '500', marginLeft: 16 },
  playlistTitleText: { fontSize: 17, fontWeight: '500' },
  emptyContainer: { alignItems: 'center', marginTop: 60, paddingHorizontal: 30 },
  emptyTitle: { fontSize: 20, fontWeight: '600', textAlign: 'center', marginTop: 12 },
  emptySubtitle: { fontSize: 15, marginTop: 8, textAlign: 'center' },

  // Detail
  detailHeroWrapper: { alignItems: 'center', marginTop: 8, paddingHorizontal: 20 },
  detailTitleText: { fontSize: 22, fontWeight: '600', marginTop: 18, textAlign: 'center' },
  detailSubtitleText: { fontSize: 12, fontWeight: '500', letterSpacing: 0, marginTop: 4, textAlign: 'center' },

  pillRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 18, gap: 14 },
  pillButton: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pillButtonText: { fontSize: 17, fontWeight: '600' },

  // Track Rows
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    height: 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  trackHitArea: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  trackInfo: { flex: 1, marginLeft: 14, paddingRight: 10 },
  trackTitle: { fontSize: 16, fontWeight: '500' },
  trackArtist: { fontSize: 13, marginTop: 3 },
  summaryFooter: { textAlign: 'center', fontSize: 13, marginTop: 20, marginBottom: 30 },

  artistRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, height: 62 },
  artistNameText: { fontSize: 18, fontWeight: '500' },

  songsContainer: { flex: 1, flexDirection: 'row' },
  alphabetScrubber: { width: 20, justifyContent: 'center', alignItems: 'center', paddingRight: 6 },
  scrubberLetter: { fontSize: 9, fontWeight: '600', lineHeight: 14 },

  // Search
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 46,
    marginHorizontal: 20,
    marginTop: 14,
  },
  searchInput: { flex: 1, fontSize: 16, marginLeft: 10 },
  emptySearchText: { fontSize: 15, marginTop: 20 },

  // Mini Player (BlurView)
  miniPlayer: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: 56,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  miniPlayerContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  miniTextWrapper: { flex: 1, marginLeft: 12, marginRight: 8 },
  miniTitle: { fontSize: 14, fontWeight: '500' },
  miniArtist: { fontSize: 11, marginTop: 2 },
  miniButton: { padding: 8 },

  // Tab Bar (BlurView)
  tabBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  tabBarInner: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  tabItem: { alignItems: 'center', justifyContent: 'center', flex: 1, gap: 3 },
  tabLabel: { fontSize: 10, fontWeight: '400' },

  // Now Playing Modal
  nowPlayingModalContainer: { flex: 1 },
  modalDismissHeader: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  modalHandleBar: { width: 40, height: 5, borderRadius: 2.5 },
  nowPlayingScroll: { paddingHorizontal: 26, paddingBottom: 40 },
  nowPlayingArtworkWrapper: {
    alignSelf: 'center',
    marginTop: 14,
    shadowColor: '#000',
    shadowOpacity: 0.65,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    borderRadius: 16,
  },
  nowPlayingMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 28,
  },
  nowPlayingTitle: { fontSize: 22, fontWeight: '600' },
  nowPlayingArtist: { fontSize: 16, marginTop: 4 },
  nowPlayingDotsCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrubberSlider: { width: '100%', height: 32, marginTop: 22 },
  scrubberTimeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  scrubberTimeText: { fontSize: 11, fontVariant: ['tabular-nums'] },
  nowPlayingControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginTop: 26,
    paddingHorizontal: 20,
  },
  nowPlayingPlayButton: { padding: 6 },
  volumeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 34, paddingHorizontal: 6 },
  volumeSlider: { flex: 1, marginHorizontal: 12 },
  nowPlayingBottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginTop: 32,
    paddingHorizontal: 16,
  },
  queueContainer: { marginTop: 28, borderRadius: 14, padding: 16 },
  queueHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  queueHeaderTitle: { fontSize: 18, fontWeight: '600' },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  queueItemTitle: { fontSize: 14, fontWeight: '500' },
  queueItemArtist: { fontSize: 12, marginTop: 2 },

  // Server Settings Modal
  accountModalContainer: { flex: 1 },
  accountHeader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    height: 54,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
  },
  accountTitle: { fontSize: 18, fontWeight: '600' },
  accountDoneButton: {
    position: 'absolute',
    top: 0,
    right: 20,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  accountDoneRed: {
    fontSize: 17,
    fontWeight: '500',
  },
  serverCard: { borderRadius: 14, padding: 18, marginTop: 20, borderWidth: StyleSheet.hairlineWidth },
  serverCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 8 },
  serverCardTitle: { fontSize: 17, fontWeight: '600', flex: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  serverLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0, marginBottom: 8 },
  serverInput: {
    height: 48,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 15,
    borderWidth: 1,
  },
  serverConnectButton: { height: 46, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  serverConnectButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  statsCard: { borderRadius: 14, padding: 18, marginTop: 18, borderWidth: StyleSheet.hairlineWidth },
  statsHeaderTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  statsLabel: { fontSize: 15 },
  statsValue: { fontSize: 15, fontWeight: '500' },
  disconnectButton: { marginTop: 24, padding: 14, alignItems: 'center' },
  disconnectButtonText: { fontSize: 15, fontWeight: '500' },

  // New Playlist Modal
  newPlaylistHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    height: 54,
  },
  newPlaylistModalTitle: { fontSize: 18, fontWeight: '600' },
  newPlaylistContent: { paddingHorizontal: 20, paddingTop: 16 },
  newPlaylistCoverBox: {
    width: 180,
    height: 180,
    borderRadius: 14,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  playlistInput: { height: 48, fontSize: 16 },
  accountDivider: { height: StyleSheet.hairlineWidth },

  // Add to Playlist Modal
  addToPlaylistTrackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  playlistPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    height: 62,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  playlistPickIcon: {
    width: 44,
    height: 44,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistPickText: { fontSize: 17, fontWeight: '500', marginLeft: 14 },

  // Popups
  popupOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  sortMenuCard: { width: 240, borderRadius: 14, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth },
  sortOptionRow: { flexDirection: 'row', alignItems: 'center', height: 44, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  sortOptionText: { fontSize: 16 },
  contextMenuCard: { width: 260, borderRadius: 14, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth },
  contextRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 46, paddingHorizontal: 16 },
  contextWhiteText: { fontSize: 15 },
});
