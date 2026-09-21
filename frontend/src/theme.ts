/**
 * SoulLog's palette, in one place.
 *
 * Every screen takes a `theme` prop and reads colours off it. Until now
 * each screen also *defined* one: six near-identical copies of the same
 * dark/light pair, plus a few that added a key or two of their own. The
 * copies had drifted, and because `theme` was typed `any`, nothing
 * noticed. Screens were reading `theme.cardBg`, `theme.mutedText`,
 * `theme.error` and `theme.surfaceElevated` from objects that defined
 * none of them — the value came back `undefined`, the style was silently
 * dropped, and a card that was meant to sit on an elevated surface simply
 * sat on nothing.
 *
 * So the palette lives here, the `Theme` type lists every key a screen is
 * allowed to read, and TypeScript enforces the connection. Adding a
 * colour means adding it to both sides, which is the point: there is no
 * longer a way to read a colour that was never defined.
 *
 * The five brand colours are unchanged. Nothing here alters the app's
 * look — the derived keys were chosen to match what each screen was
 * already trying to draw.
 */

export const colors = {
  indigo: '#1B1F3B',
  pearl: '#FAF8F0',
  gold: '#CFAE61',
  teal: '#2CABA4',
  darkGrey: '#2E2E2E',
} as const;

export interface Theme {
  /** The page behind everything. */
  background: string;
  /** Cards and panels sitting on the background. */
  surface: string;
  /** A panel that needs to sit above another panel. */
  surfaceElevated: string;
  /** Card interiors — modals, profile cards, the message list. */
  cardBg: string;
  /** The conversation area in Whispers. */
  chatBg: string;
  /** Form fields. */
  inputBg: string;
  /** Body text. */
  text: string;
  /** Supporting text: timestamps, captions, helper lines. */
  textSecondary: string;
  /** The quietest text the design uses — hints, disabled states. */
  textTertiary: string;
  /** Alias of textSecondary, kept because several screens say `mutedText`. */
  mutedText: string;
  /** SoulLog gold: primary actions and highlights. */
  accent: string;
  /** SoulLog teal: secondary actions. */
  secondary: string;
  /** Hairlines and outlines. */
  border: string;
  /** Destructive actions and error text. */
  error: string;
  /** The page-wide gradient a couple of screens paint behind a header. */
  gradient: string;
  /** The standard card shadow. */
  shadow: string;
  /** Generic foreground, for components that ask for `theme.color`. */
  color: string;
}

const dark: Theme = {
  background: colors.indigo,
  surface: '#2A2F4F',
  surfaceElevated: '#333963',
  cardBg: '#1E2347',
  chatBg: '#1B1F3B',
  inputBg: '#2A2F4F',
  text: colors.pearl,
  textSecondary: '#B9B6AC',
  textTertiary: '#8A8880',
  mutedText: '#B9B6AC',
  accent: colors.gold,
  secondary: colors.teal,
  border: '#3A3F5F',
  error: '#EF4444',
  gradient: 'linear-gradient(135deg, #1B1F3B 0%, #2A2F4F 100%)',
  shadow: '0 10px 30px rgba(0, 0, 0, 0.35)',
  color: colors.pearl,
};

const light: Theme = {
  background: colors.pearl,
  surface: '#FFFFFF',
  surfaceElevated: '#F3F1E9',
  cardBg: '#FFFFFF',
  chatBg: '#F7F5EE',
  inputBg: '#F8F9FA',
  text: colors.darkGrey,
  textSecondary: '#6B6B6B',
  textTertiary: '#9A9A9A',
  mutedText: '#6B6B6B',
  accent: colors.gold,
  secondary: colors.teal,
  border: '#E0E0E0',
  error: '#DC2626',
  gradient: 'linear-gradient(135deg, #FAF8F0 0%, #F5F5F5 100%)',
  shadow: '0 20px 40px rgba(0, 0, 0, 0.1)',
  color: colors.darkGrey,
};

/** The palette for the current mode. */
export const buildTheme = (darkMode: boolean): Theme => (darkMode ? dark : light);

/**
 * A theme for a component rendered without one.
 *
 * Several screens were written to be runnable on their own and merged a
 * prop over a local default. They keep that ability; this is the default
 * they merge over.
 */
export const defaultTheme: Theme = dark;
