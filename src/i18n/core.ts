/**
 * i18n core — every player-facing string goes through t(). English lives in en.ts (the source of truth
 * and the fallback); other languages are content/i18n/<lang>.json, bundled, so no network.
 * Placeholders are {name}; plurals use a `_one` / `_other` key pair via tn(). The language comes
 * from the setting, else the device; changing it reloads the page so every screen re-renders.
 * Japanese text falls back to the system's CJK font (the bundled fonts are Latin-only).
 * This module holds no tables, so headless code (meta/, the gates) can import it; i18n.ts registers them.
 */

import { EN, type Key } from './en.js';

export type Lang = 'en' | 'es' | 'pt-BR' | 'de' | 'ja';
export const LANGS: readonly (readonly [Lang, string])[] = [
  ['en', 'English'],
  ['es', 'Español'],
  ['pt-BR', 'Português (BR)'],
  ['de', 'Deutsch'],
  ['ja', '日本語']
];
const TABLES: Record<Lang, Partial<Record<string, string>>> = { en: {}, es: {}, 'pt-BR': {}, de: {}, ja: {} };

/** Installs a language's strings (i18n.ts does this for every bundled language). */
export function registerTable(l: Lang, table: Partial<Record<string, string>>): void {
  TABLES[l] = table;
}

let lang: Lang = 'en';

/** Best match for a BCP 47 tag (navigator.language), else English. */
export function pickLang(tag: string | undefined): Lang {
  const t = (tag ?? '').toLowerCase();
  if (t.startsWith('pt')) return 'pt-BR';
  for (const [l] of LANGS) if (t.startsWith(l.toLowerCase())) return l;
  return 'en';
}

export function setLang(l: Lang): void {
  lang = l;
  try {
    document.documentElement.lang = l;
  } catch {
    // no DOM (tests)
  }
}

export function getLang(): Lang {
  return lang;
}

function fill(s: string, vars?: Record<string, string | number>): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** The string for `key` in the current language (English when missing). */
export function t(key: Key, vars?: Record<string, string | number>): string {
  return fill(TABLES[lang][key] ?? EN[key], vars);
}

/** A key built at runtime (e.g. per achievement), with an English fallback. */
export function tx(key: string, fallback: string, vars?: Record<string, string | number>): string {
  return fill(TABLES[lang][key] ?? (EN as Record<string, string>)[key] ?? fallback, vars);
}

/** Plural: `${key}_one` for 1, else `${key}_other`. */
export function tn(key: string, n: number, vars?: Record<string, string | number>): string {
  const k = `${key}_${n === 1 ? 'one' : 'other'}`;
  return tx(k, k, { n, ...vars });
}
