export type Theme = "light" | "dark";
export const THEME_STORAGE_KEY = "notepad-theme";
export const DEFAULT_THEME: Theme = "dark";

// Runs before paint to avoid a flash. No user content is interpolated.
// Dark is the default; light is only used when the user chose it.
export const THEME_INIT_SCRIPT = `(() => {
  let theme;
  try { theme = localStorage.getItem("notepad-theme"); } catch {}
  if (theme !== "light" && theme !== "dark") theme = "dark";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();`;

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute("content", theme === "dark" ? "#121613" : "#f7f8f5");
  });
}
