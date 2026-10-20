# src/platform — shell-compatible platform modules

Foundation check (v0.6): `mikeylambo/Web-Game-Shell-v1.02` provides `BrowserStorage`, `BrowserHaptics`,
`installBrowserLifecycle` and `BrowserShare` under `src/platform/browser/`, but it has **no AudioContext
lifecycle** and is not published as an installable package (its `prepare` script builds from a private git
source, which a clean Vercel `npm ci` cannot rely on). So these local modules keep the shell's exact
interfaces and can be swapped for `@slu/web-shell` imports later without touching callers.

| Local module | Shell equivalent |
| --- | --- |
| `Storage.ts` `BrowserStorage` | `platform/browser/BrowserStorage.ts` (same async API, plus sync `readJson`/`writeJson` helpers) |
| `Haptics.ts` `BrowserHaptics` | `platform/browser/BrowserHaptics.ts` (same `HapticCatalog`, `pulse`, `setEnabled`) |
| `Lifecycle.ts` `installBrowserLifecycle` | `platform/browser/BrowserLifecycle.ts` (same handler shape) |
| `Share.ts` `shareFiles` | `platform/browser/BrowserShare.ts` |
