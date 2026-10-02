/** Account capacity is not token accounting. Percentages describe independent
 * provider windows; they are never summed, converted to dollars, or inferred
 * from transcript totals. This module has no I/O and accepts metadata only. */
export const FRESH_MS = 10 * 60_000;
export const PROVIDERS = Object.freeze({ codex: 'Codex', 'claude-code': 'Claude Code' });
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const word = (v, fallback) => typeof v === 'string' && /^[\w .:/-]{1,70}$/u.test(v) ? v : fallback;
const labelWord = (v, fallback) => typeof v === 'string' && /^[\w .:/·-]{1,100}$/u.test(v) ? v : fallback;

function windowOf(id, label, used, reset, minutes, bucket) {
  // Keep malformed or incomplete windows visible, rather than silently
  // dropping a potentially binding limit from a recommendation.
  const valid = finite(used) && used >= 0 && used <= 100 && Number.isSafeInteger(reset) && reset > 0 && reset <= 8.64e12;
  return { id, label, bucket, usedPercent: valid ? used : null,
    remainingPercent: valid ? 100 - used : null,
    resetsAt: valid ? reset * 1000 : null,
    durationMins: finite(minutes) && minutes > 0 ? minutes : null };
}

export function claudeCapacity(input, now = Date.now()) {
  const limits = input?.rate_limits;
  const windows = [
    windowOf('five-hour', '5-hour allowance', limits?.five_hour?.used_percentage, limits?.five_hour?.resets_at, 300, 'claude'),
    windowOf('seven-day', '7-day allowance', limits?.seven_day?.used_percentage, limits?.seven_day?.resets_at, 10080, 'claude'),
  ];
  if (limits?.spend_limit) windows.push(windowOf('spend', 'Spend allowance', limits.spend_limit.used_percentage,
    limits.spend_limit.resets_at, null, 'claude'));
  return { source: 'Claude Code status line', observedAt: now, windows };
}

export function codexCapacity(input, now = Date.now()) {
  const mapped = input?.rateLimitsByLimitId;
  const buckets = mapped && typeof mapped === 'object' && !Array.isArray(mapped) && Object.keys(mapped).length
    ? Object.entries(mapped) : [['codex', input?.rateLimits]];
  const windows = [];
  for (const [key, bucket] of buckets.slice(0, 16)) {
    const id = word(key, 'unknown');
    const label = word(bucket?.limitName, id);
    let found = false;
    for (const slot of ['primary', 'secondary']) {
      const w = bucket?.[slot];
      if (!w) continue; // A provider may legitimately have only one window.
      found = true;
      const duration = w.windowDurationMins;
      const span = duration === 300 ? '5-hour' : duration === 10080 ? '7-day'
        : finite(duration) && duration > 0 ? `${duration}-minute` : slot;
      windows.push(windowOf(`${id}-${slot}`, `${label} · ${span}`, w.usedPercent, w.resetsAt, duration, id));
    }
    if (!found) windows.push(windowOf(`${id}-unknown`, `${label} · unavailable`, null, null, null, id));
  }
  // Oversized responses cannot be presented as complete capacity.
  if (buckets.length > 16) windows.push(windowOf('unread', 'Additional limits unavailable', null, null, null, 'unknown'));
  return { source: 'Codex app-server', observedAt: now, windows };
}

