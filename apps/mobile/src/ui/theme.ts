/**
 * The small amount of visual vocabulary the app needs so far.
 *
 * Deliberately not a design system. VG-036 is the UI pass; until then this
 * exists so three screens do not each invent their own spacing and blue.
 */
export const theme = {
  colors: {
    background: '#0B1F33',
    surface: '#12293F',
    border: '#204058',
    text: '#F2F6FA',
    textMuted: '#9DB2C4',
    accent: '#3DA9FC',
    accentText: '#04121E',
    danger: '#FF6B6B',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  radius: {
    md: 10,
  },
} as const;
