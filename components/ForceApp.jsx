'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ForceSchoolsPage, ForceShopsPage } from './ForceFeaturePages';

const DAILY_DUEL_LIMIT = 7;
const PAGE_CONFIG = {
  schools: ['FORCE Special Program', 'Go to Schools'],
  home: ['FORCE Arena', 'Home'],
  duel: ['Arena Duel', 'Duel'],
  members: ['Member List', 'Members of Arena'],
  leaderboard: ['Weekly Leaderboard', 'Leaderboard'],
  shops: ['FORCE Shops', 'Redeem with Force Points'],
  about: ['About FORCE', 'About'],
  settings: ['Settings', 'Account'],
};
const NAV_ITEMS = [
  { key: 'schools', label: 'Go to Schools', className: 'nav-school-featured' },
  { key: 'home', label: 'Home' },
  { key: 'duel', label: 'Duel' },
  { key: 'members', label: 'Members' },
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'shops', label: 'FORCE Shops', className: 'nav-shop-link' },
  { key: 'about', label: 'About Us' },
  { key: 'settings', label: 'Settings' },
];
const BOTTOM_NAV = [
  ['home', 'Beranda'],
  ['duel', 'Duel'],
  ['members', 'Member'],
  ['leaderboard', 'Rank'],
  ['settings', 'Atur'],
];

function schoolFeatureIsVisible(feature) {
  if (!feature?.available || !feature?.visibleUntil) return false;
  return new Date(feature.visibleUntil).getTime() > Date.now();
}

function schoolCountdownLabel(visibleUntil) {
  const remaining = Math.max(0, new Date(visibleUntil || 0).getTime() - Date.now());
  if (remaining <= 0) return '';
  const dayMs = 24 * 60 * 60 * 1000;
  if (remaining >= dayMs) {
    const days = Math.ceil(remaining / dayMs);
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  const totalSeconds = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
const SOUND_FILES = {
  button: '/sounds/button-click.mp3',
  duelStart: '/sounds/duel-start.mp3',
  matchBeep: '/sounds/beep.mp3',
  matchStart: '/sounds/ting.mp3',
  tick: '/sounds/tik.mp3',
  correct: '/sounds/correct.mp3',
  wrong: '/sounds/wrong.mp3',
  notif: '/sounds/notif.mp3',
  badgeNotif: '/sounds/badgenotif.mp3',
  duelNotif: '/sounds/duelnotif.mp3',
  win: '/sounds/win.mp3',
  lose: '/sounds/lose.mp3',
  background: '/sounds/idle.mp3',
  duelMusic: '/sounds/duel.mp3',
};
const SECRET_BADGE_NAMES = new Set([
  'flawless round',
  'speed strike',
  'clutch victor',
  'perfect brain',
  'top ten week',
  'bronze week',
  'silver week',
  'gold week',
  'c for christ',
  'peak of force',
]);

const SCHOOL_OPTIONS = [
  'SMAN 1 Manado',
  'SMAN 2 Manado',
  'SMAN 3 Manado',
  'SMAN 4 Manado',
  'SMAN 5 Manado',
  'SMAN 6 Manado',
  'SMAN 7 Manado',
  'SMAN 8 Manado',
  'SMAN 9 Binsus Manado',
  'SMAN 10 Manado',
  'SMKN 1 Manado',
  'SMKN 2 Manado',
  'SMKN 3 Manado',
  'SMKN 4 Manado',
  'SMKN 5 Manado',
  'SMKN 6 Manado',
  'SMKN 7 Manado',
  'SMKN 8 Manado',
  'SMKN 9 Manado',
  'SMKN 10 Manado',
  'Sudah Lulus',
];

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
      credentials: 'same-origin',
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new Error('Koneksi ke server gagal. Cek internet atau deploy API.');
  }
  const raw = await response.text().catch(() => '');
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message = payload.error || payload.message || raw || `Request failed (${response.status})`;
    throw new Error(message.length > 240 ? `${message.slice(0, 240)}...` : message);
  }
  return payload;
}

function normalizePhoneInputValue(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '+62';
  if (digits.startsWith('62')) return `+${digits.slice(0, 15)}`;
  if (digits.startsWith('0')) return `+62${digits.slice(1, 14)}`;
  return `+62${digits.slice(0, 13)}`;
}

function normalizeUsername(value = '') {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 24);
}

function sanitizeLettersNumbersSpaces(value = '', max = 60) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[()*&^%$#@!~`+=_\-'":;|\?/.,><[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trimStart()
    .slice(0, max);
}

function sanitizeName(value = '') {
  return sanitizeLettersNumbersSpaces(value, 60);
}

function sanitizeCity(value = '') {
  return sanitizeLettersNumbersSpaces(value, 25);
}

function sanitizeSchoolOther(value = '') {
  return sanitizeLettersNumbersSpaces(value, 40);
}

function sanitizeEmail(value = '') {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9@._+-]/g, '').slice(0, 80);
}

function levelName(points) {
  return `Level ${Math.min(100, Math.floor(Number(points || 0) / 1000) + 1)}`;
}

function numericLevel(points) {
  return Math.min(100, Math.floor(Number(points || 0) / 1000) + 1);
}

function levelProgress(points) {
  const level = numericLevel(points);
  const total = Math.max(0, Number(points || 0));
  const current = level >= 100 ? 1000 : total % 1000;
  const required = 1000;
  const percent = level >= 100 ? 100 : Math.max(0, Math.min(100, (current / required) * 100));
  return { level, current, required, percent, nextLevel: Math.min(100, level + 1) };
}

function avgTime(user = {}) {
  if (!user.total_answers) return '0s';
  return `${(Number(user.total_answer_time_ms || 0) / Number(user.total_answers || 1) / 1000).toFixed(1)}s`;
}

function avatar(user = {}) {
  return user.gender === 'female' ? '/image/women.png' : '/image/men.png';
}

function genderLabel(gender) {
  if (gender === 'male') return 'Laki-laki';
  if (gender === 'female') return 'Perempuan';
  return '-';
}

function profileColor(user = {}) {
  const palette = ['#9b111e', '#c7372e', '#d4af37', '#a9702f', '#2f6f9f', '#6a4fb3', '#2f8e5f', '#c7375f'];
  const key = String(user?.id || user?.username || user?.given_id || 'force');
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) - hash + key.charCodeAt(index)) | 0;
  }
  return palette[Math.abs(hash) % palette.length];
}

function secondsLeft(request) {
  if (!request) return 0;
  if (typeof request === 'string') return Math.max(0, Math.ceil((new Date(request).getTime() - Date.now()) / 1000));
  if (Number.isFinite(Number(request.expires_in_ms))) {
    const elapsed = Date.now() - Number(request.received_at_ms || Date.now());
    return Math.max(0, Math.ceil((Number(request.expires_in_ms) - elapsed) / 1000));
  }
  if (!request.expires_at) return 0;
  return Math.max(0, Math.ceil((new Date(request.expires_at).getTime() - Date.now()) / 1000));
}

function formatDateTimeId(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function fpDisplay(value, { signed = false, label = false } = {}) {
  const number = Number(value || 0);
  const prefix = signed && number >= 0 ? '+' : '';
  return (
    <span className="fp-chip" aria-label={`${prefix}${number.toLocaleString('id-ID')} Force Points`}>
      <span className="fp-value">{prefix}{number.toLocaleString('id-ID')}</span>
      <span className="fp-diamond" aria-hidden="true" />
      {label ? <span className="fp-label">FP</span> : null}
    </span>
  );
}

function duelRecordBoxes(wins = 0, losses = 0, draws = 0) {
  return (
    <span className="record-boxes" aria-label={`Win ${wins}, Lose ${losses}, Draw ${draws}`}>
      <span><b>{Number(wins || 0)}</b> <small>Win</small></span>
      <span><b>{Number(losses || 0)}</b> <small>Lose</small></span>
      <span><b>{Number(draws || 0)}</b> <small>Draw</small></span>
    </span>
  );
}

function duelResultLabel(result) {
  const value = String(result || '').toLowerCase();
  if (value === 'win') return 'WIN';
  if (value === 'lose' || value === 'loss') return 'LOSE';
  return 'DRAW';
}

function duelHistoryResult(duel = {}) {
  const explicit = String(duel.result || '').toLowerCase();
  if (['win', 'lose', 'draw'].includes(explicit)) return explicit;
  const mine = Number(duel.user_score ?? duel.fp_awarded ?? 0);
  const opponent = Number(duel.opponent_score ?? 0);
  if (mine > opponent) return 'win';
  if (mine < opponent) return 'lose';
  return 'draw';
}

function isSecretBadge(badge = {}) {
  const idNumber = Number(String(badge.id || '').match(/_(\d+)$/)?.[1] || 0);
  const normalizedName = String(badge.real_name || badge.name || '').trim().toLowerCase();
  return (idNumber >= 141 && idNumber <= 150) || SECRET_BADGE_NAMES.has(normalizedName);
}

function badgeDisplayName(badge = {}) {
  if (!badge.earned_at && isSecretBadge(badge)) return '???';
  return badge.name || badge.real_name || 'Badge';
}

function badgeDisplayDescription(badge = {}) {
  if (badge.earned_at) return badge.description || 'Badge berhasil terbuka.';
  if (isSecretBadge(badge)) return 'Nama dan syarat badge ini masih tersembunyi sampai kamu berhasil membukanya.';
  return 'Syarat badge ini masih tersembunyi sampai kamu berhasil membukanya.';
}

function sanitizeSearch(value = '') {
  return String(value || '').replace(/[^\p{L}\p{N}_ .@-]/gu, '').slice(0, 40);
}

function isValidQuestionImageUrl(value) {
  const url = String(value ?? '').trim();
  if (!url) return false;
  return !['null', 'undefined', 'none', 'false', '-'].includes(url.toLowerCase());
}

function preloadQuestionImages(questions = []) {
  if (typeof window === 'undefined') return;
  questions
    .map((question) => String(question?.image_url || '').trim())
    .filter(isValidQuestionImageUrl)
    .forEach((src) => {
      const image = new Image();
      image.decoding = 'async';
      image.src = src;
    });
}

function useDebouncedValue(value, delay = 220) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function useAudio(settings) {
  const audioRef = useRef({});
  const contextRef = useRef(null);
  const musicModeRef = useRef('idle');
  const readyRef = useRef(false);
  const lastButtonRef = useRef(0);

  const tone = useCallback((name) => {
    if (typeof window === 'undefined') return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    contextRef.current ||= new AudioContext();
    const ctx = contextRef.current;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const freq = {
      button: 420, tick: 760, correct: 920, wrong: 160, notif: 880, win: 1040, lose: 130,
      duelStart: 560, matchBeep: 680, matchStart: 980, badgeNotif: 1180, duelNotif: 620,
    }[name] || 440;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = name === 'wrong' || name === 'lose' ? 'sawtooth' : 'sine';
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.17);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.19);
  }, []);

  const activate = useCallback(() => {
    if (typeof window === 'undefined' || readyRef.current) return;
    readyRef.current = true;
    for (const [key, src] of Object.entries(SOUND_FILES)) {
      const audio = new Audio(src);
      audio.preload = 'auto';
      audio.setAttribute('playsinline', '');
      if (key === 'background') {
        audio.loop = true;
        audio.volume = 0.16;
      } else if (key === 'duelMusic') {
        audio.loop = true;
        audio.volume = 0.24;
      } else if (key === 'badgeNotif' || key === 'duelNotif') {
        audio.volume = 0.78;
      }
      audioRef.current[key] = audio;
    }
  }, []);

  const playSound = useCallback((name, options = {}) => {
    if (settings?.sfx_enabled === false) return;
    activate();
    const audio = audioRef.current[name];
    if (!audio) return tone(name);
    const player = options.overlap ? audio.cloneNode(true) : audio;
    player.currentTime = 0;
    player.volume = options.volume ?? audio.volume;
    player.play().catch(() => tone(name));
  }, [activate, settings?.sfx_enabled, tone]);

  const setMusicMode = useCallback((mode = 'idle') => {
    musicModeRef.current = mode;
    activate();
    const background = audioRef.current.background;
    const duel = audioRef.current.duelMusic;
    const active = mode === 'duel' ? duel : background;
    const inactive = mode === 'duel' ? background : duel;
    inactive?.pause();
    if (settings?.music_enabled === false) {
      active?.pause();
      return;
    }
    active?.play().catch(() => {});
  }, [activate, settings?.music_enabled]);

  const playButton = useCallback(() => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastButtonRef.current < 420) return;
    lastButtonRef.current = now;
    playSound('button', { overlap: true, volume: 0.72 });
  }, [playSound]);

  const stopMusic = useCallback(() => {
    audioRef.current.background?.pause();
    audioRef.current.duelMusic?.pause();
  }, []);

  useEffect(() => {
    const unlock = () => {
      activate();
      setMusicMode(musicModeRef.current || 'idle');
    };
    document.addEventListener('pointerdown', unlock, { once: true, passive: true });
    document.addEventListener('touchstart', unlock, { once: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('touchstart', unlock);
    };
  }, [activate, setMusicMode]);

  useEffect(() => {
    setMusicMode(musicModeRef.current || 'idle');
  }, [settings?.music_enabled, setMusicMode]);

  return { playSound, playButton, setMusicMode, stopMusic };
}