export function capacityView(profile, snapshot, now = Date.now()) {
  const age = snapshot ? now - snapshot.observedAt : Infinity;
  const windows = (snapshot?.windows || []).map(w => ({ ...w,
    state: w.remainingPercent === null ? 'unknown' : w.resetsAt <= now ? 'awaiting-reset'
      : w.remainingPercent <= 0 ? 'exhausted' : 'available',
  }));
  const stale = !finite(age) || age < -120_000 || age > FRESH_MS;
  let state = 'ready', reason = 'Fresh capacity reported by the native client.';
  if (!profile.enabled) { state = 'paused'; reason = 'Excluded from profile selection.'; }
  else if (snapshot?.error) { state = 'unavailable'; reason = snapshot.error; }
  else if (!snapshot || !windows.length) { state = 'unavailable'; reason = 'No quota reading yet. Connect the native client.'; }
  else if (stale) { state = 'stale'; reason = 'Refresh before selecting this profile; the reading is over 10 minutes old.'; }
  else if (windows.some(w => w.state === 'unknown')) { state = 'incomplete'; reason = 'A limit is missing or invalid. Selection is withheld.'; }
  else if (windows.some(w => w.state === 'awaiting-reset')) { state = 'awaiting-reset'; reason = 'A reset time has passed. A new provider reading must confirm capacity.'; }
  else if (windows.some(w => w.state === 'exhausted')) { state = 'exhausted'; reason = 'At least one reported allowance is exhausted.'; }
  const longest = [...windows].filter(w => w.durationMins).sort((a, b) => b.durationMins - a.durationMins)[0];
  const nextResetAt = Math.min(...windows.filter(w => w.resetsAt > now).map(w => w.resetsAt));
  return { id: profile.id, label: profile.label, provider: profile.provider, enabled: profile.enabled,
    source: snapshot?.source || null, observedAt: snapshot?.observedAt || null, state, reason, windows,
    nextResetAt: Number.isFinite(nextResetAt) ? nextResetAt : null,
    priorityResetAt: longest?.resetsAt || null };
}

/** Closed storage boundary: recompute remaining capacity, reject damaged
 * fields, and never retain arbitrary provider properties or error strings. */
export function storedCapacity(value) {
  const source = ['Codex app-server', 'Claude Code status line'].includes(value?.source) ? value.source : 'Unknown source';
  const observedAt = Number.isSafeInteger(value?.observedAt) && value.observedAt > 0 ? value.observedAt : null;
  const rows = Array.isArray(value?.windows) && value.windows.length <= 40 ? value.windows : [];
  const windows = rows.map((w, i) => windowOf(word(w?.id, `unknown-${i}`), labelWord(w?.label, 'Unknown allowance'),
    w?.usedPercent, Number.isSafeInteger(w?.resetsAt) ? w.resetsAt / 1000 : null, w?.durationMins, word(w?.bucket, 'unknown')));
  return { source, observedAt, windows, ...(value?.error ? { error: 'Native quota is unavailable. Check the client connection and refresh.' } : {}) };
}

/** Recommendations are per provider. A complete reading must cover every
 * returned bucket. Earliest long-window reset wins; a profile is never
 * selected based on an expired, missing, failed or exhausted reading. */
export function recommend(profiles, provider) {
  const eligible = profiles.filter(p => p.provider === provider && p.state === 'ready' && p.priorityResetAt);
  eligible.sort((a, b) => a.priorityResetAt - b.priorityResetAt || a.id.localeCompare(b.id));
  const chosen = eligible[0];
  return chosen ? { provider, profileId: chosen.id,
    reason: 'Earliest reset of the longest reported allowance among ready profiles. Keep the session on this profile.' } : null;
}

export function demoProfiles(now = Date.now()) {
  const spec = [
    ['personal', 'Personal', 'claude-code', 38, 72, 150, 720],
    ['work', 'Work', 'claude-code', 12, 31, 270, 4000],
    ['daily', 'Daily', 'codex', 49, 63, 180, 1440],
    ['lab', 'Lab', 'codex', 100, 80, 40, 3000],
    ['travel', 'Travel', 'codex', 28, 18, 100, 7000],
  ];
  return spec.map(([id, label, provider, short, long, first, second], i) => {
    const a = Math.floor((now + first * 60_000) / 1000), b = Math.floor((now + second * 60_000) / 1000);
    const snapshot = provider === 'codex'
      ? codexCapacity({ rateLimits: { primary: { usedPercent: short, resetsAt: a, windowDurationMins: 300 }, secondary: { usedPercent: long, resetsAt: b, windowDurationMins: 10080 } } }, now - (i === 4 ? FRESH_MS + 60000 : 45000))
      : claudeCapacity({ rate_limits: { five_hour: { used_percentage: short, resets_at: a }, seven_day: { used_percentage: long, resets_at: b } } }, now - 45000);
    return capacityView({ id, label, provider, enabled: true }, snapshot, now);
  });
}
