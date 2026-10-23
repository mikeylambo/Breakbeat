/**
 * A player-given name safe for every text sink: markup characters and controls are dropped, since
 * names reach HTML templates (title card, results, HUD, etude captions). Whitespace collapses,
 * 40 characters at most (callers may cut shorter).
 */
export function cleanName(name: string, fallback = 'My Beat'): string {
  return name.replace(/[<>&"'`\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) || fallback;
}
