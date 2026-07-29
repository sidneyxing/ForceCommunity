'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const INVITE_SECONDS = 30;
const FALLBACK_CATEGORIES = [
  { key: 'global', label: 'Global', description: 'English, geography, maps, flags, and nations.' },
  { key: 'tech', label: 'Technology', description: 'Logic, math, and technology.' },
  { key: 'media', label: 'Media', description: 'Editing, media terms, and wide visual thinking.' },
  { key: 'kitchen_cafe', label: 'Kitchen & Cafe', description: 'Food, ingredients, cooking, cafe, and practical business.' },
  { key: 'mentoring', label: 'Mentoring', description: 'Teaching heart, communication, and public speaking.' },
  { key: 'orchestral', label: 'Orchestral', description: 'Music, tone, instruments, and listening skill.' },
];

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
    credentials: 'same-origin',
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const raw = await response.text().catch(() => '');
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(payload.error || payload.message || raw || `Request failed (${response.status})`);
  }
  return payload;
}

function secondsLeft(request) {
  if (!request) return 0;
  if (Number.isFinite(Number(request.expires_in_ms))) {
    const elapsed = Date.now() - Number(request.received_at_ms || Date.now());
    return Math.max(0, Math.ceil((Number(request.expires_in_ms) - elapsed) / 1000));
  }
  if (!request.expires_at) return 0;
  return Math.max(0, Math.ceil((new Date(request.expires_at).getTime() - Date.now()) / 1000));
}

function dispatchDuel(duel) {
  if (!duel?.id || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('force:duel-ready', { detail: duel }));
}

function isDuelPageActive() {
  if (typeof document === 'undefined') return false;
  return Boolean(document.querySelector('.page[data-view="duel"].is-active'));
}

function findPortalTargets() {
  if (typeof document === 'undefined') return { panel: null, idle: null, body: null };
  const duelPage = document.querySelector('.page[data-view="duel"]');
  return {
    panel: duelPage?.querySelector('.duel-panel') || null,
    idle: duelPage?.querySelector('.duel-idle') || null,
    body: document.body || null,
  };
}

