const BYPASS_LABELS: Record<string, string> = {
  'blocking-turned-off': 'Turned off blocking',
  'extension-disconnected': 'Browser extension switched off',
  'app-closed': 'App closed',
};

/** Human label for a bypass event's target; unknown targets show raw. */
export const bypassLabel = (target: string | null): string => (target === null ? 'Unknown' : (BYPASS_LABELS[target] ?? target));
