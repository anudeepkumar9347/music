export const MUSIC_API_URL =
  process.env.EXPO_PUBLIC_API_URL?.trim() ||
  process.env.EXPO_PUBLIC_MUSIC_API_URL?.trim() ||
  'http://127.0.0.1:8000';