function LoadingOrb({ small = false }) {
  return <div className={`duel-loading-orb${small ? ' small' : ''}`} aria-hidden="true" />;
}

function AvatarRing({ user = {}, id = '', large = false }) {
  return (
    <span className={`avatar-ring${large ? ' avatar-ring-large' : ''}`} id={id || undefined} style={{ '--avatar-color': profileColor(user) }}>
      <img src={avatar(user)} alt="" />
    </span>
  );
}

function BootLoader({ hidden }) {
  return (
    <div className={`boot-loader${hidden ? ' is-hidden' : ''}`} id="bootLoader">
      <div>
        <img src="/image/force-logo.png" alt="" />
        <strong>Memeriksa sesi login...</strong>
        <small>Mohon tunggu sebentar.</small>
      </div>
    </div>
  );
}

function Toast({ message }) {
  return <div id="toast" className={`toast${message ? ' show' : ''}`}>{message}</div>;
}

function TogglePasswordInput({ name, required = false, minLength, autoComplete, placeholder, value, onChange }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="password-field">
      <input
        name={name}
        type={visible ? 'text' : 'password'}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
      />
      <button
        type="button"
        className={`password-toggle${visible ? ' is-visible' : ''}`}
        aria-label={visible ? 'Sembunyikan password' : 'Lihat password'}
        onClick={() => setVisible((current) => !current)}
      />
    </span>
  );
}


function FieldHint({ message }) {
  return <span className={`field-hint${message ? ' is-visible' : ''}`}>{message || ''}</span>;
}