export default function ForceDuelEnhancer() {
  const [mounted, setMounted] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [targets, setTargets] = useState({ panel: null, idle: null, body: null });
  const [categories, setCategories] = useState(FALLBACK_CATEGORIES);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [membersOpen, setMembersOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [members, setMembers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [matchFound, setMatchFound] = useState(false);
  const [tick, setTick] = useState(0);
  const handledAcceptedRef = useRef(new Set());
  const messageTimerRef = useRef(null);
  const matchStatusBusyRef = useRef(false);
  const pendingQuickDuelRef = useRef(null);
  const quickDuelTimerRef = useRef(null);

  const showMessage = useCallback((text) => {
    setMessage(text || '');
    if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
    if (text) messageTimerRef.current = window.setTimeout(() => setMessage(''), 3600);
  }, []);

  useEffect(() => {
    setMounted(true);
    const refreshTargets = () => setTargets(findPortalTargets());
    refreshTargets();
    const observer = new MutationObserver(refreshTargets);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    const timer = window.setInterval(refreshTargets, 700);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      if (quickDuelTimerRef.current) window.clearTimeout(quickDuelTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!mounted) return undefined;

    let cancelled = false;

    const checkSession = async () => {
      try {
        await api('/api/me');
        if (!cancelled) setAuthenticated(true);
      } catch {
        if (!cancelled) setAuthenticated(false);
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    };

    const handleLogin = () => {
      setAuthenticated(true);
      setAuthChecked(true);
    };

    const handleLogout = () => {
      setAuthenticated(false);
      setAuthChecked(true);
      setMembersOpen(false);
      setMembers([]);
      setRequests([]);
      setOutgoing([]);
      setWaiting(false);
      setMatchFound(false);
      setBusy('');
      setMessage('');
      handledAcceptedRef.current.clear();
      pendingQuickDuelRef.current = null;
      if (quickDuelTimerRef.current) {
        window.clearTimeout(quickDuelTimerRef.current);
        quickDuelTimerRef.current = null;
      }
    };

    checkSession();
    window.addEventListener('force:session-login', handleLogin);
    window.addEventListener('force:session-logout', handleLogout);

    return () => {
      cancelled = true;
      window.removeEventListener('force:session-login', handleLogin);
      window.removeEventListener('force:session-logout', handleLogout);
    };
  }, [mounted]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((current) => current + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!mounted || !authChecked || !authenticated) return undefined;
    let cancelled = false;
    api('/api/duel/categories')
      .then((payload) => {
        if (cancelled) return;
        const rows = Array.isArray(payload.categories) && payload.categories.length ? payload.categories : FALLBACK_CATEGORIES;
        setCategories(rows.filter((category) => category.key !== 'force_core'));
        if (selectedCategory && !rows.some((category) => category.key === selectedCategory)) setSelectedCategory('');
      })
      .catch(() => setCategories(FALLBACK_CATEGORIES));
    return () => { cancelled = true; };
  }, [authenticated, authChecked, mounted, selectedCategory]);

  const loadRequests = useCallback(async () => {
    if (!authenticated) return;
    try {
      const data = await api('/api/duel-requests');
      const receivedAt = Date.now();
      const incoming = (data.requests || []).map((request) => ({ ...request, received_at_ms: receivedAt }));
      const outgoingRows = (data.outgoing || []).map((request) => ({ ...request, received_at_ms: receivedAt }));
      setRequests(incoming.filter((request) => request.status === 'pending' && secondsLeft(request) > 0));
      setOutgoing(outgoingRows);

      for (const request of outgoingRows) {
        if (request.status === 'accepted' && request.duel_id && !handledAcceptedRef.current.has(request.id)) {
          handledAcceptedRef.current.add(request.id);
          const payload = await api(`/api/duel/${request.duel_id}`);
          if (payload.duel?.id) dispatchDuel(payload.duel);
        }
        if (['declined', 'cancelled'].includes(request.status) && !handledAcceptedRef.current.has(`done:${request.id}`)) {
          handledAcceptedRef.current.add(`done:${request.id}`);
          if (request.status === 'declined') showMessage(`${request.target_username || 'Member'} menolak invitation. Kamu bisa invite orang lain.`);
        }
      }
    } catch {
      // Keep this watcher silent when the user is not logged in or the network is unstable.
    }
  }, [authenticated, showMessage]);

  useEffect(() => {
    if (!mounted || !authChecked || !authenticated) return undefined;
    loadRequests();
    const timer = window.setInterval(loadRequests, 1000);
    return () => window.clearInterval(timer);
  }, [authenticated, authChecked, loadRequests, mounted]);

  const loadMembers = useCallback(async (silent = false) => {
    if (!membersOpen || !authenticated) return;
    if (!silent) setBusy((current) => current || 'members');
    try {
      const data = await api(`/api/members?q=${encodeURIComponent(memberSearch)}&tab=all`);
      setMembers(data.members || []);
    } catch (error) {
      showMessage(error.message || 'Member gagal dimuat.');
    } finally {
      if (!silent) setBusy((current) => current === 'members' ? '' : current);
    }
  }, [authenticated, memberSearch, membersOpen, showMessage]);

  useEffect(() => {
    if (!membersOpen) return undefined;
    const timer = window.setTimeout(loadMembers, 230);
    return () => window.clearTimeout(timer);
  }, [loadMembers, membersOpen]);

  useEffect(() => {
    if (!membersOpen) return undefined;
    const timer = window.setInterval(() => loadMembers(true), 5000);
    return () => window.clearInterval(timer);
  }, [loadMembers, membersOpen]);

  const selectedCategoryLabel = useMemo(() => {
    return selectedCategory ? categories.find((category) => category.key === selectedCategory)?.label || 'Kategori' : 'Random';
  }, [categories, selectedCategory]);

  const quickMatch = async () => {
    if (!authenticated || busy || waiting) return;
    setBusy('quick');
    setMatchFound(false);
    showMessage('');
    try {
      const data = await api('/api/duel/start', {
        method: 'POST',
        body: { category_key: selectedCategory || null },
      });
      if (data.duel?.id) {
        // The player who presses Quick Match second receives the duel directly.
        // Give them the same clear matched/loading state as the waiting player
        // before both clients transition into the arena.
        pendingQuickDuelRef.current = data.duel;
        setWaiting(true);
        setMatchFound(true);
        showMessage('Lawan ditemukan. Menyiapkan arena...');
        if (quickDuelTimerRef.current) window.clearTimeout(quickDuelTimerRef.current);
        quickDuelTimerRef.current = window.setTimeout(() => {
          const pendingDuel = pendingQuickDuelRef.current;
          pendingQuickDuelRef.current = null;
          quickDuelTimerRef.current = null;
          setWaiting(false);
          if (pendingDuel?.id) dispatchDuel(pendingDuel);
        }, 900);
        return;
      }
      setWaiting(true);
      showMessage(data.message || (selectedCategory ? `Mencari lawan kategori ${selectedCategoryLabel}.` : 'Mencari lawan random.'));
    } catch (error) {
      showMessage(error.message || 'Quick match gagal dimulai.');
    } finally {
      setBusy('');
    }
  };

  useEffect(() => {
    if (!waiting || !authenticated) return undefined;
    const timer = window.setInterval(async () => {
      if (pendingQuickDuelRef.current) return;
      if (matchStatusBusyRef.current) return;
      matchStatusBusyRef.current = true;
      try {
        const data = await api('/api/duel/matchmaking/status');
        if (data.duel?.id) {
          setWaiting(false);
          setMatchFound(true);
          showMessage('Lawan ditemukan. Menyiapkan arena...');
          dispatchDuel(data.duel);
        } else if (data.matching) {
          setMatchFound(true);
        } else if (data.cancelled) {
          setWaiting(false);
          setMatchFound(false);
          showMessage(data.message || 'Pencarian lawan telah dibatalkan.');
        }
      } catch (error) {
        // A temporary network failure must not cancel matchmaking. The next
        // tick retries automatically while the loading state stays visible.
        showMessage('Koneksi terputus sebentar. Mencoba menyambung kembali...');
      } finally {
        matchStatusBusyRef.current = false;
      }
    }, 300);
    return () => window.clearInterval(timer);
  }, [authenticated, showMessage, waiting]);

  const cancelQuickMatch = async () => {
    if (!authenticated) return;
    setBusy('cancel');
    try {
      const data = await api('/api/duel/matchmaking/cancel', { method: 'POST' });
      if (data.alreadyMatched) {
        setMatchFound(true);
        showMessage('Lawan ditemukan. Menyiapkan arena...');
        const status = await api('/api/duel/matchmaking/status');
        if (status.duel?.id) {
          setWaiting(false);
          dispatchDuel(status.duel);
        }
        return;
      }
      setWaiting(false);
      setMatchFound(false);
      showMessage('Pencarian lawan dibatalkan.');
    } catch (error) {
      showMessage(error.message || 'Pembatalan gagal. Pencarian masih dilanjutkan.');
    } finally {
      setBusy('');
    }
  };

  const inviteMember = async (member) => {
    if (!authenticated || !member?.id || busy) return;
    setBusy(`invite:${member.id}`);
    try {
      const data = await api(`/api/members/${member.id}/invite`, {
        method: 'POST',
        body: { category_key: selectedCategory || null },
      });
      showMessage(data.alreadyPending ? 'Invitation masih pending.' : `Invitation terkirim ke @${member.username}. Menunggu 30 detik.`);
      await loadRequests();
    } catch (error) {
      showMessage(error.message || 'Invite duel gagal.');
    } finally {
      setBusy('');
    }
  };

  const respondInvite = async (request, action) => {
    if (!authenticated || !request?.id || busy) return;
    setBusy(`${action}:${request.id}`);
    try {
      const data = await api(`/api/duel-requests/${request.id}/respond`, {
        method: 'POST',
        body: { action },
      });
      if (action === 'accept' && data.duel?.id) {
        dispatchDuel(data.duel);
      } else {
        setRequests((current) => current.filter((row) => row.id !== request.id));
        showMessage('Invitation ditolak. Temanmu bisa langsung invite orang lain.');
      }
      await loadRequests();
    } catch (error) {
      showMessage(error.message || 'Respon invitation gagal.');
    } finally {
      setBusy('');
    }
  };

  const visibleMembers = useMemo(() => {
    return [...members]
      .filter((member) => member.id && member.online)
      .sort((a, b) => Number(Boolean(b.is_favourite)) - Number(Boolean(a.is_favourite)) || String(a.username || '').localeCompare(String(b.username || '')))
      .slice(0, 60);
  }, [members]);

  const invitation = requests.find((request) => secondsLeft(request) > 0);
  const canRenderControls = mounted && authChecked && authenticated && targets.idle && isDuelPageActive();
  const canRenderInviteBar = mounted && authChecked && authenticated && targets.body && invitation;

  const controls = canRenderControls ? createPortal(
    <section className="force-duel-control-panel" aria-label="Duel setup">
      <div className="force-duel-category-card">
        <h2>Pilih kategori soal</h2>
        <div className="force-duel-category-grid" role="listbox" aria-label="Pilih kategori duel">
          {categories.map((category) => (
            <button
              key={category.key}
              type="button"
              className={`force-duel-category-option${selectedCategory === category.key ? ' is-selected' : ''}`}
              aria-pressed={selectedCategory === category.key}
              onClick={() => setSelectedCategory((current) => current === category.key ? '' : category.key)}
            >
              <strong>{category.label}</strong>
            </button>
          ))}
        </div>
      </div>

      <div className="force-duel-action-card">
        <div className="force-duel-actions">
          <button className={`btn primary force-control-button${busy === 'quick' ? ' is-loading' : ''}`} type="button" onClick={quickMatch} disabled={Boolean(busy) || waiting}>
            {busy === 'quick' ? 'Mencari...' : 'Quick Match Random'}
          </button>
          <button className="btn secondary force-control-button force-invite-online-button" type="button" onClick={() => setMembersOpen((current) => !current)} disabled={Boolean(busy) && busy !== 'members'}>
            Invite Online Members
          </button>
        </div>
        {waiting ? (
          <div className="force-matchmaking-box">
            <div className="force-matchmaking-status"><div className="duel-loading-orb small" aria-hidden="true" /><span><strong>{matchFound ? 'Lawan ketemu, mohon tunggu sebentar' : selectedCategory ? `Mencari lawan kategori ${selectedCategoryLabel}` : 'Mencari lawan random'}</strong><small>{matchFound ? 'Arena duel sedang disiapkan untuk kedua pemain.' : selectedCategory ? 'User yang memilih kategori sama akan otomatis ketemu.' : 'Sistem akan mencarikan lawan dengan mode random.'}</small></span></div>
            <button className={`btn force-cancel-match${busy === 'cancel' ? ' is-loading' : ''}`} type="button" onClick={cancelQuickMatch} disabled={busy === 'cancel' || matchFound}>{busy === 'cancel' ? 'Membatalkan...' : matchFound ? 'Match ditemukan' : 'Batalkan pencarian'}</button>
          </div>
        ) : null}
        {message ? <p className="force-duel-message">{message}</p> : null}

        {membersOpen ? (
          <div className="force-invite-picker">
            <div className="force-invite-picker-head">
              <strong>Invite Online Members</strong>
              <small>Member online · favorit tampil paling atas · {selectedCategoryLabel}</small>
            </div>
            <input value={memberSearch} onChange={(event) => setMemberSearch(event.target.value.replace(/[^\p{L}\p{N}_ .@-]/gu, '').slice(0, 40))} placeholder="Cari member online / ID" />
            <div className="force-invite-member-list">
              {busy === 'members' ? <p className="muted">Memuat member...</p> : visibleMembers.length ? visibleMembers.map((member) => (
                <article className="force-invite-member" key={member.id}>
                  <span>
                    <strong>@{member.username}</strong>
                    <small>{member.is_favourite ? 'Online · Favourite' : 'Online'}</small>
                  </span>
                  <button className="btn secondary force-control-button" type="button" onClick={() => inviteMember(member)} disabled={Boolean(busy)}>
                    {busy === `invite:${member.id}` ? 'Mengirim...' : 'Invite'}
                  </button>
                </article>
              )) : <p className="muted">Belum ada member online yang bisa di-invite saat ini.</p>}
            </div>
          </div>
        ) : null}
      </div>
    </section>,
    targets.idle,
  ) : null;

  const inviteBar = canRenderInviteBar ? createPortal(
    <div className="force-invite-toast" role="dialog" aria-live="polite">
      <div className="force-invite-toast-main">
        <span>
          <strong>@{invitation.requester_username || 'member'} mengajak duel</strong>
          <small>{invitation.category_label || 'Random'} · tersisa {secondsLeft(invitation)} detik</small>
        </span>
        <div className="force-invite-toast-actions">
          <button className="btn primary force-control-button" type="button" onClick={() => respondInvite(invitation, 'accept')} disabled={Boolean(busy)}>Terima</button>
          <button className="btn secondary force-control-button" type="button" onClick={() => respondInvite(invitation, 'decline')} disabled={Boolean(busy)}>Tolak</button>
        </div>
      </div>
      <div className="force-invite-countdown-track">
        <span style={{ width: `${Math.max(0, Math.min(100, (secondsLeft(invitation) / INVITE_SECONDS) * 100))}%` }} />
      </div>
    </div>,
    targets.body,
  ) : null;

  return <>{controls}{inviteBar}</>;
}
