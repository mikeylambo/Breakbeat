/**
 * breakbeat-submit — Supabase Edge Function. Takes a Daily replay, re-simulates it with the game's
 * own engine (bundled from src/), and stores the server's score; the client's score is never
 * read. Returns the player's best, rank and the day's total. Public endpoint: the re-simulation
 * is the authentication, so JWT checks are off. Build: node tools/build-server.mjs
 */

import rules from '../build/server/track-rules.json';
import { GemRules } from '../src/content/gems/GemRules.js';
import { verifyDaily, type TrackRule } from '../src/meta/DailyVerify.js';
import { cleanName } from '../src/meta/text.js';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

/** Movement rules in Daily order, generated from content/tracks.json by the build. */
const TRACKS: TrackRule[] = rules as TrackRule[];
const API = `${Deno.env.get('SUPABASE_URL')}/rest/v1/breakbeat_daily`;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info'
};
const MAX_BODY = 400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const db = (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${API}${path}`, { ...init, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });

/** Today (UTC), or yesterday during the first 15 minutes of a day so a late run still counts. */
function dayOk(day: string): boolean {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);
  return day === today || (day === yesterday && now % 86400000 < 15 * 60000);
}

/** Display names: cleaned, 16 characters, no links. */
function displayName(raw: unknown): string {
  const n = cleanName(typeof raw === 'string' ? raw : '', 'Player').slice(0, 16);
  return /https?:|www\.|\.(com|net|org|io|gg|ly|xyz)\b/i.test(n) ? 'Player' : n;
}

async function count(day: string, above?: number): Promise<number> {
  const q = `?select=id&day=eq.${day}${above === undefined ? '' : `&score=gt.${above}`}`;
  const r = await db(q, { headers: { Prefer: 'count=exact', Range: '0-0' } });
  return Number(r.headers.get('content-range')?.split('/')[1] ?? 0);
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST a replay' }, 405);
  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: 'too large' }, 413);
  let body: { day?: string; player?: string; name?: string; replay?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const day = String(body.day ?? '');
  const player = String(body.player ?? '');
  if (!dayOk(day)) return json({ error: 'not today' }, 422);
  if (!UUID.test(player)) return json({ error: 'player' }, 422);
  const v = verifyDaily(body.replay as Parameters<typeof verifyDaily>[0], day, TRACKS, new GemRules('brick'));
  if (!v.ok) return json({ error: v.reason }, 422);

  const prev = await db(`?select=score&day=eq.${day}&player=eq.${player}`).then(r => (r.ok ? r.json() : []));
  const had = (prev as { score: number }[])[0]?.score ?? -1;
  if (v.score > had) {
    const w = await db('?on_conflict=day,player', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ day, player, name: displayName(body.name), score: v.score, bars: v.bars, replay: body.replay })
    });
    if (!w.ok) return json({ error: 'store failed' }, 500);
  }
  const best = Math.max(v.score, had);
  const [above, total] = await Promise.all([count(day, best), count(day)]);
  return json({ score: v.score, best, rank: above + 1, total });
});