function SchoolSelect({ value, onChange, options, placeholder = 'Pilih asal sekolah', includeOthers = true }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleOutside = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div className={`school-select${open ? ' is-open' : ''}`} ref={wrapRef}>
      <button type="button" className={`school-select-trigger${value ? ' has-value' : ''}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span>{value || placeholder}</span>
        <span className="school-select-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div className="school-select-panel" role="listbox" aria-label="Pilih asal sekolah">
          <div className="school-select-scroll">
            {options.map((option) => (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={value === option}
                className={`school-select-option${value === option ? ' is-active' : ''}`}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
              >
                {option}
              </button>
            ))}
            {includeOthers ? (
              <button
                type="button"
                role="option"
                aria-selected={value === 'Others'}
                className={`school-select-option school-select-option-other${value === 'Others' ? ' is-active' : ''}`}
                onClick={() => {
                  onChange('Others');
                  setOpen(false);
                }}
              >
                Others
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AuthView({ hidden, onLogin, onRegister, onToast, busy, setBusy, playButton }) {
  const [tab, setTab] = useState('login');
  const [login, setLogin] = useState({ username: '', password: '' });
  const [register, setRegister] = useState({ name: '', username: '', phone: '', email: '', city: '', school: '', schoolOther: '', gender: 'male', password: '', confirmPassword: '' });
  const [fieldHints, setFieldHints] = useState({ username: '', password: '' });
  const hintTimersRef = useRef({});

  const showFieldHint = useCallback((key, message) => {
    if (!message) return;
    const timers = hintTimersRef.current;
    if (timers[key]) window.clearTimeout(timers[key]);
    setFieldHints((current) => ({ ...current, [key]: message }));
    timers[key] = window.setTimeout(() => {
      setFieldHints((current) => ({ ...current, [key]: '' }));
      timers[key] = null;
    }, 2200);
  }, []);

  useEffect(() => () => {
    Object.values(hintTimersRef.current).forEach((timer) => {
      if (timer) window.clearTimeout(timer);
    });
  }, []);

  useEffect(() => {
    if (hidden || typeof window === 'undefined') return undefined;
    document.body.classList.add('auth-screen-open');
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
    return () => document.body.classList.remove('auth-screen-open');
  }, [hidden]);

  useEffect(() => {
    if (hidden || typeof window === 'undefined') return;
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  }, [hidden, tab]);

  const switchTab = (next) => {
    playButton();
    setTab(next);
  };

  const handleRegisterUsernameChange = (event) => {
    const raw = event.target.value || '';
    const normalized = normalizeUsername(raw);
    setRegister((current) => ({ ...current, username: normalized }));
    const compactRaw = String(raw).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    if (compactRaw && normalized !== compactRaw) {
      showFieldHint('username', 'Gunakan huruf kecil, angka, _, -, atau .');
    }
  };

  const handleRegisterPasswordChange = (event) => {
    const nextPassword = event.target.value || '';
    setRegister((current) => ({ ...current, password: nextPassword }));
    if (nextPassword && nextPassword.length < 8) {
      showFieldHint('password', 'Password harus minimal 8 karakter.');
    }
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setBusy('login');
    try {
      await onLogin({ username: normalizeUsername(login.username), password: login.password });
    } catch (error) {
      onToast(error.message || 'Login gagal.');
    } finally {
      setBusy('');
    }
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    if (!register.school) {
      onToast('Pilih asal sekolah dulu.');
      return;
    }
    if (register.school === 'Others' && !sanitizeSchoolOther(register.schoolOther).trim()) {
      onToast('Tulis nama sekolah asal.');
      return;
    }
    if (register.password && register.password.length < 8) {
      showFieldHint('password', 'Password harus minimal 8 karakter.');
      return;
    }
    if (register.password !== register.confirmPassword) {
      onToast('Konfirmasi password tidak sama.');
      return;
    }
    setBusy('register');
    try {
      await onRegister({ ...register, username: normalizeUsername(register.username), phone: normalizePhoneInputValue(register.phone), email: sanitizeEmail(register.email), name: sanitizeName(register.name).trim(), city: sanitizeCity(register.city).trim(), school: register.school === 'Others' ? sanitizeSchoolOther(register.schoolOther).trim() : register.school });
      setRegister({ name: '', username: '', phone: '', email: '', city: '', school: '', schoolOther: '', gender: 'male', password: '', confirmPassword: '' });
      setTab('login');
      onToast('Akun berhasil dibuat. Silakan login.');
    } catch (error) {
      onToast(error.message || 'Daftar gagal.');
    } finally {
      setBusy('');
    }
  };

  return (
    <section id="authView" className={`auth-view auth-view-${tab}${hidden ? ' is-hidden' : ''}`}>
      <div className="auth-brand">
        <img src="/image/force-logo.png" alt="FORCE" />
        <p />
      </div>

      <article className="auth-card" id="authCard">
        <div className="auth-tabs" aria-label="Auth pages">
          {['login', 'register', 'reset'].map((key) => (
            <button key={key} className={tab === key ? 'is-active' : ''} type="button" onClick={() => switchTab(key)}>
              {key === 'login' ? 'Masuk' : key === 'register' ? 'Daftar' : 'Bantuan'}
            </button>
          ))}
        </div>

        <form className={`auth-panel${tab === 'login' ? ' is-active' : ''}`} onSubmit={handleLogin}>
          <p className="eyebrow">Selamat datang kembali.</p>
          <h1>Masuk Arena</h1>
          <label>Username
            <input name="username" autoComplete="username" required placeholder="kairos" value={login.username} onChange={(event) => setLogin((current) => ({ ...current, username: event.target.value }))} />
          </label>
          <label>Password
            <TogglePasswordInput name="password" autoComplete="current-password" required placeholder="••••••••" value={login.password} onChange={(event) => setLogin((current) => ({ ...current, password: event.target.value }))} />
          </label>
          <button className={`btn primary full${busy === 'login' ? ' is-loading' : ''}`} type="submit" disabled={busy === 'login'}>{busy === 'login' ? 'Memproses...' : 'Masuk Arena'}</button>
          <div className="form-links">
            <button type="button" onClick={() => switchTab('register')}>Belum punya akun? Daftar</button>
            <button type="button" onClick={() => switchTab('reset')}>Lupa password?</button>
          </div>
        </form>

        <form className={`auth-panel${tab === 'register' ? ' is-active' : ''}`} onSubmit={handleRegister}>
          <p className="eyebrow">Daftar -&gt; Langsung Masuk</p>
          <h1>Buat Akun</h1>
          <div className="two-fields">
            <label>Nama<input name="name" required maxLength={60} placeholder="Nama lengkap" value={register.name} onChange={(event) => setRegister((current) => ({ ...current, name: sanitizeName(event.target.value) }))} /></label>
            <label>
              <span className="field-label-row">
                <span>Username</span>
                <FieldHint message={fieldHints.username} />
              </span>
              <input name="username" required minLength={3} maxLength={24} placeholder="misal: kairos.123" value={register.username} onChange={handleRegisterUsernameChange} />
            </label>
          </div>
          <label>Nomor WhatsApp
            <input
              name="phone"
              inputMode="numeric"
              required
              placeholder="+628123456789"
              maxLength={16}
              value={register.phone}
              onFocus={() => setRegister((current) => ({ ...current, phone: current.phone || '+62' }))}
              onBlur={() => setRegister((current) => ({ ...current, phone: current.phone === '+62' ? '' : current.phone }))}
              onChange={(event) => setRegister((current) => ({ ...current, phone: normalizePhoneInputValue(event.target.value) }))}
            />
          </label>
          <label>Email Aktif<input name="email" type="email" autoComplete="email" required maxLength={80} placeholder="nama@email.com" value={register.email} onChange={(event) => setRegister((current) => ({ ...current, email: sanitizeEmail(event.target.value) }))} /></label>
          <div className="two-fields">
            <label>Kota<input name="city" maxLength={25} required placeholder="Contoh: Manado" value={register.city} onChange={(event) => setRegister((current) => ({ ...current, city: sanitizeCity(event.target.value) }))} /></label>
            <label>
              <span className="field-label-row">
                <span>Asal Sekolah</span>
              </span>
              <SchoolSelect
                value={register.school}
                options={SCHOOL_OPTIONS}
                onChange={(nextSchool) => setRegister((current) => ({ ...current, school: nextSchool, schoolOther: nextSchool === 'Others' ? current.schoolOther : '' }))}
              />
            </label>
          </div>
          {register.school === 'Others' ? <label>Nama Sekolah Lain<input name="schoolOther" required maxLength={40} placeholder="Tulis sekolah asal" value={register.schoolOther} onChange={(event) => setRegister((current) => ({ ...current, schoolOther: sanitizeSchoolOther(event.target.value) }))} /></label> : null}
          <label>Jenis Kelamin
            <div className="gender-picker" role="group" aria-label="Pilih jenis kelamin saat daftar">
              <button type="button" className={register.gender === 'male' ? 'is-active' : ''} onClick={() => setRegister((current) => ({ ...current, gender: 'male' }))}>Cowok Warrior</button>
              <button type="button" className={register.gender === 'female' ? 'is-active' : ''} onClick={() => setRegister((current) => ({ ...current, gender: 'female' }))}>Cewek Warrior</button>
            </div>
          </label>
          <div className="two-fields">
            <label>
              <span className="field-label-row">
                <span>Password</span>
                <FieldHint message={fieldHints.password} />
              </span>
              <TogglePasswordInput name="password" required minLength={8} value={register.password} onChange={handleRegisterPasswordChange} />
            </label>
            <label>Konfirmasi<TogglePasswordInput name="confirmPassword" required minLength={8} value={register.confirmPassword} onChange={(event) => setRegister((current) => ({ ...current, confirmPassword: event.target.value }))} /></label>
          </div>
          <button className={`btn primary full${busy === 'register' ? ' is-loading' : ''}`} type="submit" disabled={busy === 'register'}>{busy === 'register' ? 'Memproses...' : 'Buat Akun'}</button>
          <small>Semua kotak wajib diisi. Setelah berhasil daftar, silakan masuk/login.</small>
        </form>

        <form className={`auth-panel${tab === 'reset' ? ' is-active' : ''}`} onSubmit={(event) => event.preventDefault()}>
          <p className="eyebrow">Bantuan akun</p>
          <h1>Lupa Password</h1>
          <p className="muted">Reset password lewat email sementara belum aktif. Kalau nanti sudah beli domain dan email sender sudah siap, fitur kode reset 6 digit akan diaktifkan lagi.</p>
          <div className="admin-contact-box">
            <strong>Hubungi Admin FORCE</strong>
            <small>Kirim username, email terdaftar, dan ID pemain supaya admin bisa bantu verifikasi akun.</small>
            <a className="btn primary full" href="https://wa.me/6281392187414?text=Halo%20Admin%20FORCE%2C%20saya%20lupa%20password.%20Username%3A%20%0AEmail%20terdaftar%3A%20%0AID%20Pemain%3A%20" target="_blank" rel="noopener noreferrer">Hubungi WA Admin</a>
            <p className="muted">Contact Person: 081392187414</p>
          </div>
          <button className="link-button" type="button" onClick={() => switchTab('login')}>Kembali ke login</button>
        </form>
      </article>
    </section>
  );
}

function AppShell({ me, dashboard, page, setPage, sidebarOpen, setSidebarOpen, playButton, schoolFeature, children }) {
  const [kicker, title] = PAGE_CONFIG[page] || PAGE_CONFIG.home;
  const showSchoolFeature = schoolFeatureIsVisible(schoolFeature);
  const countdown = showSchoolFeature ? schoolCountdownLabel(schoolFeature.visibleUntil) : '';
  const navItems = showSchoolFeature ? NAV_ITEMS : NAV_ITEMS.filter((item) => item.key !== 'schools');
  const goPage = (next) => {
    playButton();
    setPage(next);
    setSidebarOpen(false);
  };

  return (
    <div id="appView" className="app-view">
      <aside className={`sidebar${sidebarOpen ? ' is-open' : ''}`}>
        <a className="side-logo" href="#home" aria-label="FORCE Home" onClick={(event) => { event.preventDefault(); goPage('home'); }}>
          <img src="/image/force-logo.png" alt="" />
          <span>FORCE</span>
        </a>
        <nav id="mainNav">
          {navItems.map(({ key, label, className = '' }) => (
            <button key={key} className={`${className}${page === key ? ' is-active' : ''}`.trim()} type="button" onClick={() => goPage(key)}>
              {key === 'schools' ? (
                <span className="nav-school-content">
                  <strong>{label}</strong>
                  <small className="nav-school-countdown"><img src="/svg/time.svg" alt="" aria-hidden="true" /><span>{countdown}</span></small>
                </span>
              ) : label}
            </button>
          ))}
        </nav>
        <div className="daily-flame">
          <img className="daily-flame-icon" src="/gif/fire.gif" alt="" loading="lazy" />
          <div>
            <span>Fire Streak</span>
            <strong id="sideFire">{me.fire_streak_days || 0} hari</strong>
            <small>Dihitung per hari aktif duel</small>
          </div>
        </div>
      </aside>

      <main className="app-shell">
        <header className="topbar">
          <button className="icon-btn" id="mobileMenuBtn" aria-label="Open menu" type="button" onClick={(event) => { event.stopPropagation(); playButton(); setSidebarOpen((current) => !current); }}>☰</button>
          <div>
            <p className="eyebrow" id="pageKicker">{kicker}</p>
            <h2 id="pageTitle">{title}</h2>
          </div>
          <button className="profile-pill" id="profilePill" type="button" onClick={() => goPage('settings')}>
            <span>
              <strong id="pillUsername">{me.username}</strong>
              <small><span id="pillFp">{fpDisplay(me.lifetime_fp)}</span></small>
            </span>
            <AvatarRing user={me} id="pillAvatarWrap" />
          </button>
        </header>

        {children}

        <footer className="footer">
          <div>
            <img src="/image/force-logo.png" alt="" />
            <strong>FORCE</strong>
            <small>Duel. Grow. Rise.</small>
          </div>
          <div><strong>Contact Person</strong><a href="https://wa.me/6281392187414">081392187414</a><a href="mailto:forcecommunity.id@gmail.com">forcecommunity.id@gmail.com</a></div>
          <div><strong>Follow Us</strong><a href="https://instagram.com/forcecommunity.id">Instagram</a><a href="https://facebook.com/force.arena">Facebook</a><a href="https://tiktok.com/@forcecommunity.id">TikTok</a></div>
          <p>© 2026 FORCE. All rights reserved.</p>
        </footer>
      </main>

      <nav className="bottom-nav" id="bottomNav">
        {BOTTOM_NAV.map(([key, label]) => (
          <button key={key} className={page === key ? 'is-active' : ''} type="button" onClick={() => goPage(key)}>{label}</button>
        ))}
      </nav>
    </div>
  );
}

function PageFrame({ name, active, children }) {
  return <section className={`page${active ? ' is-active' : ''}`} data-view={name}>{children}</section>;
}

function HomePage({ me, dashboard, schoolFeature, setPage, playButton }) {
  const dailyLimit = dashboard?.dailyDuelLimit || DAILY_DUEL_LIMIT;
  const progress = levelProgress(me.lifetime_fp);
  const stats = [
    ['Fire Streak', `${me.fire_streak_days || 0} hari`],
    ['Peringkat Saat Ini', `#${dashboard?.myRank || '-'}`],
    ['FP Mingguan', fpDisplay(me.weekly_fp)],
    ['Lifetime FP', fpDisplay(me.lifetime_fp)],
    ['Level', levelName(me.lifetime_fp)],
    ['Duel Hari Ini', `${dashboard?.duelsToday || 0}/${dailyLimit}`],
  ];
  const go = (page) => {
    playButton();
    setPage(page);
  };

  const showSchoolFeature = schoolFeatureIsVisible(schoolFeature);
  const schoolCountdown = showSchoolFeature ? schoolCountdownLabel(schoolFeature.visibleUntil) : '';

  return (
    <>
      {showSchoolFeature ? (
        <button className="home-school-event" type="button" onClick={() => go('schools')}>
          <span className="home-school-event-glow" aria-hidden="true" />
          <span className="home-school-event-copy">
            <small>SPECIAL EVENT</small>
            <strong>FORCE Go to Schools</strong>
          </span>
          <b className="home-school-countdown"><img src="/svg/time.svg" alt="" aria-hidden="true" /><span>{schoolCountdown}</span></b>
        </button>
      ) : null}
      <div className="welcome-grid">
        <article className="hero-card">
          <p className="eyebrow">Selamat datang</p>
          <h1>Halo, <span id="homeName">{me.name}</span>!</h1>
          <p>Berduel setiap hari, kumpulkan Force Points, jaga api streakmu, dan buktikan dirimu di leaderboard.</p>
          <div className="hero-quote">Every Duel Calls Out Your Excellence</div>
        </article>
        <article className="profile-mini card">
          <AvatarRing user={me} id="homeAvatarWrap" large />
          <h3 id="homeUsername">{me.username}</h3>
          <p id="homeLevel">{levelName(me.lifetime_fp)}</p>
          <div className="level-progress" id="homeLevelProgress">
            <div className="level-progress-top"><span>Progress Level</span><strong>{Math.round(progress.percent)}%</strong></div>
            <div className="level-progress-track" aria-label={`Progress level ${Math.round(progress.percent)} persen`}><span style={{ width: `${progress.percent}%` }} /></div>
            <small>{progress.level >= 100 ? 'Level maksimum tercapai' : `${progress.current.toLocaleString('id-ID')}/${progress.required.toLocaleString('id-ID')} menuju Level ${progress.nextLevel}`}</small>
          </div>
          <button className="btn secondary" type="button" onClick={() => go('settings')}>Pengaturan Profil</button>
        </article>
      </div>

      <div className="stat-grid" id="dashboardStats">
        {stats.map(([label, value]) => (
          <article key={label} className={`stat-card${/fp/i.test(label) ? ' fp-stat' : ''}`}><span>{label}</span><strong>{value}</strong></article>
        ))}
      </div>

      <div className="action-grid">
  <button
    className="action-card"
    type="button"
    onClick={() => go('duel')}
  >
    <img
      className="action-card-icon"
      src="/svg/swords.svg"
      alt=""
    />
    <strong>Cari Duel</strong>
  </button>

  <button
    className="action-card"
    type="button"
    onClick={() => go('members')}
  >
    <img
      className="action-card-icon"
      src="/svg/members.svg"
      alt=""
    />
    <strong>Daftar Member</strong>
  </button>

  <button
    className="action-card"
    type="button"
    onClick={() => go('leaderboard')}
  >
    <img
      className="action-card-icon"
      src="/svg/leaderboard.svg"
      alt=""
    />
    <strong>Papan Peringkat</strong>
  </button>
</div>
    </>
  );
}

function RequestsPanel({ requests, outgoing, onRespond }) {
  return (
    <div className="request-panel" id="requestPanel">
      {requests?.length ? requests.map((request) => {
        const left = secondsLeft(request);
        return (
          <article className="request-item" key={request.id}>
            <div>
              <p><strong>{request.requester_username}</strong> mengajak kamu duel.</p>
              <small className="request-countdown">{left > 0 ? `Sisa ${left} detik untuk accept` : 'Waktu accept habis'}</small>
            </div>
            <div className="request-actions">
              <button className="btn secondary" type="button" disabled={left <= 0} onClick={() => onRespond(request.id, 'accept')}>Accept</button>
              <button className="btn danger" type="button" onClick={() => onRespond(request.id, 'decline')}>Decline</button>
            </div>
          </article>
        );
      }) : <p className="muted">Belum ada request duel masuk.</p>}
      {outgoing?.length ? (
        <div className="outgoing-requests">
          {outgoing.map((request) => <small key={request.id}>Invite ke <strong>@{request.target_username}</strong>: {request.status === 'pending' ? `${secondsLeft(request)} detik` : request.status}</small>)}
        </div>
      ) : null}
    </div>
  );
}

