export const THEME_STORAGE_KEY = "markuplens-theme";

/**
 * Applies the stored theme (or the OS preference) to <html> before first
 * paint, so there is no light/dark flash on load. Runs synchronously while
 * the browser parses <head>.
 */
const script = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var d=t==="dark"||((t===null||t==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light";}catch(e){}})();`;

export function ThemeScript() {
  return (
    <script
      // text/plain on the client so React doesn't re-run or warn about it
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
