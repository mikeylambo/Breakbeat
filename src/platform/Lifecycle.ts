/** Shell-compatible lifecycle hooks (mirrors @slu/web-shell installBrowserLifecycle). */

export interface BrowserLifecycleHandlers {
  onBackground?: () => void;
  onForeground?: () => void;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

export function installBrowserLifecycle(handlers: BrowserLifecycleHandlers, canvas?: HTMLCanvasElement): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const onVisibility = (): void => {
    if (document.hidden) handlers.onBackground?.();
    else handlers.onForeground?.();
  };
  const onContextLost = (event: Event): void => {
    event.preventDefault();
    handlers.onContextLost?.();
  };
  const onContextRestored = (): void => handlers.onContextRestored?.();
  document.addEventListener('visibilitychange', onVisibility);
  canvas?.addEventListener('webglcontextlost', onContextLost);
  canvas?.addEventListener('webglcontextrestored', onContextRestored);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    canvas?.removeEventListener('webglcontextlost', onContextLost);
    canvas?.removeEventListener('webglcontextrestored', onContextRestored);
  };
}
