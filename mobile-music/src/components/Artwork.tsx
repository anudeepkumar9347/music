import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '../theme';

interface ArtworkProps {
  uri?: string;
  title?: string;
  size: number | `${number}%`;
  radius?: number;
  fontSize?: number;
  style?: ViewStyle;
}

// Generates a subtle, tasteful dark accent background for the letter monogram
function getArtworkBackground(title?: string): string {
  if (!title) return colors.cardSecondary;
  const tones = [
    '#252830', // Deep slate
    '#322228', // Muted dark crimson
    '#1F2B37', // Midnight navy
    '#1E3128', // Dark spruce
    '#31261E', // Warm umber
    '#2A2135', // Deep plum
    '#242B28', // Dark forest
    '#2E2224', // Burgundy tone
  ];
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash << 5) - hash + title.charCodeAt(i);
    hash |= 0;
  }
  return tones[Math.abs(hash) % tones.length];
}

export function getStartingLetter(title?: string): string {
  if (!title) return '♪';
  const clean = title.trim();
  if (!clean) return '♪';
  const match = clean.match(/[a-zA-Z0-9]/);
  return match ? match[0].toUpperCase() : clean.charAt(0).toUpperCase();
}

export function Artwork({
  uri,
  title,
  size,
  radius = 8,
  fontSize,
  style,
}: ArtworkProps) {
  const [hasError, setHasError] = useState(false);

  // Reset error state when the uri prop changes
  useEffect(() => {
    setHasError(false);
  }, [uri]);

  const letter = getStartingLetter(title);
  const bgColor = getArtworkBackground(title);

  const isPercent = typeof size === 'string' && size.includes('%');
  const numericSize = typeof size === 'number' ? size : 150;
  const computedFontSize =
    fontSize ??
    (isPercent
      ? 76
      : numericSize <= 50
      ? Math.round(numericSize * 0.44)
      : Math.round(numericSize * 0.4));

  const dimensionStyle: ViewStyle = isPercent
    ? { width: '100%', aspectRatio: 1, borderRadius: radius }
    : { width: size, height: size, aspectRatio: 1, borderRadius: radius };

  if (uri && !hasError) {
    return (
      <View style={[styles.container, dimensionStyle, style]}>
        <Image
          source={{ uri }}
          style={styles.image}
          onError={() => setHasError(true)}
          resizeMode="cover"
        />
      </View>
    );
  }

  // Fallback: Clean typography artwork with the song/album's starting letter
  return (
    <View
      style={[
        styles.container,
        dimensionStyle,
        {
          backgroundColor: bgColor,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: 'rgba(255,255,255,0.08)',
        },
        style,
      ]}
    >
      <Text
        style={[
          styles.letter,
          {
            fontSize: computedFontSize,
            lineHeight: computedFontSize * 1.15,
          },
        ]}
      >
        {letter}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.card,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  letter: {
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
});
