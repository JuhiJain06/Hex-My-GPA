const BYPASS_LABELS: Record<string, string> = {
  'blocking-turned-off': 'Turned off blocking',
  'extension-disconnected': 'Browser extension switched off',
  'app-closed': 'App closed',
};

/** Human label for a bypass event's target; unknown targets show raw. */
export const bypassLabel = (target: string | null): string => (target === null ? 'Unknown' : (BYPASS_LABELS[target] ?? target));

/** The pet's browser-link notice (bubble and menu); null when the extension is connected. */
export function extensionStatusText(s: { bridgeListening: boolean; extensionConnected: boolean }): string | null {
  if (!s.bridgeListening) return 'Browser link unavailable (port in use) — websites aren\'t being watched';
  return s.extensionConnected ? null : 'Browser buddy not connected — websites aren\'t being watched';
}
