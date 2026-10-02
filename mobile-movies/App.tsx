import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import SyncedMovieApp from './src/MovieApp';
import { colors } from './src/theme';

type Tab = 'Home' | 'Browse';
type ContentType = 'Movies' | 'Shows';

const genres = [
  { name: 'Action', icon: 'flash-outline' as const },
  { name: 'Adventure', icon: 'compass-outline' as const },
  { name: 'Comedy', icon: 'happy-outline' as const },
  { name: 'Drama', icon: 'film-outline' as const },
  { name: 'Documentary', icon: 'videocam-outline' as const },
  { name: 'Sci-Fi', icon: 'planet-outline' as const },
];

export default function App() {
  return <SyncedMovieApp />;
}

function MoviesApp() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('Home');
  const [contentType, setContentType] = useState<ContentType>('Movies');
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [showBrandSplash, setShowBrandSplash] = useState(true);

  useEffect(() => {
    const splashTimer = setTimeout(() => setShowBrandSplash(false), 2000);
    return () => clearTimeout(splashTimer);
  }, []);

  function openGenre(genre: string) {
    setSelectedGenre(genre);
    setTab('Browse');
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />
      <View style={styles.screen}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heading}>
            <View>
              <Text style={styles.eyebrow}>MOBILE MOVIES</Text>
              <Text style={styles.title}>{tab === 'Home' ? 'Discover' : 'Browse'}</Text>
            </View>
            {tab === 'Home' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Browse movies"
                onPress={() => setTab('Browse')}
                style={styles.playerButton}
              >
                <Ionicons name="play" size={18} color={colors.background} />
                <Text style={styles.playerButtonLabel}>Browse Movies</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.segmentedControl} accessibilityRole="tablist">
            {(['Movies', 'Shows'] as const).map((type) => {
              const selected = contentType === type;
              return (
                <Pressable
                  key={type}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  onPress={() => setContentType(type)}
                  style={[styles.segment, selected && styles.segmentSelected]}
                >
                  <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                    {type}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {tab === 'Home' ? (
            <>
              <View style={styles.sectionHeading}>
                <Text style={styles.sectionTitle}>Genres</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setSelectedGenre(null);
                    setTab('Browse');
                  }}
                  style={styles.textButton}
                >
                  <Text style={styles.textButtonLabel}>View all</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.green} />
                </Pressable>
              </View>
              <View style={styles.genreGrid}>
                {genres.slice(0, 4).map((genre) => (
                  <GenreTile
                    key={genre.name}
                    name={genre.name}
                    icon={genre.icon}
                    onPress={() => openGenre(genre.name)}
                  />
                ))}
              </View>
              <EmptyCatalog contentType={contentType} genre={null} />
            </>
          ) : (
            <>
              <View style={styles.sectionHeading}>
                <Text style={styles.sectionTitle}>All genres</Text>
                {selectedGenre ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setSelectedGenre(null)}
                    style={styles.textButton}
                  >
                    <Text style={styles.textButtonLabel}>Clear filter</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.genreGrid}>
                {genres.map((genre) => (
                  <GenreTile
                    key={genre.name}
                    name={genre.name}
                    icon={genre.icon}
                    selected={selectedGenre === genre.name}
                    onPress={() => setSelectedGenre(
                      selectedGenre === genre.name ? null : genre.name,
                    )}
                  />
                ))}
              </View>
              <EmptyCatalog contentType={contentType} genre={selectedGenre} />
            </>
          )}
        </ScrollView>

        <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {(['Home', 'Browse'] as const).map((item) => {
            const selected = tab === item;
            const icon = item === 'Home' ? 'home-outline' : 'grid-outline';
            return (
              <Pressable
                key={item}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setTab(item)}
                style={styles.tabButton}
              >
                <Ionicons
                  name={icon}
                  size={21}
                  color={selected ? colors.green : colors.textMuted}
                />
                <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>
                  {item}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {showBrandSplash ? (
          <View pointerEvents="none" style={styles.brandSplash}>
            <View style={styles.brandMark}>
              <Ionicons name="film-outline" size={76} color={colors.green} />
            </View>
            <Text style={styles.brandName}>Mobile Movies</Text>
            <Text style={styles.brandTagline}>STORIES WORTH WATCHING</Text>
            <View style={styles.brandAccent} />
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

interface GenreTileProps {
  name: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  selected?: boolean;
  onPress: () => void;
}

function GenreTile({ name, icon, selected = false, onPress }: GenreTileProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.genreTile, selected && styles.genreTileSelected]}
    >
      <View style={[styles.genreIcon, selected && styles.genreIconSelected]}>
        <Ionicons name={icon} size={21} color={selected ? colors.green : colors.textSecondary} />
      </View>
      <Text style={[styles.genreLabel, selected && styles.genreLabelSelected]}>{name}</Text>
      <Ionicons name="arrow-forward" size={16} color={selected ? colors.green : colors.textMuted} />
    </Pressable>
  );
}

function EmptyCatalog({ contentType, genre }: { contentType: ContentType; genre: string | null }) {
  const noun = contentType === 'Movies' ? 'movies' : 'shows';
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <Ionicons name="film-outline" size={25} color={colors.green} />
      </View>
      <Text style={styles.emptyTitle}>No {genre ? `${genre.toLowerCase()} ` : ''}{noun} yet</Text>
      <Text style={styles.emptyMessage}>Titles will appear here when a catalog is connected.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  eyebrow: {
    color: colors.green,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '600',
  },
  playerButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 13,
    borderRadius: 8,
    backgroundColor: colors.green,
  },
  playerButtonLabel: {
    color: colors.background,
    fontSize: 13,
    fontWeight: '600',
  },
  segmentedControl: {
    flexDirection: 'row',
    padding: 4,
    marginBottom: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.background,
  },
  segment: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  segmentSelected: {
    backgroundColor: colors.card,
  },
  segmentText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  segmentTextSelected: {
    color: colors.text,
  },
  sectionHeading: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 21,
    fontWeight: '600',
  },
  textButton: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  textButtonLabel: {
    color: colors.green,
    fontSize: 13,
    fontWeight: '500',
  },
  genreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  genreTile: {
    width: '48.5%',
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.card,
  },
  genreTileSelected: {
    borderColor: colors.green,
    backgroundColor: colors.greenDark,
  },
  genreIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: colors.cardElevated,
  },
  genreIconSelected: {
    backgroundColor: colors.background,
  },
  genreLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '500',
  },
  genreLabelSelected: {
    color: colors.greenLight,
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 72,
    paddingBottom: 48,
  },
  emptyIcon: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderRadius: 27,
    backgroundColor: colors.greenDark,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyMessage: {
    maxWidth: 280,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 8,
  },
  tabBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 10,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.tabBarBorder,
    backgroundColor: colors.tabBar,
  },
  tabButton: {
    minWidth: 88,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  tabLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '500',
  },
  tabLabelSelected: {
    color: colors.green,
  },
  brandSplash: {
    ...StyleSheet.absoluteFill,
    zIndex: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  brandMark: {
    width: 142,
    height: 142,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 42,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.card,
    shadowColor: colors.green,
    shadowOpacity: 0.35,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  brandName: {
    color: colors.text,
    fontSize: 25,
    fontWeight: '600',
    marginTop: 25,
  },
  brandTagline: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '500',
    marginTop: 7,
  },
  brandAccent: {
    width: 32,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.green,
    marginTop: 18,
  },
});
