import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkColors, lightColors, ColorTheme } from './colors';

export type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeContextType {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  isDark: boolean;
  colors: ColorTheme;
}

const THEME_STORAGE_KEY = '@clickrypt_theme_mode';

const ThemeContext = createContext<ThemeContextType>({
  themeMode: 'dark',
  setThemeMode: async () => {},
  isDark: true,
  colors: darkColors,
});

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('dark');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const loadSavedTheme = async () => {
      try {
        const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (saved === 'system' || saved === 'light' || saved === 'dark') {
          setThemeModeState(saved);
        }
      } catch {
        // fallback to default
      } finally {
        setIsLoaded(true);
      }
    };
    loadSavedTheme();
  }, []);

  const setThemeMode = async (mode: ThemeMode) => {
    setThemeModeState(mode);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  };

  const isDark =
    themeMode === 'system'
      ? systemColorScheme !== 'light'
      : themeMode === 'dark';

  const activeColors: ColorTheme = isDark ? darkColors : lightColors;

  return (
    <ThemeContext.Provider
      value={{
        themeMode,
        setThemeMode,
        isDark,
        colors: activeColors,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
