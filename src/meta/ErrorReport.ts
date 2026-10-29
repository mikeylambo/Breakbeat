/**
 * ErrorReport — the opt-in crash beacon (Settings > Display > Send error reports, off by default).
 * Sends uncaught errors and unhandled rejections to the same Supabase project as the Daily board,
 * into an insert-only table (nobody can read it back through the API). No identity is sent: no player id, no
 * name, no save. Messages are scrubbed of URLs (origin, query and hash dropped) and of anything
 * that looks like an e-mail address. Five reports a session at most, each distinct error once.
 */

import { getLang } from '../i18n/core.js';
import { BOARD_HOST, BOARD_KEY } from './Leaderboard.js';

/** Kept equal to package.json's version by the NETWORK gate (a JSON import would not load headless). */
export const VERSION = '0.6.0';
const MAX_PER_SESSION = 5;
const seen = new Set<string>();
let sent = 0;

export interface ErrorReport {
  version: string;
  kind: 'error' | 'rejection';
  message: string;
  source: string | null;
  line: number | null;
  col: number | null;
  stack: string | null;
  screen: string | null;
  lang: string;
  ua: string;
}

/** Drops origins, queries, hashes and e-mail-like text; caps the length. */
export function scrub(text: string, max: number): string {
  return text
    .replace(/[a-z][\w+.-]*:\/\/[^/\s)]+/gi, '')
    .replace(/[?#][^\s):]*/g, '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .slice(0, max);
}

/** A coarse device class, not a fingerprint: browser family and platform only. */
export function deviceClass(ua: string): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Other';
  return `${browser} · ${os}`;
}

export function buildReport(kind: ErrorReport['kind'], err: unknown, at: { source?: string; line?: number; col?: number } = {}, screen: string | null = null): ErrorReport {
  const e = err instanceof Error ? err : null;
  const message = e ? `${e.name}: ${e.message}` : typeof err === 'string' ? err : String(err);
  return {
    version: VERSION,
    kind,
    message: scrub(message, 300) || '(no message)',
    source: at.source ? scrub(at.source, 200) : null,
    line: at.line ?? null,
    col: at.col ?? null,
    stack: e?.stack ? scrub(e.stack, 2000) : null,
    screen: screen ? screen.slice(0, 24) : null,
    lang: getLang(),
    ua: deviceClass(navigator.userAgent)
  };
}

function send(r: ErrorReport): void {
  const id = `${r.kind}|${r.message}|${r.line}`;
  if (sent >= MAX_PER_SESSION || seen.has(id)) return;
  seen.add(id);
  sent++;
  try {
    void fetch(`${BOARD_HOST}/rest/v1/breakbeat_errors`, {
      method: 'POST',
      keepalive: true,
      headers: { apikey: BOARD_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(r)
    }).catch(() => undefined);
  } catch {
    // a beacon never throws
  }
}

/** Listens for uncaught errors; reports only while `enabled()` is true. */
export function installErrorReporting(enabled: () => boolean, screen: () => string | null): void {
  window.addEventListener('error', e => {
    if (!enabled()) return;
    send(buildReport('error', e.error ?? e.message, { source: e.filename, line: e.lineno, col: e.colno }, screen()));
  });
  window.addEventListener('unhandledrejection', e => {
    if (enabled()) send(buildReport('rejection', e.reason, {}, screen()));
  });
}
