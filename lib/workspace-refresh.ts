// Reconcile a suspended tab as soon as it returns, and keep a visible workspace
// reasonably current without polling hidden tabs or requiring a DB migration.
export function watchWorkspaceRefresh(refresh: () => Promise<void>) {
  let disposed = false;
  let running = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const available = () => !disposed && document.visibilityState === 'visible' && navigator.onLine !== false;
  const run = async () => {
    timer = undefined;
    if (!available()) return;
    if (running) { pending = true; return; }
    running = true;
    try {
      await refresh();
    } catch {
      // A transient background failure is retried by the next wake/interval.
    } finally {
      running = false;
      if (pending && !disposed) { pending = false; schedule(); }
    }
  };
  const schedule = () => {
    if (!available() || timer !== undefined) return;
    // Browsers commonly emit focus and visibilitychange together.
    timer = setTimeout(() => { void run(); }, 250);
  };
  window.addEventListener('focus', schedule);
  window.addEventListener('pageshow', schedule);
  window.addEventListener('online', schedule);
  document.addEventListener('visibilitychange', schedule);
  const interval = setInterval(schedule, 60_000);
  return () => {
    disposed = true;
    clearTimeout(timer);
    clearInterval(interval);
    window.removeEventListener('focus', schedule);
    window.removeEventListener('pageshow', schedule);
    window.removeEventListener('online', schedule);
    document.removeEventListener('visibilitychange', schedule);
  };
}