function MemberProfileModal({ member, onClose, onInvite, onToggleFavourite, outgoing }) {
  useEffect(() => {
    if (!member || typeof window === 'undefined') return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [member, onClose]);

  if (!member || typeof document === 'undefined') return null;
  const totalDuels = Number(member.wins || 0) + Number(member.losses || 0) + Number(member.draws || 0);
  const stats = [
    ['Kota', member.city || '-'],
    ['Sekolah', member.school || '-'],
    ['Jenis Kelamin', genderLabel(member.gender)],
    ['Level', levelName(member.lifetime_fp)],
    ['Lifetime FP', fpDisplay(member.lifetime_fp)],
    ['Weekly FP', fpDisplay(member.weekly_fp)],
    ['Duel Count', totalDuels.toLocaleString('id-ID')],
    ['Rekor Duel', duelRecordBoxes(member.wins, member.losses, member.draws)],
    ['Jawaban Benar', Number(member.total_correct || 0).toLocaleString('id-ID')],
    ['Avg Time', avgTime(member)],
    ['Win Streak', `${member.current_win_streak || 0} menang`],
    ['Fire Streak', `${member.fire_streak_days || 0} hari`],
    ['Status', member.online ? 'Online' : 'Offline'],
  ];
  const ownPending = outgoing?.find((request) => request.status === 'pending' && request.target_id === member.id && secondsLeft(request) > 0);
  const anyPending = outgoing?.find((request) => request.status === 'pending' && secondsLeft(request) > 0);

  return createPortal((
    <div className="member-profile-modal" role="dialog" aria-modal="true" aria-label={`Profile member ${member.username || ''}`}>
      <button className="member-profile-backdrop" type="button" onClick={onClose} aria-label="Tutup profil member" />
      <article className="member-profile-dialog">
        <button className="member-profile-close" type="button" onClick={onClose} aria-label="Tutup">×</button>
        <div className="member-profile-card member-profile-card-modal">
          <div className="member-profile-modal-head">
            <AvatarRing user={member} large />
            <div className="member-profile-main">
              <p className="eyebrow">Profile Member</p>
              <h3>{member.name || 'Member'}</h3>
              <small>@{member.username || 'member'} / ID {member.given_id || '-'} · {member.city || '-'}</small>
              <div className="mini-actions">
                <button className={`heart-action${member.is_favourite ? ' is-on' : ''}`} type="button" onClick={() => onToggleFavourite(member.id)} aria-label={member.is_favourite ? 'Hapus dari favorite' : 'Tambah ke favorite'}><span aria-hidden="true">{member.is_favourite ? '♥' : '♡'}</span></button>
                <button className={`duel-action${ownPending || anyPending ? ' is-pending' : ''}`} type="button" disabled={!member.online || Boolean(ownPending || anyPending)} onClick={() => onInvite(member.id)}>{!member.online ? 'Offline' : ownPending || anyPending ? `Pending ${secondsLeft(ownPending || anyPending)}s` : 'Invite Duel'}</button>
              </div>
            </div>
          </div>
          <div className="member-profile-stats">
            {stats.map(([label, value]) => <div key={label} className={/fp/i.test(label) ? 'fp-stat' : ''}><span>{label}</span><strong>{value}</strong></div>)}
          </div>
        </div>
      </article>
    </div>
  ), document.body);
}

function MembersPage({ requests, outgoing, onRespond, onToast, playButton }) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 220);
  const [tab, setTab] = useState('all');
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [memberRanks] = useState(() => new Map());

  const sortedMembers = useMemo(() => {
    const getRank = (id) => {
      if (!memberRanks.has(id)) memberRanks.set(id, Math.random());
      return memberRanks.get(id);
    };
    const base = tab === 'online' ? members.filter((member) => member.online) : tab === 'favourites' ? members.filter((member) => member.is_favourite) : members;
    return [...base].sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      if (a.online && b.online) return new Date(b.last_seen_at || 0).getTime() - new Date(a.last_seen_at || 0).getTime();
      return getRank(a.id) - getRank(b.id);
    });
  }, [members, tab, memberRanks]);

  const loadMembers = useCallback(async (q = debouncedSearch) => {
    setLoading(true);
    try {
      const data = await api(`/api/members?q=${encodeURIComponent(q)}&tab=all`);
      setMembers(data.members || []);
    } catch (error) {
      onToast(error.message || 'Member gagal dimuat.');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, onToast]);

  useEffect(() => {
    loadMembers(debouncedSearch);
  }, [debouncedSearch, loadMembers]);

  const toggleFavourite = async (memberId) => {
    playButton();
    try {
      const data = await api(`/api/members/${memberId}/relation`, { method: 'POST', body: { type: 'favourite' } });
      const isFavourite = Boolean(data.relation?.is_favourite);
      setMembers((current) => current.map((member) => member.id === memberId ? { ...member, is_favourite: isFavourite } : member));
      setSelected((current) => current?.id === memberId ? { ...current, is_favourite: isFavourite } : current);
    } catch (error) {
      onToast(error.message || 'Gagal update favorite.');
    }
  };

  const invite = async (memberId) => {
    playButton();
    if (outgoing?.some((request) => request.status === 'pending' && secondsLeft(request) > 0)) return;
    try {
      const data = await api(`/api/members/${memberId}/invite`, { method: 'POST' });
      onToast(data.alreadyPending ? 'Undangan duel masih pending.' : 'Undangan duel terkirim. Menunggu accept 20 detik.');
    } catch (error) {
      onToast(error.message || 'Invite duel gagal.');
    }
  };

  const memberTabLabel = tab === 'online' ? 'member online' : tab === 'favourites' ? 'member favorit' : 'member';
  const activePending = outgoing?.find((request) => request.status === 'pending' && secondsLeft(request) > 0);

  return (
    <>
      <div className="section-tools">
        <input id="memberSearch" placeholder="Cari username / ID" value={search} onChange={(event) => setSearch(sanitizeSearch(event.target.value))} />
        <div className="member-filter" id="memberTab" role="tablist" aria-label="Filter member">
          {[
            ['all', 'Semua Member'],
            ['online', 'Online'],
            ['favourites', 'Favorit'],
          ].map(([key, label]) => <button key={key} className={tab === key ? 'is-active' : ''} type="button" onClick={() => { playButton(); setTab(key); }}>{label}</button>)}
        </div>
      </div>
      <div className="table-card">
        <RequestsPanel requests={requests} outgoing={outgoing} onRespond={onRespond} />
        <div className="member-profile-panel" id="memberProfilePanel"><p className="muted">Klik member untuk melihat profile dan stats.</p></div>
        <div className="member-list" id="memberList">
          {loading ? (
            <div className="member-list-loading" aria-live="polite" aria-busy="true"><LoadingOrb small /><strong>Memuat {memberTabLabel}{debouncedSearch ? ` untuk pencarian “${debouncedSearch}”` : ''}</strong><small>Mohon tunggu, kategori sedang disaring agar data tidak tertukar.</small></div>
          ) : sortedMembers.length ? sortedMembers.map((member) => {
            const ownPending = outgoing?.find((request) => request.status === 'pending' && request.target_id === member.id && secondsLeft(request) > 0);
            const pending = ownPending || activePending;
            return (
              <article key={member.id} className={`member-row${selected?.id === member.id ? ' is-selected' : ''}`} tabIndex={0} role="button" aria-label={`Lihat profile ${member.username}`} onClick={(event) => { if (event.target.closest('button')) return; setSelected(member); }} onKeyDown={(event) => { if (event.key === 'Enter') setSelected(member); }}>
                <AvatarRing user={member} />
                <div><strong>{member.name}</strong><small>@{member.username} / {member.given_id} · {member.school || member.city || '-'}</small></div>
                <div className="member-level-cell"><span>{levelName(member.lifetime_fp)}</span><small>{fpDisplay(member.lifetime_fp)}</small></div>
                <div><span className={`status-dot ${member.online ? 'online' : 'offline'}`} />{member.online ? 'Online' : 'Offline'}</div>
                <div className="mini-actions">
                  <button className={`heart-action${member.is_favourite ? ' is-on' : ''}`} type="button" aria-label={member.is_favourite ? 'Hapus dari favorite' : 'Tambah ke favorite'} onClick={() => toggleFavourite(member.id)}><span aria-hidden="true">{member.is_favourite ? '♥' : '♡'}</span></button>
                  <button className={`duel-action${pending ? ' is-pending' : ''}`} type="button" disabled={!member.online || Boolean(pending)} onClick={() => invite(member.id)}>{!member.online ? 'Offline' : pending ? `Pending ${secondsLeft(pending)}s` : 'Invite Duel'}</button>
                </div>
              </article>
            );
          }) : <p className="muted">Belum ada {memberTabLabel} yang cocok.</p>}
        </div>
      </div>
      <MemberProfileModal member={selected} onClose={() => setSelected(null)} onInvite={invite} onToggleFavourite={toggleFavourite} outgoing={outgoing} />
    </>
  );
}

