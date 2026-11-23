import type { Lists } from './settings';

type Level = 'fine' | 'gray' | 'hard';
const ORDER: Level[] = ['fine', 'gray', 'hard']; // tie-break priority

export function classifySite(url: string, sites: Lists): Level {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'fine';
  }
  let best: Level = 'fine';
  let bestLen = -1;
  for (const level of ORDER) {
    for (const raw of sites[level]) {
      const entry = raw.toLowerCase();
      if ((host === entry || host.endsWith('.' + entry)) && entry.length > bestLen) {
        best = level;
        bestLen = entry.length;
      }
    }
  }
  return best;
}

export function classifyApp(exe: string, apps: Lists): Level | 'unlisted' {
  const name = exe.toLowerCase();
  for (const level of ORDER) {
    if (apps[level].some((e) => e.toLowerCase() === name)) return level;
  }
  return 'unlisted';
}
