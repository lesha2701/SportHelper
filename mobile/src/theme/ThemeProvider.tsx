import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { darkPalette, lightPalette, type Palette } from "./tokens";

interface Theme {
  dark: boolean;
  colors: Palette;
}

const ThemeContext = createContext<Theme>({ dark: false, colors: lightPalette });

/** Follows the phone's light/dark setting (a manual switch comes with the settings screen). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const value = useMemo<Theme>(() => ({ dark: scheme === "dark", colors: scheme === "dark" ? darkPalette : lightPalette }), [scheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