function LeaderboardPage({ onToast }) {
  const PAGE_SIZE = 10;
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [schoolFilter, setSchoolFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const suffix = schoolFilter ? `?school=${encodeURIComponent(schoolFilter)}` : '';
    api(`/api/leaderboard${suffix}`)
      .then((payload) => { if (!cancelled) setData(payload); })
      .catch((error) => onToast(error.message || 'Leaderboard gagal dimuat.'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [onToast, schoolFilter]);
  const rows = Array.isArray(data?.rows)
    ? data.rows
    : Array.isArray(data?.leaderboard)
      ? data.leaderboard
      : Array.isArray(data?.weekly)
        ? data.weekly
        : [];
  const rankedRows = rows.slice(0, 100);
  const totalPages = Math.ceil(rankedRows.length / PAGE_SIZE);
  const visibleRows = rankedRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => { setCurrentPage(1); }, [schoolFilter]);
  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const changePage = (nextPage) => {
    setCurrentPage(nextPage);
    window.requestAnimationFrame(() => document.getElementById('leaderboardRows')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const topList = (title, items, valueFn) => (
    <div className="legend-block">
      <strong>{title}</strong>
      {items?.length ? items.map((row, index) => <article className="legend-person" key={`${title}-${row.id || row.user_id || index}`}><span className="legend-medal">#{index + 1}</span><span><b>@{row.username}</b><small>{valueFn(row)}</small></span></article>) : <p className="muted">Belum ada data.</p>}
    </div>
  );

  return (
    <div className="leader-grid">
      <article className="table-card">
        <div className="leaderboard-filter">
          <label>Filter Sekolah
            <SchoolSelect
              value={schoolFilter || 'Semua Sekolah'}
              options={['Semua Sekolah', ...new Set([...(data?.schoolOptions || SCHOOL_OPTIONS)])]}
              includeOthers={false}
              placeholder="Semua Sekolah"
              onChange={(nextSchool) => setSchoolFilter(nextSchool === 'Semua Sekolah' ? '' : nextSchool)}
            />
          </label>
        </div>
        <div className="table-head"><span>Rank</span><span>Pemain</span><span>FP Mingguan</span></div>
        <div id="leaderboardRows">
          {loading ? <div className="member-list-loading leaderboard-loading" aria-live="polite" aria-busy="true"><LoadingOrb small /><strong>Memuat leaderboard...</strong><small>Menyinkronkan peringkat dan Force Points terbaru.</small></div> : visibleRows.length ? visibleRows.map((row, index) => {
            const rank = row.rank || ((currentPage - 1) * PAGE_SIZE) + index + 1;
            return <article className={`leader-row top-${rank}${row.is_me ? ' is-me' : ''}`} key={row.id || row.user_id || index}>
              <strong>#{rank}</strong>
              <div className="leader-player"><AvatarRing user={row} /><span className="leader-player-name"><b>@{row.username}</b><small>{row.name || 'FORCE Warrior'}{row.school ? ` · ${row.school}` : ''}</small></span></div>
              <strong className="leader-weekly-fp">{fpDisplay(row.weekly_fp)}</strong>
            </article>;
          }) : <p className="muted">Belum ada ranking.</p>}
        </div>
        {!loading && totalPages > 1 ? (
          <nav className="leaderboard-pagination" aria-label="Halaman leaderboard">
            <button type="button" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)} aria-label="Halaman sebelumnya">&lsaquo;</button>
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => <button key={pageNumber} type="button" className={currentPage === pageNumber ? 'is-active' : ''} aria-current={currentPage === pageNumber ? 'page' : undefined} onClick={() => changePage(pageNumber)}>{pageNumber}</button>)}
            <button type="button" disabled={currentPage === totalPages} onClick={() => changePage(currentPage + 1)} aria-label="Halaman berikutnya">&rsaquo;</button>
          </nav>
        ) : null}
      </article>
      <aside className="legend-card">
        <h3>Hall of Legends</h3>
        <div id="hallOfLegends">
          {topList('Top 3 Last Week', data?.legends?.lastWeek || data?.weekly?.lastWinners || [], (row) => <>{fpDisplay(row.weekly_fp)} minggu lalu</>)}
          {topList('Fire Streak Terbanyak', data?.legends?.fire || [], (row) => `${row.fire_streak_days || 0} hari menyala`)}
          {topList('Lifetime FP Terbanyak', data?.legends?.lifetime || [], (row) => fpDisplay(row.lifetime_fp))}
        </div>
      </aside>
    </div>
  );
}

function BadgeVisual({ badge }) {
  const [failed, setFailed] = useState(false);
  const fallback = (badgeDisplayName(badge) || '?').trim().charAt(0).toUpperCase() || '?';
  if (!badge.earned_at) return '?';
  if (!badge.img_url || failed) return fallback;
  return <img className="badge-img" src={badge.img_url} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

function BadgesPage({ onToast }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api('/api/badges')
      .then((payload) => { if (!cancelled) setData(payload); })
      .catch((error) => onToast(error.message || 'Badge gagal dimuat.'));
    return () => { cancelled = true; };
  }, [onToast]);

  useEffect(() => {
    if (!selected) return undefined;
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, [selected]);

  return (
    <div className="badge-layout">
      <article>
        <div className="page-headline"><h1>Badge</h1><p id="badgeProgress">{data ? `${data.unlocked}/${data.total} terbuka` : '0/0 terbuka'}</p></div>
        <div className="badge-grid" id="badgeGrid">
          {!data ? <p className="muted">Memuat badge...</p> : data.badges?.length ? data.badges.map((badge) => {
            const secretClass = !badge.earned_at && isSecretBadge(badge) ? ' secret-locked' : '';
            return (
              <button key={badge.id} className={`badge-tile ${badge.earned_at ? '' : `locked${secretClass}`}`} type="button" onClick={() => setSelected(badge)}>
                <span className="badge-icon"><BadgeVisual badge={badge} /></span>
                <strong>{badgeDisplayName(badge)}</strong>
                <small>{badge.earned_at ? 'Terbuka' : 'Terkunci'}</small>
              </button>
            );
          }) : <p className="muted">Badge belum tersedia. Buka halaman ini lagi setelah database schema dan seed berhasil.</p>}
        </div>
      </article>
      <aside className="badge-detail is-hidden" id="badgeDetail" />
      {selected ? (
        <div className={`badge-modal ${selected.earned_at ? 'is-unlocked' : 'is-locked'}`} role="dialog" aria-modal="true">
          <button className="badge-modal-backdrop" type="button" onClick={() => setSelected(null)} aria-label="Tutup detail badge" />
          <article className="badge-modal-card">
            <button className="badge-modal-close" type="button" onClick={() => setSelected(null)} aria-label="Tutup">x</button>
            <div className="badge-icon"><BadgeVisual badge={selected} /></div>
            <h3>{badgeDisplayName(selected)}</h3>
            <p>{badgeDisplayDescription(selected)}</p>
            <p><strong>Status:</strong> {selected.earned_at ? 'Terbuka' : 'Terkunci'}</p>
            {selected.earned_at ? <p><strong>Earned at:</strong> {formatDateTimeId(selected.earned_at)}</p> : null}
          </article>
        </div>
      ) : null}
    </div>
  );
}

function AboutPage({ dashboard }) {
  const dailyLimit = dashboard?.dailyDuelLimit || DAILY_DUEL_LIMIT;
  const items = [
    ['Apa itu FORCE', 'Komunitas yang membantu setiap anggota bertumbuh, mengembangkan potensi, dan menemukan tujuan hidup melalui pengalaman belajar yang menyenangkan.'],
    ['Tujuan Komunitas', 'Membangun generasi yang mengenal potensinya, menemukan tujuan hidupnya, dan bertumbuh bersama dalam komunitas yang sehat.'],
    ['Force Points', <span className="about-fp-line" key="fp"><span className="fp-diamond" aria-hidden="true" /><span>Force Points adalah skor utama setiap duel. Jawaban yang benar dan lebih cepat akan menghasilkan poin yang lebih tinggi.</span></span>],
    ['Cara Duel', `Setiap duel berisi 5 soal, masing-masing 10 detik. Maksimal ${dailyLimit} duel per hari.`],
    ['Sistem Level', <>Kumpulkan {fpDisplay(1000)} lifetime untuk naik 1 level dan tunjukan progres perjalananmu di FORCE Arena.</>],
    ['Hadiah Mingguan', <>Recap juara di setiap hari Minggu jam 23:59 WIB, lalu weekly <span className="about-fp-name"><span className="fp-diamond" aria-hidden="true" />Force Points</span> reset setiap Senin 00:00 WIB.</>],
    ['WhatsApp Komunitas', 'Gunakan contact person footer untuk masuk grup atau koordinasi duel.'],
    ['Fire Streak', 'Mainkan minimal satu duel setiap hari untuk menjaga Fire Streak. Jika sehari tidak bermain, streak akan kembali ke 0.'],
    ['Masih Bingung?', 'Silakan bertanya atau hubungi admin melalui contact person di footer.'],
  ];
  return (
    <>
      <article className="about-hero">
        <div>
          <p className="eyebrow">Foundation Of Resillience Calling & Excellence</p>
          <h1>Selamat Datang di FORCE Arena</h1>
          <p>Belajar, bertanding, dan menangkan hadiah melalui duel kuis yang seru dan menantang.</p>
        </div>
        <img src="/image/force-logo.png" alt="" />
      </article>
      <div className="about-grid" id="aboutGrid">
        {items.map(([title, text]) => <article className="about-card" key={title}><h3>{title}</h3><p>{text}</p></article>)}
      </div>
    </>
  );
}

function SettingsPage({ me, dashboard, refreshMe, onToast, onLogout, playButton }) {
  const [profile, setProfile] = useState({ name: '', username: '', phone: '', email: '', city: '', school: '', gender: 'male' });
  const [settings, setSettings] = useState({ music_enabled: true, sfx_enabled: true });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [admin, setAdmin] = useState({ adminKey: '', identifier: '', newPassword: '', confirmPassword: '' });
  const [busy, setBusy] = useState('');

  useEffect(() => {
    setProfile({ name: me.name || '', username: me.username || '', phone: me.phone || '', email: me.email || '', city: me.city || '', school: me.school || '-', gender: me.gender || 'male' });
    setSettings({ music_enabled: me.settings?.music_enabled !== false, sfx_enabled: me.settings?.sfx_enabled !== false });
  }, [me]);

  const saveProfile = async (event) => {
    event.preventDefault();
    setBusy('profile');
    try {
      await api('/api/me/profile', { method: 'PATCH', body: { username: me.username, name: sanitizeName(profile.name).trim(), phone: normalizePhoneInputValue(profile.phone), email: sanitizeEmail(profile.email), city: sanitizeCity(profile.city).trim(), gender: profile.gender } });
      await refreshMe();
      onToast('Profil berhasil disimpan.');
    } catch (error) {
      onToast(error.message || 'Profil gagal disimpan.');
    } finally {
      setBusy('');
    }
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    setBusy('settings');
    try {
      await api('/api/me/settings', { method: 'PATCH', body: settings });
      await refreshMe();
      onToast('Pengaturan berhasil disimpan.');
    } catch (error) {
      onToast(error.message || 'Pengaturan gagal disimpan.');
    } finally {
      setBusy('');
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    if (passwords.newPassword !== passwords.confirmPassword) return onToast('Konfirmasi password baru tidak sama.');
    setBusy('password');
    try {
      await api('/api/me/password', { method: 'POST', body: passwords });
      setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' });
      onToast('Password berhasil diganti.');
    } catch (error) {
      onToast(error.message || 'Password gagal diganti.');
    } finally {
      setBusy('');
    }
  };

  const adminReset = async (event) => {
    event.preventDefault();
    if (admin.newPassword !== admin.confirmPassword) return onToast('Konfirmasi password baru tidak sama.');
    setBusy('admin');
    try {
      const data = await api('/api/admin/reset-password', { method: 'POST', body: admin });
      setAdmin({ adminKey: '', identifier: '', newPassword: '', confirmPassword: '' });
      onToast(data.message || 'Password user berhasil direset.');
    } catch (error) {
      onToast(error.message || 'Admin reset gagal.');
    } finally {
      setBusy('');
    }
  };

  const dailyLimit = dashboard?.dailyDuelLimit || DAILY_DUEL_LIMIT;
  const history = dashboard?.duelHistory || [];
  const profileStats = [
    ['Level Pemain', levelName(me.lifetime_fp)],
    ['Total Poin', fpDisplay(me.lifetime_fp), 'profile-total-points'],
    ['Rekor Duel', duelRecordBoxes(me.wins, me.losses, me.draws)],
    ['Jawaban Benar', me.total_correct || 0],
    ['Rata-rata Waktu', avgTime(me)],
    ['Streak Menang', `${me.current_win_streak || 0} menang`],
    ['Akun Dibuat', me.created_at ? new Date(me.created_at).toLocaleDateString('id-ID') : '-'],
    ['Fire Streak', `${me.fire_streak_days || 0} hari`],
    ['Duel Hari Ini', `${dashboard?.duelsToday || 0}/${dailyLimit}`],
  ];

  const copyText = async (value, label) => {
    try {
      await navigator.clipboard.writeText(String(value || ''));
      onToast(`${label} berhasil dicopy.`);
    } catch {
      onToast('Copy gagal.');
    }
  };

  return (
    <div className="settings-grid">
      <form className="settings-card" id="profileForm" onSubmit={saveProfile}>
        <h3>Pengaturan Profil</h3>
        <label>Nama<input name="name" id="nameInput" required value={profile.name} onChange={(event) => setProfile((current) => ({ ...current, name: sanitizeName(event.target.value) }))} /></label>
        <label>Username<input className="locked-input" name="username" id="usernameInput" required readOnly title="Username tidak bisa diganti setelah daftar." value={profile.username} onChange={() => {}} /></label>
        <label>Asal Sekolah<input className="locked-input" name="school" id="schoolInput" readOnly title="Asal sekolah tidak bisa diganti setelah daftar." value={profile.school || '-'} onChange={() => {}} /><small className="locked-note">Asal sekolah dikunci setelah daftar.</small></label>
        <label>Nomor WhatsApp<input name="phone" id="phoneInput" inputMode="numeric" required maxLength={16} value={profile.phone} onFocus={() => setProfile((current) => ({ ...current, phone: current.phone || '+62' }))} onBlur={() => setProfile((current) => ({ ...current, phone: current.phone === '+62' ? '' : current.phone }))} onChange={(event) => setProfile((current) => ({ ...current, phone: normalizePhoneInputValue(event.target.value) }))} /></label>
        <label>Email Aktif<input name="email" id="emailInput" type="email" autoComplete="email" required value={profile.email} maxLength={80} onChange={(event) => setProfile((current) => ({ ...current, email: sanitizeEmail(event.target.value) }))} /></label>
        <label>Kota<input name="city" id="cityInput" maxLength={25} placeholder="Contoh: Manado" value={profile.city} onChange={(event) => setProfile((current) => ({ ...current, city: sanitizeCity(event.target.value) }))} /></label>
        <label>Jenis Kelamin
          <div className="gender-picker" id="genderPicker" role="group" aria-label="Pilih jenis kelamin">
            <button type="button" className={profile.gender === 'male' ? 'is-active' : ''} onClick={() => { playButton(); setProfile((current) => ({ ...current, gender: 'male' })); }}>Laki-laki</button>
            <button type="button" className={profile.gender === 'female' ? 'is-active' : ''} onClick={() => { playButton(); setProfile((current) => ({ ...current, gender: 'female' })); }}>Perempuan</button>
          </div>
        </label>
        <button className={`btn primary${busy === 'profile' ? ' is-loading' : ''}`} type="submit" disabled={busy === 'profile'}>{busy === 'profile' ? 'Memproses...' : 'Simpan Profil'}</button>
      </form>

      <form className="settings-card" id="settingsForm" onSubmit={saveSettings}>
        <h3>Pengaturan Akun</h3>
        <label className="switch"><span><strong>Music</strong><small>Instrument piano latar web</small></span><input name="music_enabled" type="checkbox" checked={settings.music_enabled} onChange={(event) => setSettings((current) => ({ ...current, music_enabled: event.target.checked }))} /></label>
        <label className="switch"><span><strong>Sound FX</strong><small>Klik, timer, benar, salah, menang, kalah</small></span><input name="sfx_enabled" type="checkbox" checked={settings.sfx_enabled} onChange={(event) => setSettings((current) => ({ ...current, sfx_enabled: event.target.checked }))} /></label>
        <button className={`btn primary${busy === 'settings' ? ' is-loading' : ''}`} type="submit" disabled={busy === 'settings'}>{busy === 'settings' ? 'Memproses...' : 'Simpan Pengaturan'}</button>
        <button className="btn danger" type="button" id="logoutBtn" onClick={onLogout}>Logout</button>
        <button className="link-button danger-text" type="button" id="deleteAccountBtn" onClick={() => onToast('Fitur hapus akun belum diaktifkan. Hubungi admin jika perlu penghapusan data.')}>Hapus akun</button>
      </form>

      <form className="settings-card change-password-card" id="changePasswordForm" onSubmit={changePassword}>
        <h3>Change Password</h3>
        <p className="muted">Untuk user yang masih bisa login. Masukkan password lama lalu buat password baru.</p>
        <label>Password Lama<TogglePasswordInput name="currentPassword" autoComplete="current-password" required value={passwords.currentPassword} onChange={(event) => setPasswords((current) => ({ ...current, currentPassword: event.target.value }))} /></label>
        <label>Password Baru<TogglePasswordInput name="newPassword" minLength={8} autoComplete="new-password" required placeholder="Minimal 8 karakter" value={passwords.newPassword} onChange={(event) => setPasswords((current) => ({ ...current, newPassword: event.target.value }))} /></label>
        <label>Konfirmasi Password Baru<TogglePasswordInput name="confirmPassword" minLength={8} autoComplete="new-password" required value={passwords.confirmPassword} onChange={(event) => setPasswords((current) => ({ ...current, confirmPassword: event.target.value }))} /></label>
        <button className={`btn primary${busy === 'password' ? ' is-loading' : ''}`} type="submit" disabled={busy === 'password'}>{busy === 'password' ? 'Memproses...' : 'Ganti Password'}</button>
      </form>

      <form className={`settings-card admin-reset-card${me.is_admin ? '' : ' is-hidden'}`} id="adminResetPasswordForm" onSubmit={adminReset}>
        <h3>Admin Reset Password</h3>
        <p className="muted">Khusus admin. Dipakai sementara sebelum reset password via email aktif.</p>
        <label>Admin Key<TogglePasswordInput name="adminKey" autoComplete="off" required placeholder="ADMIN_RESET_KEY" value={admin.adminKey} onChange={(event) => setAdmin((current) => ({ ...current, adminKey: event.target.value }))} /></label>
        <label>Username / Email / ID Pemain<input name="identifier" required placeholder="contoh: budi123" value={admin.identifier} onChange={(event) => setAdmin((current) => ({ ...current, identifier: event.target.value }))} /></label>
        <label>Password Baru<TogglePasswordInput name="newPassword" minLength={8} autoComplete="new-password" required placeholder="Minimal 8 karakter" value={admin.newPassword} onChange={(event) => setAdmin((current) => ({ ...current, newPassword: event.target.value }))} /></label>
        <label>Konfirmasi Password Baru<TogglePasswordInput name="confirmPassword" minLength={8} autoComplete="new-password" required value={admin.confirmPassword} onChange={(event) => setAdmin((current) => ({ ...current, confirmPassword: event.target.value }))} /></label>
        <button className={`btn primary${busy === 'admin' ? ' is-loading' : ''}`} type="submit" disabled={busy === 'admin'}>{busy === 'admin' ? 'Memproses...' : 'Reset Password User'}</button>
        <small>Setelah reset berhasil, sesi login lama user otomatis dihapus.</small>
      </form>

      <article className="settings-card duel-history-card">
        <h3>Riwayat Duel</h3>
        <div id="duelHistoryList">
          {history.length ? <div className="duel-history-list">{history.map((duel) => <article className="duel-history-item" key={duel.id}><div><strong>{duelResultLabel(duelHistoryResult(duel))}</strong><small>vs {duel.opponent_name} - {new Date(duel.started_at).toLocaleString('id-ID')}</small></div><span>{fpDisplay(duel.fp_awarded || 0, { signed: true })}</span></article>)}</div> : <p className="muted">Belum ada riwayat duel.</p>}
        </div>
      </article>

      <article className="settings-card profile-stats" id="profileStats">
        <h3>Statistik Profil</h3>
        <div className="profile-stat-grid">
          <div className="copy-stat"><span>ID Pemain</span><strong>{me.given_id}</strong><button type="button" onClick={() => copyText(me.given_id, 'ID Pemain')}>Copy ID</button></div>
          <div className="copy-stat"><span>Username</span><strong>@{me.username}</strong><button type="button" onClick={() => copyText(me.username, 'Username')}>Copy Username</button></div>
          {profileStats.map(([label, value, extraClass]) => <div key={label} className={extraClass || ''}><span>{label}</span><strong>{value}</strong></div>)}
        </div>
      </article>
    </div>
  );
}

function ScoreBars({ answers, activeIndex }) {
  return (
    <div className="duel-score-bars">
      {answers.map((value, index) => {
        const stateClass = value === true ? 'is-correct' : value === false ? 'is-wrong' : value === 'pending' ? 'is-pending' : value === 'done' ? 'is-done' : index === activeIndex ? 'is-current' : '';
        return <span key={index} className={stateClass} />;
      })}
    </div>
  );
}

function DuelPage({ me, dashboard, refreshMe, onToast, playSound, setMusicMode }) {
  const [duel, setDuel] = useState(null);
  const [mode, setMode] = useState('idle');
  const [loading, setLoading] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState([]);
  const [opponentAnswers, setOpponentAnswers] = useState([]);
  const [opponentAnsweredCount, setOpponentAnsweredCount] = useState(0);
  const [remaining, setRemaining] = useState(10);
  const [locked, setLocked] = useState(false);
  const [selectedOption, setSelectedOption] = useState(null);
  const [answerResult, setAnswerResult] = useState(null);
  const [result, setResult] = useState(null);
  const [waitingMessage, setWaitingMessage] = useState('');
  const [startCountdown, setStartCountdown] = useState(null);
  const [rematchCountdown, setRematchCountdown] = useState(120);
  const [matchmakingMessage, setMatchmakingMessage] = useState('');
  const [isMatchmaking, setIsMatchmaking] = useState(false);
  const [errorPanel, setErrorPanel] = useState(null);
  const [panelEffect, setPanelEffect] = useState('');
  const answersRef = useRef([]);
  const payloadsRef = useRef([]);
  const savesRef = useRef([]);
  const questionStartedAtRef = useRef(0);
  const duelRef = useRef(null);
  // Set synchronously before React commits state. This prevents duplicate
  // matchmaking/invite events from re-initializing the same duel at question 1.
  const initializedDuelIdRef = useRef(null);
  const questionIndexRef = useRef(0);
  const matchmakingBusyRef = useRef(false);
  const serverOffsetRef = useRef(0);
  const statusBusyRef = useRef(false);
  const answerBusyRef = useRef(false);
  const submittedQuestionsRef = useRef(new Set());
  const questionDeadlineRef = useRef(0);
  const finishBusyRef = useRef(false);
  const questionRunRef = useRef(0);

  useEffect(() => { duelRef.current = duel; }, [duel]);
  useEffect(() => { questionIndexRef.current = questionIndex; }, [questionIndex]);

  const serverNowMs = () => Date.now() + Number(serverOffsetRef.current || 0);

  const resetToIdle = useCallback(() => {
    setDuel(null);
    setMode('idle');
    setLoading(false);
    setQuestionIndex(0);
    setUserAnswers([]);
    setOpponentAnswers([]);
    setOpponentAnsweredCount(0);
    setRemaining(10);
    setLocked(false);
    setSelectedOption(null);
    setAnswerResult(null);
    setResult(null);
    setWaitingMessage('');
    setStartCountdown(null);
    setRematchCountdown(120);
    setMatchmakingMessage('');
    setIsMatchmaking(false);
    setErrorPanel(null);
    setPanelEffect('');
    answersRef.current = [];
    payloadsRef.current = [];
    savesRef.current = [];
    answerBusyRef.current = false;
    submittedQuestionsRef.current.clear();
    finishBusyRef.current = false;
    initializedDuelIdRef.current = null;
    questionRunRef.current += 1;
    setMusicMode('idle');
  }, [setMusicMode]);

  const beginDuel = useCallback((nextDuel) => {
    if (!nextDuel?.id) {
      onToast('Duel tidak valid dari server. Coba mulai ulang.');
      return;
    }
    if (initializedDuelIdRef.current === nextDuel.id) return;
    initializedDuelIdRef.current = nextDuel.id;
    if (!Array.isArray(nextDuel.questions) || nextDuel.questions.length < 5) {
      setDuel(nextDuel);
      setMode('loading-duel');
      setErrorPanel(null);
      api(`/api/duel/${nextDuel.id}`).then((data) => {
        if (Array.isArray(data.duel?.questions) && data.duel.questions.length >= 5) {
          // Allow the completed payload to replace the temporary incomplete one.
          initializedDuelIdRef.current = null;
          beginDuel(data.duel);
        }
        else throw new Error('Soal duel belum lengkap dari server.');
      }).catch((error) => {
        resetToIdle();
        onToast(error.message || 'Soal duel gagal dimuat.');
      });
      return;
    }
    if (nextDuel.server_now) {
      const serverMs = new Date(nextDuel.server_now).getTime();
      if (Number.isFinite(serverMs)) serverOffsetRef.current = serverMs - Date.now();
    }
    preloadQuestionImages(nextDuel.questions);
    setDuel(nextDuel);
    const total = nextDuel.questions.length;
    setQuestionIndex(0);
    setUserAnswers(Array(total).fill(null));
    setOpponentAnswers(Array(total).fill(null));
    setOpponentAnsweredCount(0);
    answersRef.current = Array(total).fill(null);
    payloadsRef.current = [];
    savesRef.current = [];
    answerBusyRef.current = false;
    submittedQuestionsRef.current = new Set();
    finishBusyRef.current = false;
    setSelectedOption(null);
    setAnswerResult(null);
    setLocked(false);
    setResult(null);
    setWaitingMessage('');
    setErrorPanel(null);
    setIsMatchmaking(false);
    setLoading(false);
    setMusicMode('duel');
    playSound('duelStart', { overlap: true });
    const startsAt = new Date(nextDuel.starts_at || Date.now()).getTime();
    const delayMs = startsAt - serverNowMs();
    if (delayMs > 250) {
      setMode('start-countdown');
    } else {
      setMode('active');
    }
  }, [onToast, playSound, resetToIdle, setMusicMode]);

  useEffect(() => {
    const handler = (event) => {
      if (event?.detail?.id) beginDuel(event.detail);
    };
    window.addEventListener('force:duel-ready', handler);
    return () => window.removeEventListener('force:duel-ready', handler);
  }, [beginDuel]);

  const startDuel = async () => {
    if (loading || isMatchmaking) return;
    const dailyLimit = dashboard?.dailyDuelLimit || DAILY_DUEL_LIMIT;
    if ((dashboard?.duelsToday || 0) >= dailyLimit) {
      onToast(`Maaf, Anda sudah mencapai limit duel harian ${dailyLimit}/${dailyLimit}.`);
      return;
    }
    setLoading(true);
    setErrorPanel(null);
    try {
      const data = await api('/api/duel/start', { method: 'POST' });
      if (data.duel) {
        beginDuel(data.duel);
        return;
      }
      setMode('matchmaking');
      setIsMatchmaking(true);
      setMatchmakingMessage(data.message || 'Menunggu lawan online. Jangan tutup halaman ini.');
    } catch (error) {
      onToast(error.message || 'Duel gagal dimulai.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mode !== 'matchmaking' || !isMatchmaking) return undefined;
    const checkMatchmaking = async () => {
      if (document.hidden || matchmakingBusyRef.current || duelRef.current?.id) return;
      matchmakingBusyRef.current = true;
      try {
        const data = await api('/api/duel/matchmaking/status');
        if (data.duel) {
          setMatchmakingMessage('Lawan telah ditemukan. Mohon tunggu sebentar sebelum duel dimulai.');
          setIsMatchmaking(false);
          beginDuel(data.duel);
        } else if (data.matching) {
          setMatchmakingMessage('Lawan ketemu, mohon tunggu sebentar. Arena duel sedang disiapkan.');
        } else if (data.cancelled) {
          resetToIdle();
          onToast('Pencarian lawan telah berakhir. Silakan coba kembali.');
        }
      } catch (error) {
        onToast(error.message || 'Status matchmaking gagal dimuat.');
      } finally {
        matchmakingBusyRef.current = false;
      }
    };
    checkMatchmaking();
    const timer = setInterval(checkMatchmaking, 2500);
    return () => clearInterval(timer);
  }, [beginDuel, isMatchmaking, mode, onToast, resetToIdle]);

  const cancelMatchmaking = async () => {
    setLoading(true);
    try {
      const data = await api('/api/duel/matchmaking/cancel', { method: 'POST' });
      if (data.alreadyMatched) {
        setMatchmakingMessage('Lawan telah ditemukan. Menyiapkan arena...');
        const status = await api('/api/duel/matchmaking/status');
        if (status.duel) beginDuel(status.duel);
        return;
      }
      resetToIdle();
      onToast('Pencarian lawan dibatalkan.');
    } catch (error) {
      onToast(error.message || 'Pembatalan gagal. Pencarian masih dilanjutkan.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mode !== 'start-countdown' || !duel?.starts_at) return undefined;
    const tick = () => {
      const left = Math.max(0, Math.ceil((new Date(duel.starts_at).getTime() - serverNowMs()) / 1000));
      setStartCountdown(left);
      if (left > 0) playSound('matchBeep', { overlap: true });
      if (left <= 0) {
        setMode('active');
        setStartCountdown(null);
        playSound('matchStart', { overlap: true });
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [duel?.starts_at, mode, playSound]);

  useEffect(() => {
    if (mode !== 'active' || !duel?.questions?.[questionIndex]?.id || locked) return undefined;
    const questionRun = ++questionRunRef.current;
    questionStartedAtRef.current = performance.now();
    questionDeadlineRef.current = performance.now() + 10000;
    setRemaining(10);
    setSelectedOption(null);
    setAnswerResult(null);
    let lastShown = 10;
    const timer = setInterval(() => {
      // Keep the displayed time still while the server checks the answer.
      // Every next question receives a fresh 10-second deadline.
      if (answerBusyRef.current) return;
      const next = Math.max(0, Math.ceil((questionDeadlineRef.current - performance.now()) / 1000));
      if (next !== lastShown) {
        lastShown = next;
        setRemaining(next);
        if (next > 0) playSound('tick');
      }
      if (next <= 0) {
        clearInterval(timer);
        if (questionRunRef.current === questionRun) answerQuestion(null);
      }
    }, 100);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, duel?.id, questionIndex]);

  const currentQuestion = duel?.questions?.[questionIndex];
  const totalQuestions = duel?.questions?.length || 5;
  const userCorrect = userAnswers.filter((value) => value === true).length;
  const opponentVisible = opponentAnswers.slice(0, totalQuestions).filter((value) => value !== null);
  const opponentCorrect = opponentVisible.filter((value) => value === true).length;
  const userDone = userAnswers.filter((value) => value === true || value === false || value === 'done').length;
  const opponentDone = Math.min(opponentAnsweredCount, totalQuestions);
  const userActiveIndex = userDone >= totalQuestions ? -1 : Math.min(userDone, totalQuestions - 1);
  const opponentActiveIndex = opponentDone >= totalQuestions ? -1 : Math.min(opponentDone, totalQuestions - 1);

  const answerQuestion = async (option) => {
    const activeDuel = duelRef.current;
    const qIndex = questionIndexRef.current;
    const question = activeDuel?.questions?.[qIndex];
    if (!activeDuel?.id || !question?.id || answerBusyRef.current || submittedQuestionsRef.current.has(question.id)) return;
    answerBusyRef.current = true;
    submittedQuestionsRef.current.add(question.id);
    setLocked(true);
    setSelectedOption(option);
    setAnswerResult(null);
    // Show ordered progress immediately while the server validates correctness.
    answersRef.current[qIndex] = 'pending';
    setUserAnswers([...answersRef.current]);
    const payload = {
      duelId: activeDuel.id,
      questionId: question.id,
      selectedOption: option,
    };

    let isCorrect = false;
    try {
      const saved = await api('/api/duel/answer', { method: 'POST', body: payload });
      isCorrect = Boolean(saved.isCorrect);
      setAnswerResult(isCorrect);
      answersRef.current[qIndex] = isCorrect;
      setUserAnswers([...answersRef.current]);
      if (saved.status?.opponentAnswered !== undefined) setOpponentAnsweredCount(saved.status.opponentAnswered || 0);
      playSound(isCorrect ? 'correct' : 'wrong');
    } catch (error) {
      answersRef.current[qIndex] = null;
      setUserAnswers([...answersRef.current]);
      answerBusyRef.current = false;
      submittedQuestionsRef.current.delete(question.id);
      setMode('sync-error');
      setErrorPanel(error.message || 'Jawaban gagal disimpan. Coba lagi.');
      return;
    }

    setTimeout(async () => {
      if (questionIndexRef.current !== qIndex || duelRef.current?.id !== activeDuel.id) return;
      if (qIndex + 1 >= activeDuel.questions.length) {
        await finishDuel();
      } else {
        const nextIndex = qIndex + 1;
        questionIndexRef.current = Math.max(questionIndexRef.current, nextIndex);
        setQuestionIndex((current) => Math.max(current, nextIndex));
        answerBusyRef.current = false;
        setLocked(false);
        setSelectedOption(null);
        setAnswerResult(null);
      }
    }, 220);
  };

  const flushSaves = async () => {
    // Supabase-only mode writes each answer immediately through the API.
    // This hook is kept for compatibility with older pending-save flows.
    return true;
  };

  const finishDuel = async ({ fromStatus = false } = {}) => {
    const activeDuel = duelRef.current;
    if (!activeDuel?.id || finishBusyRef.current) return;
    finishBusyRef.current = true;
    setMode('finishing');
    setWaitingMessage(fromStatus ? 'Sinkronisasi hasil dari lawan...' : 'Jawaban kamu sedang disimpan. Mohon tunggu sebentar.');
    try {
      await flushSaves();
      const data = await api('/api/duel/finish', { method: 'POST', body: { duelId: activeDuel.id } });
      if (data.waiting) {
        finishBusyRef.current = false;
        setMode('waiting');
        setWaitingMessage('Hasil akan muncul otomatis setelah lawan selesai menjawab.');
        return;
      }
      setResult(data.result);
      setMode('result');
      refreshMe().catch(() => {});
      const effect = data.result?.result === 'win' ? 'win-glow' : data.result?.result === 'lose' ? 'loss-shake' : '';
      setPanelEffect(effect);
      if (data.result?.result === 'win') playSound('win', { overlap: true });
      if (data.result?.result === 'lose') playSound('lose', { overlap: true });
      setRematchCountdown(120);
    } catch (error) {
      finishBusyRef.current = false;
      setMode('sync-error');
      setErrorPanel(error.message || 'Hasil duel belum bisa disimpan.');
    }
  };

  useEffect(() => {
    if (!duel?.id || !['active', 'waiting', 'finishing'].includes(mode)) return undefined;
    let stopped = false;

    const applyStatus = async (status) => {
      if (!status || stopped) return;
      setOpponentAnsweredCount(status.opponentAnswered || 0);
      if (Array.isArray(status.opponentAnswers) && status.opponentAnswers.length) {
        setOpponentAnswers((current) => {
          const next = [...current];
          status.opponentAnswers.forEach((answer) => {
            const index = duelRef.current?.questions?.findIndex((question) => question.id === answer.questionId) ?? -1;
            if (index >= 0) next[index] = Boolean(answer.isCorrect);
          });
          return next;
        });
      }
      if (status.status === 'finished') await finishDuel({ fromStatus: true });
    };

    const checkStatus = async () => {
      if (document.hidden || statusBusyRef.current || stopped) return;
      statusBusyRef.current = true;
      try {
        const data = await api(`/api/duel/${duel.id}/status`);
        if (data?.status) await applyStatus(data.status);
      } catch {
        // Status polling errors should not interrupt the player while answering.
      } finally {
        statusBusyRef.current = false;
      }
    };

    checkStatus();
    const timer = setInterval(checkStatus, 2500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duel?.id, mode]);

  useEffect(() => {
    if (mode !== 'result') return undefined;
    const timer = setInterval(() => {
      setRematchCountdown((current) => {
        if (current <= 1) {
          resetToIdle();
          return 120;
        }
        return current - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [mode, resetToIdle]);

  const progress = Math.max(0, Math.min(100, remaining * 10));
  const resultTitle = result?.result === 'win' ? 'Menang' : result?.result === 'lose' ? 'Kalah' : 'Draw';
  const resultMessage = result?.result === 'win' ? 'Congrats, keep calling out your best.' : result?.result === 'lose' ? 'Keep growing until you win.' : 'Draw today, grow stronger for the next duel.';
  const nextLifetimeFp = Number(me.lifetime_fp || 0) + Number(result?.fpAwarded || 0);
  const nextWeeklyFp = Number(me.weekly_fp || 0) + Number(result?.fpAwarded || 0);

  return (
    <article className={`duel-panel ${panelEffect}`} id="duelPanel">
      <div className="duel-top">
        <div className="fighter">
          <AvatarRing user={me} id="duelUserAvatarWrap" />
          <div className="fighter-meta">
            <strong id="duelUserName">{me.username}</strong>
            <span id="duelUserScore">{mode === 'result' && result ? `${result.userScore} poin` : `${userCorrect} benar · Soal ${userDone >= totalQuestions ? totalQuestions : userDone + (mode === 'active' ? 1 : 0)}/${totalQuestions}`}</span>
            <ScoreBars answers={userAnswers.length ? userAnswers : Array(totalQuestions).fill(null)} activeIndex={userActiveIndex} />
          </div>
        </div>
        <div className="duel-centerpiece">
          <img className={`duel-top-logo${mode === 'active' ? ' is-hidden' : ''}`} id="duelTopLogo" src="/image/logoduel.png" alt="FORCE Duel" />
          <div className={`timer-ring${mode === 'active' ? '' : ' is-hidden'}`} style={{ '--progress': `${progress}%` }}><span id="timerValue">{remaining}</span><small>detik</small></div>
        </div>
        <div className="fighter right">
          <AvatarRing user={{ id: duel?.opponent_id, username: duel?.opponent_name, gender: duel?.opponent_gender }} id="duelOpponentAvatarWrap" />
          <div className="fighter-meta">
            <strong id="duelOpponentName">{duel?.opponent_name || 'Opponent'}</strong>
            <span id="duelOpponentScore">{mode === 'result' && result ? `${result.opponentScore} poin` : `${opponentCorrect} benar · Soal ${opponentDone >= totalQuestions ? totalQuestions : opponentDone + (mode === 'active' ? 1 : 0)}/${totalQuestions}`}</span>
            <ScoreBars answers={opponentAnswers.length ? opponentAnswers : Array(totalQuestions).fill(null)} activeIndex={opponentActiveIndex} />
          </div>
        </div>
      </div>

      {mode === 'idle' ? (
        <div id="duelIdle" className="duel-idle">
          <h1>ARE YOU READY?</h1>
          <p id="duelLimitText">Maksimal {dashboard?.dailyDuelLimit || DAILY_DUEL_LIMIT} duel per hari. Setiap duel berisi 5 pertanyaan, masing-masing 10 detik.</p>
          <button className={`btn primary${loading ? ' is-loading' : ''}`} id="startDuelBtn" type="button" disabled={loading} onClick={startDuel}>{loading ? 'Mencari lawan...' : 'Mulai Duel'}</button>
        </div>
      ) : null}

      {mode === 'active' && currentQuestion ? (
        <div id="duelActive" className="duel-active">
          <div className="duel-meta"><span id="questionCounter">Soal {questionIndex + 1}/{duel.questions.length}</span><span id="questionCategory">{currentQuestion.category}</span></div>
          <h2 id="questionText" className={isValidQuestionImageUrl(currentQuestion.image_url) ? 'has-question-image' : ''}>
            {isValidQuestionImageUrl(currentQuestion.image_url) ? <div className="question-image-wrap"><img className="question-image" src={currentQuestion.image_url} alt="Gambar soal" loading="eager" decoding="async" fetchPriority="high" /></div> : null}
            <span className="question-copy">{currentQuestion.question}</span>
          </h2>
          <div className="answers-grid" id="answersGrid">
            {['A', 'B', 'C', 'D'].map((key) => (
              <button key={key} className={`answer-btn${selectedOption === key ? ' is-selected' : ''}${locked && selectedOption === key && answerResult === true ? ' correct' : ''}${locked && selectedOption === key && answerResult === false ? ' wrong' : ''}`} type="button" disabled={locked} onClick={() => answerQuestion(key)}>
                <strong>{key}</strong><span>{currentQuestion[`option_${key.toLowerCase()}`]}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {mode === 'matchmaking' ? <div id="duelResult" className="duel-result"><LoadingOrb /><p className="eyebrow">Ruang Tunggu</p><h1>Mencari Lawan...</h1><p className="result-copy">{matchmakingMessage}</p><div className="duel-result-actions"><button className={`btn secondary${loading ? ' is-loading' : ''}`} type="button" onClick={cancelMatchmaking}>Batalkan</button></div></div> : null}
      {mode === 'start-countdown' ? <div id="duelResult" className="duel-result"><p className="eyebrow">Lawan ditemukan</p><h1>Mulai dalam {startCountdown ?? 5}</h1><p className="result-copy">Lawan telah ditemukan. Mohon tunggu sebentar sebelum pertanyaan dimulai.</p></div> : null}
      {mode === 'loading-duel' ? <div id="duelResult" className="duel-result"><LoadingOrb /><p className="eyebrow">Memuat duel</p><h1>Loading...</h1><p className="result-copy">Soal sedang disinkronkan ulang dari server.</p></div> : null}
      {['finishing', 'waiting'].includes(mode) ? <div id="duelResult" className="duel-result"><LoadingOrb /><p className="eyebrow">{mode === 'waiting' ? 'Menunggu lawan' : 'Duel selesai'}</p><h1>{mode === 'waiting' ? 'Jawaban kamu tersimpan' : 'Loading...'}</h1><p className="result-copy">{waitingMessage}</p></div> : null}
      {mode === 'sync-error' ? <div id="duelResult" className="duel-result"><p className="eyebrow">Duel belum selesai</p><h1>Gagal Sync</h1><p className="result-copy">{errorPanel}</p><div className="duel-result-actions"><button className="btn primary" type="button" onClick={() => finishDuel()}>Coba Lagi</button><button className="btn secondary" type="button" onClick={resetToIdle}>Kembali ke Beranda</button></div></div> : null}
      {mode === 'result' && result ? (
        <div id="duelResult" className="duel-result">
          <div className="point-orb"><span>{fpDisplay(result.fpAwarded, { signed: true })}</span><small>Force Points</small></div>
          <p className="eyebrow">Duel selesai</p>
          <h1>{resultTitle}</h1>
          <p className="result-copy">{resultMessage}</p>
          <div className="duel-result-grid">
            <article className="duel-result-card"><span>Poin Kamu</span><strong>{result.userScore}</strong></article>
            <article className="duel-result-card"><span>Poin Lawan</span><strong>{result.opponentScore}</strong></article>
            <article className="duel-result-card"><span>Lifetime FP</span><strong>{fpDisplay(nextLifetimeFp)}</strong></article>
            <article className="duel-result-card"><span>Weekly FP</span><strong>{fpDisplay(nextWeeklyFp)}</strong></article>
          </div>
          <div className="duel-result-actions"><button className="btn primary" type="button" onClick={() => { resetToIdle(); startDuel(); }}>Cari Lawan Baru ({rematchCountdown})</button><button className="btn secondary" type="button" onClick={resetToIdle}>Kembali ke Beranda</button></div>
        </div>
      ) : null}
    </article>
  );
}

export default function ForceApp() {
  const [booting, setBooting] = useState(true);
  const [me, setMe] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [schoolFeature, setSchoolFeature] = useState(null);
  const [page, setPage] = useState('home');
  const [toastMessage, setToastMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [requests, setRequests] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const seenRequestsRef = useRef(new Set());
  const acceptedRequestsRef = useRef(new Set());
  const toastTimerRef = useRef(null);
  const { playSound, playButton, setMusicMode, stopMusic } = useAudio(me?.settings);

  const showToast = useCallback((message, sound = 'notif') => {
    setToastMessage(message || '');
    if (sound) playSound(sound, { overlap: true });
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(''), 3300);
  }, [playSound]);

  const refreshMe = useCallback(async () => {
    const data = await api('/api/me');
    setMe(data.user);
    setDashboard(data.dashboard);
    return data;
  }, []);

  const loadSchoolFeature = useCallback(async () => {
    if (!me?.id) return null;
    try {
      const data = await api('/api/schools/active');
      const next = data?.available ? data : null;
      setSchoolFeature(next);
      return next;
    } catch {
      setSchoolFeature(null);
      return null;
    }
  }, [me?.id]);

  const restoreSession = useCallback(async () => {
    try {
      await refreshMe();
      setPage('home');
    } catch {
      setMe(null);
      setDashboard(null);
    } finally {
      setBooting(false);
    }
  }, [refreshMe]);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    if (!me?.id) {
      setSchoolFeature(null);
      return undefined;
    }
    loadSchoolFeature();
    const timer = window.setInterval(loadSchoolFeature, 60_000);
    return () => window.clearInterval(timer);
  }, [loadSchoolFeature, me?.id]);

  useEffect(() => {
    if (!schoolFeature?.visibleUntil) return;
    if (new Date(schoolFeature.visibleUntil).getTime() > Date.now()) return;
    setSchoolFeature(null);
    if (page === 'schools') setPage('home');
  }, [page, schoolFeature?.visibleUntil, tick]);

  useEffect(() => {
    const timer = setInterval(() => setTick((current) => current + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const login = async (payload) => {
    await api('/api/auth/login', { method: 'POST', body: payload });
    await refreshMe();

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('force:session-login'));
    }

    setPage('home');
    setMusicMode('idle');
  };

  const register = async (payload) => {
    await api('/api/auth/register', { method: 'POST', body: payload });
  };

  const logout = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // Continue local logout anyway.
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('force:session-logout'));
    }

    stopMusic();
    setMe(null);
    setDashboard(null);
    setSchoolFeature(null);
    setRequests([]);
    setOutgoing([]);
    setPage('home');
  };

  const respondRequest = useCallback(async (requestId, action = 'accept') => {
    playButton();
    try {
      const data = await api(`/api/duel-requests/${requestId}/respond`, { method: 'POST', body: { action } });
      const loaded = await api('/api/duel-requests');
      const receivedAt = Date.now();
      setRequests((loaded.requests || []).map((request) => ({ ...request, received_at_ms: receivedAt })));
      setOutgoing((loaded.outgoing || []).map((request) => ({ ...request, received_at_ms: receivedAt })));
      if (data.duel?.status === 'active') {
        setPage('duel');
        window.dispatchEvent(new CustomEvent('force:duel-ready', { detail: data.duel }));
        showToast('Duel diterima. Masuk ke Arena Duel.', 'duelNotif');
      }
    } catch (error) {
      showToast(error.message || 'Respon request gagal.');
    }
  }, [playButton, showToast]);

  const loadRequests = useCallback(async ({ notify = false } = {}) => {
    if (!me?.id) return;
    try {
      const data = await api('/api/duel-requests');
      const receivedAt = Date.now();
      const incoming = (data.requests || []).map((request) => ({ ...request, received_at_ms: receivedAt }));
      const outgoingRows = (data.outgoing || []).map((request) => ({ ...request, received_at_ms: receivedAt }));
      if (notify) {
        for (const request of incoming) {
          if (!seenRequestsRef.current.has(request.id)) {
            seenRequestsRef.current.add(request.id);
            showToast(`@${request.requester_username || 'member'} mengajak kamu duel.`, 'duelNotif');
          }
        }
        for (const request of outgoingRows) {
          if (request.status === 'accepted' && request.duel_id && !acceptedRequestsRef.current.has(request.id)) {
            acceptedRequestsRef.current.add(request.id);
            showToast(`${request.target_username} menerima duel. Buka halaman Duel.`, 'duelNotif');
            setPage('duel');
            api(`/api/duel/${request.duel_id}`).then((payload) => {
              if (payload.duel?.id) window.dispatchEvent(new CustomEvent('force:duel-ready', { detail: payload.duel }));
            }).catch(() => {});
          }
        }
      }
      setRequests(incoming);
      setOutgoing(outgoingRows);
    } catch {
      // Request watcher should stay quiet when network briefly fails.
    }
  }, [me?.id, showToast]);

  useEffect(() => {
    if (!me?.id) return undefined;
    loadRequests({ notify: false });
    const tickRequests = () => {
      if (!document.hidden) loadRequests({ notify: true });
    };
    const timer = setInterval(tickRequests, 12000);
    const handleVisible = () => {
      if (!document.hidden) loadRequests({ notify: true });
    };
    document.addEventListener('visibilitychange', handleVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisible);
    };
  }, [loadRequests, me?.id]);

  useEffect(() => {
    document.body.classList.toggle('sidebar-open', sidebarOpen);
    const close = (event) => {
      if (!event.target.closest?.('.sidebar') && !event.target.closest?.('#mobileMenuBtn')) setSidebarOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [sidebarOpen]);

  const visibleRequests = useMemo(() => requests.map((request) => ({ ...request, _tick: tick })), [requests, tick]);
  const visibleOutgoing = useMemo(() => outgoing.map((request) => ({ ...request, _tick: tick })), [outgoing, tick]);

  return (
    <>
      <div className="ambient-bg" aria-hidden="true" />
      <BootLoader hidden={!booting} />
      <Toast message={toastMessage} />
      <canvas id="confettiCanvas" aria-hidden="true" />

      {!me ? (
        <AuthView hidden={booting} onLogin={login} onRegister={register} onToast={showToast} busy={busy} setBusy={setBusy} playButton={playButton} />
      ) : (
        <AppShell me={me} dashboard={dashboard || {}} page={page} setPage={setPage} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} playButton={playButton} schoolFeature={schoolFeature}>
          <PageFrame name="schools" active={page === 'schools'}><ForceSchoolsPage me={me} feature={schoolFeature} onFeatureRefresh={loadSchoolFeature} refreshMe={refreshMe} onToast={showToast} playButton={playButton} /></PageFrame>
          <PageFrame name="home" active={page === 'home'}><HomePage me={me} dashboard={dashboard || {}} schoolFeature={schoolFeature} setPage={setPage} playButton={playButton} /></PageFrame>
          <PageFrame name="duel" active={page === 'duel'}><DuelPage me={me} dashboard={dashboard || {}} refreshMe={refreshMe} onToast={showToast} playSound={playSound} setMusicMode={setMusicMode} /></PageFrame>
          <PageFrame name="members" active={page === 'members'}><MembersPage requests={visibleRequests} outgoing={visibleOutgoing} onRespond={respondRequest} onToast={showToast} playButton={playButton} /></PageFrame>
          <PageFrame name="leaderboard" active={page === 'leaderboard'}><LeaderboardPage onToast={showToast} /></PageFrame>
          <PageFrame name="shops" active={page === 'shops'}><ForceShopsPage me={me} refreshMe={refreshMe} onToast={showToast} playButton={playButton} /></PageFrame>
          <PageFrame name="about" active={page === 'about'}><AboutPage dashboard={dashboard || {}} /></PageFrame>
          <PageFrame name="settings" active={page === 'settings'}><SettingsPage me={me} dashboard={dashboard || {}} refreshMe={refreshMe} onToast={showToast} onLogout={logout} playButton={playButton} /></PageFrame>
        </AppShell>
      )}
    </>
  );
}
