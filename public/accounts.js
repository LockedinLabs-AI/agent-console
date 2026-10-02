/* Quota is a separate local resource, not a projection of token totals. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const names = { codex: 'Codex', 'claude-code': 'Claude Code' };
  const states = { ready: 'Ready', stale: 'Stale reading', unavailable: 'Connect source', incomplete: 'Incomplete', 'awaiting-reset': 'Confirm reset', exhausted: 'At limit', paused: 'Paused' };
  let data = null, loading = false, sessionClosed = false;
  const relative = (at, now) => {
    const m = Math.max(0, Math.ceil((at - now) / 60_000));
    return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d ${Math.floor(m % 1440 / 60)}h`;
  };
  async function api(url, body) {
    const res = await fetch(url, { headers: { 'x-agent-console': '1', ...(body ? { 'content-type': 'application/json' } : {}) },
      cache: 'no-store', signal: AbortSignal.timeout(20_000),
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    const value = await res.json();
    if (sessionClosed) throw new Error('Signed out.');
    if (!res.ok) {
      if (res.status === 401) clear();
      throw new Error(value.reason || 'Account capacity could not be read.');
    }
    return value;
  }
  function unavailable(message) {
    data = null;
    $('accountOverview').replaceChildren();
    $('accountProfiles').innerHTML = '<div class="capacity-empty">A current capacity reading is unavailable. Profiles and recommendations will return after a successful refresh.</div>';
    $('accountStatus').textContent = message;
  }
  async function load() {
    if (sessionClosed || loading || $('view-accounts').hidden || document.hidden) return;
    loading = true;
    try { data = await api('/api/accounts'); paint(); }
    catch (e) { if (!sessionClosed) unavailable(e.message); }
    finally { loading = false; }
  }
  function paint() {
    if (sessionClosed || !data) return;
    const presenting = document.body.hasAttribute('data-present');
    const label = p => presenting ? `Profile ${data.profiles.indexOf(p) + 1}` : p.label;
    const list = data.profiles, ready = list.filter(p => p.state === 'ready').length;
    const next = list.filter(p => p.nextResetAt && ['ready', 'exhausted'].includes(p.state)).sort((a, b) => a.nextResetAt - b.nextResetAt)[0];
    $('accountAdd').disabled = data.demo;
    $('accountStatus').textContent = data.demo ? 'DEMO · Synthetic profiles and capacity. No account is connected.'
      : 'Native client readings · percentages are remaining allowance · accounts are never added together';
    $('accountOverview').innerHTML = `<section class="capacity-brief"><h2>${data.demo ? 'DEMO · ' : ''}Capacity at a glance</h2>
      <div class="capacity-numbers"><div><strong>${ready}<span> / ${list.length}</span></strong><span>profiles ready</span></div>
      <div><strong>${next ? relative(next.nextResetAt, data.now) : '—'}</strong><span>next reported reset</span></div>
      <div><strong>${list.length - ready}</strong><span>need attention</span></div></div>
      <p>Keep each job on one profile. Switching mid-session can lose cache reuse and context.</p></section>
      <section class="capacity-next"><h2>Next session · suggested profiles</h2>${Object.entries(names).map(([provider, name]) => {
        const pick = data.recommendations.find(r => r.provider === provider), p = pick && list.find(p => p.id === pick.profileId);
        return `<div class="capacity-next-row"><span>${name}</span><b>${p ? esc(label(p)) : 'No ready profile'}</b><span>${p ? `Long window resets in ${relative(p.priorityResetAt, data.now)}` : 'Connect or refresh'}</span></div>`;
      }).join('')}<p>Earliest long-window reset, with capacity in every reported limit. Start a new session using the profile’s command.</p></section>`;
    const filtered = list.filter(p => $('accountFilter').value === 'all' || p.provider === $('accountFilter').value);
    $('accountProfiles').innerHTML = filtered.length ? filtered.map(p => `<article class="capacity-card">
      <header><div><span class="capacity-provider">${names[p.provider]}${data.demo ? ' · DEMO' : ''}</span><h3>${esc(label(p))}</h3></div><span class="capacity-state ${esc(p.state)}">${states[p.state]}</span></header>
      ${p.windows.length ? p.windows.map(w => `<div class="capacity-window ${w.remainingPercent === null ? 'unknown' : ''}">
        <div class="capacity-window-label"><span>${esc(w.label)}</span><b>${w.remainingPercent === null ? 'Unknown' : `${Math.round(w.remainingPercent)}% left`}</b></div>
        ${w.remainingPercent === null ? '' : `<progress max="100" value="${w.remainingPercent}" aria-label="${esc(w.label)} remaining allowance">${Math.round(w.remainingPercent)}%</progress>`}
        <small>${w.resetsAt ? w.resetsAt <= data.now ? 'Reset time passed · refresh to confirm' : `Resets in ${relative(w.resetsAt, data.now)} · ${esc(new Date(w.resetsAt).toLocaleString())}` : 'No complete quota reading'}</small></div>`).join('') : '<p class="capacity-note">Connect quota reporting to see the short and weekly allowances here.</p>'}
      <p class="capacity-note">${esc(p.reason)}</p><footer><small>${esc(p.source || 'No source connected')} · ${p.observedAt ? `received ${relative(data.now, p.observedAt)} ago` : 'not yet read'}</small>
        <button class="btn small" data-profile="${list.indexOf(p)}" data-action="setup" ${data.demo || presenting ? 'disabled' : ''}>Use / connect</button>
        ${p.provider === 'codex' ? `<button class="btn small" data-profile="${list.indexOf(p)}" data-action="refresh" ${data.demo ? 'disabled' : ''}>Refresh quota</button>` : ''}
        <button class="btn small" data-profile="${list.indexOf(p)}" data-action="enabled" ${data.demo ? 'disabled' : ''}>${p.enabled ? 'Pause selection' : 'Enable selection'}</button>
      </footer></article>`).join('') : `<div class="capacity-empty">${list.length ? 'No profiles for this provider.' : 'Connect your first native client profile. Quota readings will appear here after you connect its source. Your token history stays in the Console view.'}</div>`;
  }
  $('accountFilter').addEventListener('change', paint);
  $('accountAdd').addEventListener('click', () => { $('accountFormStatus').textContent = ''; $('accountDialog').showModal(); $('accountId').focus(); });
  $('accountClose').addEventListener('click', () => $('accountDialog').close());
  $('accountSetupClose').addEventListener('click', () => $('accountSetup').close());
  $('accountSetup').addEventListener('close', () => $('accountSetupBody').replaceChildren());
  $('accountForm').addEventListener('submit', async e => {
    e.preventDefault();
    const submit = $('accountForm').querySelector('[type=submit]'); submit.disabled = true;
    try {
      data = await api('/api/accounts', { id: $('accountId').value, label: $('accountLabel').value,
        provider: $('accountProvider').value, directory: $('accountHome').value });
      $('accountDialog').close(); $('accountForm').reset(); paint();
    } catch (error) { $('accountFormStatus').textContent = error.message; }
    finally { submit.disabled = false; }
  });
  $('accountProfiles').addEventListener('click', async e => {
    const button = e.target.closest('button[data-profile]'); if (!button || !data || sessionClosed) return;
    const id = data.profiles[Number(button.dataset.profile)]?.id, action = button.dataset.action;
    button.disabled = true;
    try {
      if (action === 'setup') {
        const s = await api('/api/accounts/setup?id=' + encodeURIComponent(id));
        if (document.body.hasAttribute('data-present')) return;
        $('accountSetupBody').innerHTML = `<p>Open a native session with this profile:</p><pre>${esc(s.launch)}</pre>
          <p>Or choose the next ready profile automatically when starting a new session:</p><pre>${esc(s.run)}</pre>
          ${s.capture ? `<p>In this profile’s Claude Code settings, add this status-line command. If you already use a custom status line, call this command from that script with the same JSON input; preserve its existing output.</p><pre>${esc(JSON.stringify({ statusLine: { type: 'command', command: s.capture } }, null, 2))}</pre><p>Requires Claude Code v2.1.251 or later and a supported subscription. It updates after native responses. It stores only quota fields.</p>` : '<p>Use Refresh quota to read the account’s limits through Codex. No model request is made.</p>'}`;
        $('accountSetup').showModal();
      } else {
        data = await api('/api/accounts/' + action, action === 'enabled'
          ? { id, enabled: !data.profiles.find(p => p.id === id).enabled } : { id });
        paint();
      }
    } catch (error) {
      if (!sessionClosed) {
        if (action === 'refresh') unavailable(error.message);
        else $('accountStatus').textContent = error.message;
      }
    }
    finally { button.disabled = false; }
  });
  window.addEventListener('agent-console-view', e => { if (e.detail === 'accounts') load(); });
  document.addEventListener('visibilitychange', load);
  // Sign-out removes all capacity from the DOM, including any open setup text.
  const clear = () => { sessionClosed = true; data = null; $('accountOverview').replaceChildren(); $('accountProfiles').replaceChildren(); $('accountSetup').close(); $('accountDialog').close(); $('accountForm').reset(); };
  $('signOutBtn').addEventListener('click', clear, { capture: true });
  new MutationObserver(() => { if (!$('signedOut').hidden) clear(); })
    .observe($('signedOut'), { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(() => { $('accountSetup').close(); $('accountDialog').close(); $('accountForm').reset(); paint(); })
    .observe(document.body, { attributes: true, attributeFilter: ['data-present'] });
  setInterval(load, 30_000);
  load();
})();
