import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import initSqlJs, { type Database } from 'sql.js';
import {
  DEFAULT_SETTINGS,
  type BuddyEvent,
  type EngineState,
  type SessionInfo,
  type SessionRecord,
  type Settings,
} from '@study-buddy/core';

export interface Reflection {
  at: number;
  goal: 'yes' | 'partly' | 'no' | null;
  tags: string[];
  note: string | null;
}

export interface Db {
  getSettings(): Settings;
  saveSettings(s: Settings): void;
  getSecret(): string;
  createSession(info: SessionInfo): number;
  saveSnapshot(id: number, snap: EngineState, now: number): void;
  activeSession(now: number): { id: number; snapshot: EngineState; heartbeatAt: number; stale: boolean } | null;
  finishSession(id: number, snap: EngineState, endedAt: number): void;
  addEvent(id: number, e: BuddyEvent): void;
  saveReflection(id: number, r: Reflection): void;
  sessions(sinceMs: number): SessionRecord[];
  reflections(sinceMs: number): { at: number; tags: string[] }[];
  intervalsSince(sinceMs: number): [number, number][];
}

const STALE_MS = 10 * 60_000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  info_json TEXT NOT NULL,
  snapshot_json TEXT,
  heartbeat_at INTEGER NOT NULL DEFAULT 0,
  ended_at INTEGER,
  blocks_completed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS intervals (session_id INTEGER NOT NULL, start INTEGER NOT NULL, "end" INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events (session_id INTEGER NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, target TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS reflections (session_id INTEGER NOT NULL, at INTEGER NOT NULL, goal TEXT, tags_json TEXT NOT NULL, note TEXT);
`;

type Param = string | number | null;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep-merge saved values over defaults so newly added keys get defaults. */
function merge<T>(base: T, over: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(over)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(over)) out[k] = k in base ? merge((base as Record<string, unknown>)[k], over[k]) : over[k];
  return out as T;
}

const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_ATTEMPTS = 5;
const RENAME_DELAY_MS = 50;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Rename, retrying briefly on transient Windows locks (antivirus/indexer). */
function renameWithRetry(rename: (from: string, to: string) => void, from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= RENAME_ATTEMPTS || !code || !TRANSIENT.has(code)) throw err;
      sleepSync(RENAME_DELAY_MS);
    }
  }
}

export interface OpenDbOptions {
  /** Test seam: replaces fs.renameSync. */
  rename?: (from: string, to: string) => void;
}

export async function openDb(filePath: string, opts: OpenDbOptions = {}): Promise<Db> {
  const SQL = await initSqlJs();
  const db: Database = existsSync(filePath) ? new SQL.Database(readFileSync(filePath)) : new SQL.Database();
  db.run(SCHEMA);

  const persist = (): void => {
    const tmp = filePath + '.tmp';
    writeFileSync(tmp, db.export());
    renameWithRetry(opts.rename ?? renameSync, tmp, filePath);
  };
  const run = (sql: string, params: Param[] = []): void => { db.run(sql, params); };
  const all = (sql: string, params: Param[] = []): Record<string, Param>[] => {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: Record<string, Param>[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, Param>);
      return rows;
    } finally {
      stmt.free();
    }
  };
  const getSetting = (k: string): string | null => {
    const r = all('SELECT v FROM settings WHERE k = ?', [k])[0];
    return r ? (r.v as string) : null;
  };
  const setSetting = (k: string, v: string): void =>
    run('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', [k, v]);
  const lastId = (): number => all('SELECT last_insert_rowid() AS id')[0].id as number;

  persist();

  return {
    getSettings() {
      const raw = getSetting('settings');
      return merge(DEFAULT_SETTINGS, raw ? JSON.parse(raw) : undefined);
    },
    saveSettings(s) {
      setSetting('settings', JSON.stringify(s));
      persist();
    },
    getSecret() {
      let s = getSetting('secret');
      if (!s) {
        s = randomBytes(16).toString('hex');
        setSetting('secret', s);
        persist();
      }
      return s;
    },
    createSession(info) {
      run('INSERT INTO sessions (info_json, heartbeat_at) VALUES (?, ?)', [JSON.stringify(info), info.startedAt]);
      const id = lastId();
      persist();
      return id;
    },
    saveSnapshot(id, snap, now) {
      run('UPDATE sessions SET snapshot_json = ?, heartbeat_at = ? WHERE id = ?', [JSON.stringify(snap), now, id]);
      persist();
    },
    activeSession(now) {
      const r = all('SELECT id, info_json, snapshot_json, heartbeat_at FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1')[0];
      if (!r) return null;
      const heartbeatAt = r.heartbeat_at as number;
      const snapshot = (r.snapshot_json
        ? JSON.parse(r.snapshot_json as string)
        : { session: JSON.parse(r.info_json as string), intervals: [], blocksCompleted: 0 }) as EngineState;
      return { id: r.id as number, snapshot, heartbeatAt, stale: now - heartbeatAt > STALE_MS };
    },
    finishSession(id, snap, endedAt) {
      run('UPDATE sessions SET ended_at = ?, blocks_completed = ?, snapshot_json = ? WHERE id = ?', [endedAt, snap.blocksCompleted, JSON.stringify(snap), id]);
      run('DELETE FROM intervals WHERE session_id = ?', [id]);
      for (const [s, e] of snap.intervals) run('INSERT INTO intervals (session_id, start, "end") VALUES (?, ?, ?)', [id, s, e]);
      persist();
    },
    addEvent(id, e) {
      run('INSERT INTO events (session_id, at, kind, target, detail) VALUES (?, ?, ?, ?, ?)', [id, e.at, e.kind, e.target, e.detail]);
      persist();
    },
    saveReflection(id, r) {
      run('INSERT INTO reflections (session_id, at, goal, tags_json, note) VALUES (?, ?, ?, ?, ?)', [id, r.at, r.goal, JSON.stringify(r.tags), r.note]);
      persist();
    },
    sessions(sinceMs) {
      return all('SELECT id, info_json, ended_at, blocks_completed FROM sessions WHERE ended_at IS NOT NULL AND ended_at >= ? ORDER BY ended_at ASC, id ASC', [sinceMs]).map((r) => {
        const id = r.id as number;
        return {
          id,
          info: JSON.parse(r.info_json as string) as SessionInfo,
          endedAt: r.ended_at as number,
          intervals: all('SELECT start, "end" AS e FROM intervals WHERE session_id = ? ORDER BY start', [id]).map((i) => [i.start, i.e] as [number, number]),
          blocksCompleted: r.blocks_completed as number,
          events: all('SELECT at, kind, target, detail FROM events WHERE session_id = ? ORDER BY at, rowid', [id]).map((e) => ({ at: e.at, kind: e.kind, target: e.target, detail: e.detail }) as BuddyEvent),
        };
      });
    },
    reflections(sinceMs) {
      return all('SELECT at, tags_json FROM reflections WHERE at >= ? ORDER BY at', [sinceMs]).map((r) => ({ at: r.at as number, tags: JSON.parse(r.tags_json as string) as string[] }));
    },
    intervalsSince(sinceMs) {
      return all('SELECT i.start AS s, i."end" AS e FROM intervals i JOIN sessions x ON x.id = i.session_id WHERE x.ended_at IS NOT NULL AND i."end" >= ? ORDER BY i.start', [sinceMs]).map((r) => [r.s, r.e] as [number, number]);
    },
  };
}
