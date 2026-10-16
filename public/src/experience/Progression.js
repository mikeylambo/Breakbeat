/** Versioned local-only player history. No server authority is implied. */
export const RANKS = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'RESONANT'];
export const DEFAULT_PROGRESS = { version: 2, unlocked: 1, best: {}, daily: {}, records: {}, replays: {}, completed: [], tutorialComplete: false, persona: 'blade', totalRuns: 0, completedChallenges: [], challengeBest: {} };
export function migrateProgress(raw) {
    if (!raw || typeof raw !== 'object')
        return structuredClone(DEFAULT_PROGRESS);
    const x = raw;
    const dict = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    const out = { ...structuredClone(DEFAULT_PROGRESS),
        unlocked: Math.max(1, Math.min(6, Math.floor(Number(x.unlocked) || 1))),
        best: dict(x.best) ? Object.fromEntries(Object.entries(x.best).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0)) : {},
        daily: dict(x.daily) ? Object.fromEntries(Object.entries(x.daily).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) : {},
        records: dict(x.records) ? x.records : {},
        replays: dict(x.replays) ? x.replays : {},
        completed: Array.isArray(x.completed) ? x.completed.filter(v => typeof v === 'string') : [],
        tutorialComplete: x.tutorialComplete === true,
        persona: ['blade', 'echo', 'prism'].includes(x.persona ?? '') ? x.persona : 'blade',
        totalRuns: Math.max(0, Math.floor(Number(x.totalRuns) || 0)),
        completedChallenges: Array.isArray(x.completedChallenges) ? x.completedChallenges.filter(v => typeof v === 'string') : [],
        challengeBest: dict(x.challengeBest) ? Object.fromEntries(Object.entries(x.challengeBest).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0)) : {} };
    // An old save kept its Odyssey unlocks but did not yet track completed movements.
    if (!out.completed.length && out.unlocked > 1)
        out.completed = Array.from({ length: out.unlocked - 1 }, (_, i) => String(i));
    return out;
}
export function rankFor(score) { return score >= 55000 ? 'RESONANT' : score >= 26000 ? 'PLATINUM' : score >= 12000 ? 'GOLD' : score >= 5000 ? 'SILVER' : 'BRONZE'; }
export function rankIndex(rank) { return RANKS.indexOf(rank); }
export function personaUnlock(progress, persona) {
    if (persona === 'blade')
        return true;
    const best = Math.max(0, ...Object.values(progress.best), ...Object.values(progress.records).map(r => Number(r.score) || 0));
    return best >= (persona === 'echo' ? 5000 : 12000);
}
export function normalizedScore(raw, bpmScale) {
    return Math.max(0, Math.round(raw * Math.max(.75, Math.min(1.25, bpmScale))));
}
export function recordResult(progress, key, record, replay) {
    progress.totalRuns++;
    const previous = progress.records[key];
    const previousBest = Math.max(previous?.score ?? 0, progress.best[key] ?? 0);
    const newRecord = (!previous && progress.best[key] === undefined) || record.score > previousBest;
    if (newRecord) {
        progress.records[key] = record;
        progress.best[key] = record.score;
        if (replay?.frames.length)
            progress.replays[key] = replay;
    }
    else
        progress.best[key] = Math.max(progress.best[key] || 0, record.score);
    return { newRecord, rank: rankFor(record.score) };
}
/** Challenges never modify primary scores or award boosts. Only optional Endless contracts qualify. */
export function completeChallenge(progress, id, score) {
    const first = !progress.completedChallenges.includes(id);
    if (first)
        progress.completedChallenges.push(id);
    const best = Math.max(progress.challengeBest[id] || 0, Math.max(0, Math.floor(score)));
    progress.challengeBest[id] = best;
    return { first, best };
}
