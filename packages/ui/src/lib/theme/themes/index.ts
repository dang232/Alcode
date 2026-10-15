import type { Theme } from '@/types/theme';
import { presetThemes } from './presets';
import { withPrColors } from './prColors';
import { requireTheme } from '../definition';
import flexokiLightRaw from './flexoki-light.json';
import flexokiDarkRaw from './flexoki-dark.json';
import alcodeLightRaw from './alcode-light.json';
import alcodeDarkRaw from './alcode-dark.json';

const flexokiLightTheme = withPrColors(requireTheme(flexokiLightRaw));
const flexokiDarkTheme = withPrColors(requireTheme(flexokiDarkRaw));
const alcodeLightTheme = withPrColors(requireTheme(alcodeLightRaw));
const alcodeDarkTheme = withPrColors(requireTheme(alcodeDarkRaw));

export const DEFAULT_LIGHT_THEME_ID = 'alcode-light' as const;
export const DEFAULT_DARK_THEME_ID = 'alcode-dark' as const;

export const themes: Theme[] = [
  alcodeLightTheme,
  alcodeDarkTheme,
  flexokiLightTheme,
  flexokiDarkTheme,
  ...presetThemes.filter(
    (theme) => theme.metadata.id !== 'alcode-light' && theme.metadata.id !== 'alcode-dark',
  ),
];

export function getThemeById(id: string): Theme | undefined {
  // Back-compat for a short-lived rename.
  const resolvedId =
    id === 'app-light' ? 'flexoki-light' :
    id === 'app-dark' ? 'flexoki-dark' :
    id;

  return themes.find(theme => theme.metadata.id === resolvedId);
}

export function getDefaultTheme(prefersDark: boolean): Theme {
  const variant: Theme['metadata']['variant'] = prefersDark ? 'dark' : 'light';

  const defaultId = prefersDark ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID;
  const defaultTheme = getThemeById(defaultId);
  if (defaultTheme && defaultTheme.metadata.variant === variant) {
    return defaultTheme;
  }

  return themes.find((theme) => theme.metadata.variant === variant) ?? themes[0] ?? flexokiLightTheme;
}
