// Picks the colour theme before the first paint (no flash of the wrong theme).
// A separate file, not an inline <script>, so the Content-Security-Policy can
// forbid inline scripts altogether.
(function () {
  try {
    var stored = localStorage.getItem("tf-theme");
    var theme =
      stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();
