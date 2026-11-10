import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { darkPalette, lightPalette, type Palette } from "./tokens";

export type ThemePreference = "system" | "light" | "dark";

interface Theme {
  dark: boolean;
  colors: Palette;
  preference: ThemePreference;
  setPreference: (value: ThemePreference) => void;
}

const KEY = "sag_theme";
const ThemeContext = createContext<Theme>({ dark: false, colors: lightPalette, preference: "system", setPreference: () => {} });

/** Follows the phone's light/dark setting unless the person picked one in the settings (remembered on the device). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((saved) => {
        if (saved === "light" || saved === "dark" || saved === "system") setPreferenceState(saved);
      })
      .catch(() => {});
  }, []);

  const setPreference = useCallback((value: ThemePreference) => {
    setPreferenceState(value);
    AsyncStorage.setItem(KEY, value).catch(() => {});
  }, []);

  const dark = preference === "system" ? system === "dark" : preference === "dark";
  const value = useMemo<Theme>(
    () => ({ dark, colors: dark ? darkPalette : lightPalette, preference, setPreference }),
    [dark, preference, setPreference],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
