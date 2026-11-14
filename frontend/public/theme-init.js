// Picks the colour theme before the first paint (no flash of the wrong theme).
// A separate file, not an inline <script>, so the Content-Security-Policy can
// forbid inline scripts altogether. Dark is the default; only an explicit choice
// saved in the settings ("tf-theme") switches it to light.
(function () {
  try {
    var stored = localStorage.getItem("tf-theme");
    document.documentElement.dataset.theme = stored === "light" ? "light" : "dark";
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
})();
