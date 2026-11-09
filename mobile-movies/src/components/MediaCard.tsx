import { Ionicons } from '@expo/vector-icons';
import { Image, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { MediaItem } from '../movieApi';
import { colors } from '../theme';

type MediaCardProps = {
  item: MediaItem;
  isFavorite: boolean;
  onOpen: () => void;
  onToggleFavorite: () => void;
  style?: ViewStyle;
};

export function MediaCard({ item, isFavorite, onOpen, onToggleFavorite, style }: MediaCardProps) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.artworkFrame}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${item.title}`}
          onPress={onOpen}
          style={styles.artworkPressable}
        >
          {item.posterUrl ? (
            <Image source={{ uri: item.posterUrl }} style={styles.poster} resizeMode="cover" />
          ) : (
            <View style={styles.posterFallback}>
              <Ionicons name={item.type === 'movie' ? 'film-outline' : 'tv-outline'} size={32} color={colors.green} />
            </View>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          onPress={onToggleFavorite}
          style={styles.favoriteButton}
        >
          <Ionicons name={isFavorite ? 'heart' : 'heart-outline'} size={18} color={isFavorite ? colors.green : colors.text} />
        </Pressable>
      </View>
      <Pressable onPress={onOpen} style={styles.metadata}>
        <Text numberOfLines={1} style={styles.title}>{item.title}</Text>
        <Text numberOfLines={1} style={styles.subtitle}>
          {[item.year, item.genres[0]].filter(Boolean).join(' · ') || (item.type === 'movie' ? 'Movie' : 'Show')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 148,
  },
  artworkFrame: {
    position: 'relative',
    overflow: 'hidden',
    aspectRatio: 0.68,
    borderRadius: 8,
    backgroundColor: colors.card,
  },
  artworkPressable: {
    flex: 1,
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  posterFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cardElevated,
  },
  favoriteButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  metadata: {
    paddingTop: 8,
  },
  title: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 3,
  },
});