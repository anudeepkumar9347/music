// Apple Music Design System — Dark + Light Themes
// Exact color palette extracted from Figma design system (red.png, brown.png, white.png)

// Shared raw palette tokens
export const palette = {
  // Red Palette (red.png)
  r50: '#FFE6E6',
  r75: '#FD9A9A',
  r100: '#FD7070',
  r200: '#FC3232',
  r300: '#FB0808', // Primary Apple Music Accent Red
  r400: '#B00606',
  r500: '#990505',

  // White / Light Neutral (white.png)
  w50: '#FFFFFF',
  w100: '#F5F5F7',
  w200: '#EFEFEF',
  w300: '#E0E0E0',
  w400: '#B3B3B3',
  w500: '#9C9C9C',

  // Brown / Dark Neutral Palette (brown.png)
  b50: '#EFEFEF',
  b75: '#BFBEBE',
  b100: '#A4A3A3',
  b200: '#7D7C7C',
  b300: '#626161',
  b400: '#454444',
  b500: '#3C3B3B',

  // System greens
  green: '#34C759',
  greenDark: '#1A3824',
  redDark: '#3A1E22',
};

// ---- Dark Theme (default) ----
export const darkColors = {
  ...palette,

  // Semantic UI
  background: '#000000',
  card: '#1C1C1E',
  cardElevated: '#242426',
  cardSecondary: '#2C2C2E',
  pill: '#3A3A3C',
  divider: '#2C2C2E',
  tabBar: '#121212',
  tabBarBorder: '#232325',
  miniPlayer: '#242426',
  text: '#FFFFFF',
  textSecondary: '#A4A3A3',
  textMuted: '#7D7C7C',
  textSubtle: '#454444',
  red: '#FB0808',
  redDark: '#B00606',
  inputBg: '#1C1C1E',
  searchBarBg: '#1C1C1E',
  chevron: '#454444',
  isDark: true,
};

// ---- Light Theme (follows red R300 primary palette) ----
export const lightColors = {
  ...palette,

  // Semantic UI — Light overrides
  background: '#F2F2F7',
  card: '#FFFFFF',
  cardElevated: '#FFFFFF',
  cardSecondary: '#EFEFEF',
  pill: '#E0E0E0',
  divider: '#C6C6C8',
  tabBar: '#F9F9F9',
  tabBarBorder: '#D1D1D6',
  miniPlayer: '#FFFFFF',
  text: '#000000',
  textSecondary: '#626161',
  textMuted: '#7D7C7C',
  textSubtle: '#9C9C9C',
  red: '#FB0808',
  redDark: '#B00606',
  inputBg: '#FFFFFF',
  searchBarBg: '#E5E5EA',
  chevron: '#C7C7CC',
  isDark: false,
};

export type AppColors = typeof darkColors;

export function getColors(isDark: boolean): AppColors {
  return isDark ? darkColors : lightColors;
}

// Re-export `colors` as the dark default for any legacy imports
export const colors = darkColors;

export const typography = {
  largeTitle: {
    fontSize: 34,
    fontWeight: '600' as const,
    letterSpacing: 0,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '600' as const,
    letterSpacing: 0,
  },
  headline: {
    fontSize: 17,
    fontWeight: '500' as const,
  },
  subhead: {
    fontSize: 14,
    fontWeight: '400' as const,
  },
  body: {
    fontSize: 15,
    fontWeight: '400' as const,
  },
  caption: {
    fontSize: 12,
    fontWeight: '400' as const,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '500' as const,
    letterSpacing: 0.1,
  },
};
