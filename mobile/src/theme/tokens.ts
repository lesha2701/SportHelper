/** The website's colour tokens (frontend/src/index.css), light and dark. */
export interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  borderStrong: string;
  primary: string;
  primaryPressed: string;
  primaryText: string;
  primaryGlow: string;
  success: string;
  successBg: string;
  danger: string;
  dangerBg: string;
  warning: string;
  warningBg: string;
  overlay: string;
}

export const lightPalette: Palette = {
  bg: "#fafafa",
  surface: "#ffffff",
  surfaceAlt: "#f2f1ef",
  text: "#17181b",
  textSecondary: "#5c5e66",
  textTertiary: "#96979e",
  border: "#e7e6e3",
  borderStrong: "#d6d4cf",
  primary: "#d91e2b",
  primaryPressed: "#b8121e",
  primaryText: "#ffffff",
  primaryGlow: "#fbeae9",
  success: "#1f9d5c",
  successBg: "#eafaf1",
  danger: "#e85d2a",
  dangerBg: "#fdf0e9",
  warning: "#b6790f",
  warningBg: "#fdf3e0",
  overlay: "rgba(23,24,27,0.5)",
};

export const darkPalette: Palette = {
  bg: "#121214",
  surface: "#1c1d20",
  surfaceAlt: "#26272b",
  text: "#f2f1ef",
  textSecondary: "#a8a9ae",
  textTertiary: "#6e6f75",
  border: "rgba(255,255,255,0.08)",
  borderStrong: "rgba(255,255,255,0.14)",
  primary: "#ff3b3f",
  primaryPressed: "#ff5a5d",
  primaryText: "#ffffff",
  primaryGlow: "rgba(255,59,63,0.16)",
  success: "#34c778",
  successBg: "rgba(52,199,120,0.14)",
  danger: "#ff7a4d",
  dangerBg: "rgba(255,122,77,0.14)",
  warning: "#f5a623",
  warningBg: "rgba(245,166,35,0.14)",
  overlay: "rgba(0,0,0,0.6)",
};

export const radius = { sm: 4, md: 8, lg: 12, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const fonts = {
  body: "Montserrat_400Regular",
  bodyMedium: "Montserrat_500Medium",
  bodySemi: "Montserrat_600SemiBold",
  bodyBold: "Montserrat_700Bold",
  display: "Oswald_600SemiBold",
} as const;
