'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const DEFAULT_COMMUNITY_URL = 'https://chat.whatsapp.com/EsJQlvGeXVq1hZrxBvB465';

function sanitizeSchoolInviteCode(value = '') {
  return String(value || '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 32);
}

async function featureApi(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new Error('Koneksi ke server gagal. Periksa internet lalu coba lagi.');
  }

  const raw = await response.text().catch(() => '');
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) throw new Error(payload.error || payload.message || `Request gagal (${response.status}).`);
  return payload;
}

function fp(value) {
  return (
    <span className="fp-chip">
      <span className="fp-value">{Number(value || 0).toLocaleString('id-ID')}</span>
      <span className="fp-diamond" aria-hidden="true" />
    </span>
  );
}

function SchoolLoading({ title = 'Menghitung hasilmu', detail = 'Ketepatan, kecepatan, dan konversi Force Points sedang diproses.' }) {
  return (
    <div className="school-calculating" aria-live="polite">
      <div className="school-result-orb" aria-hidden="true"><span /></div>
      <p className="eyebrow">FORCE GO TO SCHOOLS</p>
      <h2>{title}</h2>
      <p>{detail}</p>
      <div className="school-loading-steps">
        <span>Memeriksa ketepatan</span>
        <span>Mengukur kecepatan</span>
        <span>Mengonversi ke FP</span>
        <span>Menentukan peringkat</span>
      </div>
    </div>
  );
}

function SchoolLeaderboard({ data, loading, meId }) {
  const rows = data?.rows || [];
  return (
    <section className="school-leaderboard-card">
      <div className="school-section-title">
        <div>
          <p className="eyebrow">LIVE LEADERBOARD</p>
          <h2>10 Peringkat Teratas</h2>
        </div>
        <span className={`school-live-pill${loading ? ' is-loading' : ''}`}><i />Refresh 10 detik</span>
      </div>

      <div className="school-leaderboard-head">
        <span>Rank</span><span>Peserta</span><span>Benar</span><span>Poin</span>
      </div>
      <div className="school-leaderboard-list">
        {rows.length ? rows.map((row) => (
          <article key={row.userId} className={`school-rank-row rank-${row.rank}${row.userId === meId ? ' is-me' : ''}`}>
            <strong>#{row.rank}</strong>
            <span><b>@{row.username}</b><small>{row.name || 'FORCE Warrior'}{row.userId === meId ? ' · Kamu' : ''}</small></span>
            <b>{row.correctCount}/{data.totalQuestions || 10}</b>
            <strong>{Number(row.score || 0).toLocaleString('id-ID')}</strong>
          </article>
        )) : <p className="school-empty">Belum ada peserta yang menyelesaikan simulasi.</p>}
      </div>

      {data?.me && !rows.some((row) => row.userId === data.me.userId) ? (
        <article className="school-rank-row school-my-rank is-me">
          <strong>#{data.me.rank}</strong>
          <span><b>@{data.me.username}</b><small>Posisimu saat ini</small></span>
          <b>{data.me.correctCount}/{data.totalQuestions || 10}</b>
          <strong>{Number(data.me.score || 0).toLocaleString('id-ID')}</strong>
        </article>
      ) : null}
    </section>
  );
}

export function ForceSchoolsPage({ me, feature, onFeatureRefresh, refreshMe, onToast, playButton }) {
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [eventInfo, setEventInfo] = useState(feature?.event || null);
  const [codeError, setCodeError] = useState('');
  const [phase, setPhase] = useState(feature?.result ? 'result' : feature?.attemptStatus === 'active' ? 'resume' : 'code');
  const [quiz, setQuiz] = useState(null);
  const [answerBusy, setAnswerBusy] = useState(false);
  const [selectedOption, setSelectedOption] = useState('');
  const [answerState, setAnswerState] = useState('');
  const [result, setResult] = useState(feature?.result || null);
  const [leaderboard, setLeaderboard] = useState(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const timeoutSubmittedRef = useRef(false);
  const submittingRef = useRef(false);
  const resultTimerRef = useRef(null);
  const feedbackTimerRef = useRef(null);

  const normalizedCode = useMemo(() => sanitizeSchoolInviteCode(code), [code]);

  useEffect(() => {
    if (!feature?.available) return;
    if (feature.result) {
      setResult(feature.result);
      if (feature.result.event) setEventInfo(feature.result.event);
      setQuiz(null);
      setPhase('result');
      return;
    }
    if (feature.attemptStatus === 'active' && !['quiz', 'calculating', 'result'].includes(phase)) {
      if (feature.event) setEventInfo(feature.event);
      setPhase('resume');
    }
  }, [feature?.attemptStatus, feature?.available, feature?.event, feature?.result, phase]);

  useEffect(() => {
    if (!['code', 'ready'].includes(phase)) return undefined;
    if (normalizedCode.length < 6) {
      setCodeError('');
      setChecking(false);
      if (phase === 'ready') setPhase('code');
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setChecking(true);
      setCodeError('');
      try {
        const data = await featureApi('/api/schools/verify', { method: 'POST', body: { code: normalizedCode } });
        if (cancelled) return;
        setEventInfo(data.event);
        setPhase('ready');
      } catch (error) {
        if (cancelled) return;
        setPhase('code');
        setCodeError(error.message || 'Kode sekolah tidak valid.');
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 420);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [normalizedCode, phase]);

  const fetchLeaderboard = useCallback(async (eventId, silent = false) => {
    if (!eventId) return;
    if (!silent) setLeaderboardLoading(true);
    try {
      const data = await featureApi(`/api/schools/leaderboard?eventId=${encodeURIComponent(eventId)}`);
      setLeaderboard(data);
    } catch (error) {
      if (!silent) onToast(error.message || 'Leaderboard sekolah gagal dimuat.');
    } finally {
      if (!silent) setLeaderboardLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    const eventId = result?.event?.id || eventInfo?.id;
    if (!eventId || phase !== 'result') return undefined;
    fetchLeaderboard(eventId);
    const timer = window.setInterval(() => fetchLeaderboard(eventId, true), 10_000);
    return () => window.clearInterval(timer);
  }, [eventInfo?.id, fetchLeaderboard, phase, result?.event?.id]);

  const openFinishedResult = useCallback((payload, animate = true) => {
    setQuiz(null);
    submittingRef.current = false;
    setAnswerBusy(false);
    setSelectedOption('');
    setAnswerState('');
    setResult(payload.result);
    window.clearTimeout(resultTimerRef.current);
    if (animate) {
      setPhase('calculating');
      resultTimerRef.current = window.setTimeout(() => setPhase('result'), 1500);
    } else {
      setPhase('result');
    }
    refreshMe?.().catch(() => {});
    onFeatureRefresh?.();
  }, [onFeatureRefresh, refreshMe]);

  useEffect(() => () => {
    window.clearTimeout(resultTimerRef.current);
    window.clearTimeout(feedbackTimerRef.current);
  }, []);

  const startSchool = async () => {
    playButton();
    setAnswerBusy(true);
    submittingRef.current = true;
    try {
      const data = await featureApi('/api/schools/start', { method: 'POST', body: { code: normalizedCode } });
      if (data.finished) {
        openFinishedResult(data);
        return;
      }
      setQuiz(data);
      setEventInfo(data.event);
      setResult(null);
      setSelectedOption('');
      setAnswerState('');
      timeoutSubmittedRef.current = false;
      setPhase('quiz');
    } catch (error) {
      onToast(error.message || 'Simulasi tidak dapat dimulai.');
    } finally {
      submittingRef.current = false;
      setAnswerBusy(false);
    }
  };

  const resumeSchool = async () => {
    playButton();
    setAnswerBusy(true);
    submittingRef.current = true;
    try {
      const data = await featureApi('/api/schools/resume');
      if (data.finished) {
        openFinishedResult(data, false);
        return;
      }
      setQuiz(data);
      setEventInfo(data.event);
      setSelectedOption('');
      setAnswerState('');
      timeoutSubmittedRef.current = false;
      setPhase('quiz');
    } catch (error) {
      onToast(error.message || 'Simulasi tidak dapat dilanjutkan.');
    } finally {
      submittingRef.current = false;
      setAnswerBusy(false);
    }
  };

  const submitAnswer = useCallback(async (option) => {
    if (!quiz?.attemptId || !quiz?.question?.id || submittingRef.current) return;
    submittingRef.current = true;
    setAnswerBusy(true);
    setSelectedOption(option);
    try {
      const data = await featureApi('/api/schools/answer', {
        method: 'POST',
        body: { attemptId: quiz.attemptId, questionId: quiz.question.id, option },
      });
      setAnswerState(data.wasCorrect ? 'correct' : 'wrong');
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = window.setTimeout(() => {
        if (data.finished) {
          openFinishedResult(data);
          return;
        }
        setQuiz(data);
        setSelectedOption('');
        setAnswerState('');
        timeoutSubmittedRef.current = false;
        submittingRef.current = false;
        setAnswerBusy(false);
      }, 40);
    } catch (error) {
      submittingRef.current = false;
      setAnswerBusy(false);
      onToast(error.message || 'Jawaban gagal disimpan.');
    }
  }, [onToast, openFinishedResult, quiz]);

  useEffect(() => {
    if (phase !== 'quiz' || !quiz?.questionStartedAt || !quiz?.timeLimitMs) return undefined;
    timeoutSubmittedRef.current = false;
    const tick = () => {
      const left = Math.max(0, new Date(quiz.questionStartedAt).getTime() + Number(quiz.timeLimitMs) - Date.now());
      setRemainingMs(left);
      if (left <= 0 && !timeoutSubmittedRef.current && !submittingRef.current) {
        timeoutSubmittedRef.current = true;
        submitAnswer('');
      }
    };
    tick();
    const timer = window.setInterval(tick, 80);
    return () => window.clearInterval(timer);
  }, [phase, quiz?.question?.id, quiz?.questionStartedAt, quiz?.timeLimitMs, submitAnswer]);

  const progress = quiz ? Math.max(0, Math.min(100, ((Number(quiz.index || 1) - 1) / Number(quiz.total || 10)) * 100)) : 0;
  const timerPercent = quiz?.timeLimitMs ? Math.max(0, Math.min(100, (remainingMs / Number(quiz.timeLimitMs)) * 100)) : 0;
  const communityUrl = result?.event?.whatsappUrl || eventInfo?.whatsappUrl || DEFAULT_COMMUNITY_URL;

  return (
    <div className="school-page">
      <section className="school-hero">
        <div className="school-hero-copy">
          <span className="school-spark-label">SPECIAL SCHOOL EXPERIENCE</span>
          <h1>FORCE<br /><em>Go to Schools</em></h1>
          <p>Satu sekolah, satu set pertanyaan, satu kesempatan untuk menunjukkan ketepatan dan kecepatan terbaikmu.</p>
        </div>
        <div className="school-hero-mark" aria-hidden="true"><span>10</span><small>CHALLENGES</small></div>
      </section>

      {phase === 'resume' ? (
        <section className="school-entry-card school-resume-card">
          <div className="school-step-number">↻</div>
          <div className="school-entry-copy">
            <p className="eyebrow">SIMULASI BELUM SELESAI</p>
            <h2>Lanjutkan dari nomor terakhir</h2>
            <p>Sistem menyimpan progresmu. Tekan tombol di bawah untuk melanjutkan tanpa memasukkan kode lagi.</p>
          </div>
          <button className={`school-start-button${answerBusy ? ' is-loading' : ''}`} type="button" disabled={answerBusy} onClick={resumeSchool}>
            <span>{answerBusy ? 'Menyiapkan...' : 'Lanjutkan Simulasi'}</span><b>→</b>
          </button>
        </section>
      ) : null}

      {['code', 'ready'].includes(phase) ? (
        <section className="school-entry-card">
          <div className="school-step-number">01</div>
          <div className="school-entry-copy">
            <p className="eyebrow">INVITATION ACCESS</p>
            <h2>Masukkan kode sekolah</h2>
            <p>Isi kode yang dibagikan oleh pembicara.</p>
          </div>
          <label className={`school-code-field${phase === 'ready' && eventInfo ? ' is-valid' : ''}${codeError ? ' is-invalid' : ''}`}>
            <span>Kode Undangan</span>
            <input
              value={code}
              onChange={(event) => setCode(sanitizeSchoolInviteCode(event.target.value))}
              maxLength={32}
              autoComplete="off"
              autoCapitalize="characters"
              inputMode="text"
              placeholder=""
              spellCheck={false}
              aria-label="Kode undangan sekolah"
              aria-describedby="schoolCodeMessage"
            />
            <small id="schoolCodeMessage">{checking ? 'Memeriksa kode...' : phase === 'ready' && eventInfo ? `Kode aktif untuk ${eventInfo.schoolName}` : codeError || 'ISI KODE YANG DIBAGIKAN OLEH PEMBICARA'}</small>
          </label>

          {phase === 'ready' && eventInfo ? (
            <article className="school-ready-panel">
              <div>
                <span>KODE BERHASIL DIVERIFIKASI</span>
                <h3>{eventInfo.schoolName}</h3>
                <p>{eventInfo.name}</p>
              </div>
              <div className="school-ready-facts">
                <span><b>{eventInfo.totalQuestions || 10}</b> Pertanyaan</span>
                <span><b>{Math.round((eventInfo.timeLimitMs || 10000) / 1000)}s</b> Per Nomor</span>
                <span><b>1x</b> Kesempatan</span>
              </div>
              <button className={`school-start-button${answerBusy ? ' is-loading' : ''}`} type="button" disabled={answerBusy} onClick={startSchool}>
                <span>{answerBusy ? 'Menyiapkan...' : 'Mulai Sekarang'}</span><b>→</b>
              </button>
            </article>
          ) : null}
        </section>
      ) : null}

      {phase === 'quiz' && quiz?.question ? (
        <section className="school-quiz-shell" aria-busy={answerBusy}>
          <div className="school-quiz-top">
            <div>
              <p className="eyebrow">{quiz.event?.schoolName}</p>
              <strong>Nomor {quiz.index} dari {quiz.total}</strong>
            </div>
            <div className="school-timer"><span>{Math.max(0, remainingMs / 1000).toFixed(1)}</span><small>detik</small></div>
          </div>
          <div className="school-progress-track"><span style={{ width: `${progress}%` }} /></div>
          <div className="school-timer-track"><span style={{ width: `${timerPercent}%` }} /></div>

          <article className="school-question-card">
            <span className="school-question-number">{String(quiz.index).padStart(2, '0')}</span>
            {quiz.question.image_url ? (
              <div className="school-question-image"><img src={quiz.question.image_url} alt="Ilustrasi pertanyaan" loading="eager" /></div>
            ) : null}
            <h2>{quiz.question.question}</h2>
            <div className="school-answer-grid">
              {['A', 'B', 'C', 'D'].map((key) => (
                <button
                  key={key}
                  className={`${selectedOption === key ? ' is-selected' : ''}${selectedOption === key && answerState ? ` is-${answerState}` : ''}`}
                  type="button"
                  disabled={answerBusy}
                  onClick={() => submitAnswer(key)}
                >
                  <strong>{key}</strong><span>{quiz.question[`option_${key.toLowerCase()}`]}</span>
                </button>
              ))}
            </div>
            {answerBusy ? <div className="school-answer-saving"><i />Menyimpan jawaban dan menyiapkan soal berikutnya...</div> : null}
          </article>
        </section>
      ) : null}

      {phase === 'calculating' ? <SchoolLoading /> : null}

      {phase === 'result' && result ? (
        <>
          <section className="school-result-card">
            <div className="school-result-kicker">SIMULASI SELESAI</div>
            <h2>Hasilmu Sudah Siap</h2>
            <div className="school-result-score">{Number(result.score || 0).toLocaleString('id-ID')}<small>GO TO SCHOOLS POINTS</small></div>
            <div className="school-fp-conversion">
              <span>{Number(result.score || 0).toLocaleString('id-ID')} School Points</span>
              <b>→</b>
              <strong>+{Number(result.convertedFp || 0).toLocaleString('id-ID')} FP</strong>
            </div>
            <small className="school-conversion-note">Konversi: 1.000 Go to Schools Points = 100 Force Points.</small>
            <div className="school-result-stats">
              <span><b>{result.correctCount}/{result.totalQuestions}</b> Jawaban Benar</span>
              <span><b>{Number(result.averageTimeSeconds || 0).toFixed(1)}s</b> Rata-rata Waktu</span>
              <span><b>#{result.rank || '-'}</b> Peringkat Sementara</span>
            </div>
          </section>

          <section className="school-community-card">
            <div>
              <p className="eyebrow">LANJUTKAN PERJALANANMU</p>
              <h2>Jangan berhenti di sini</h2>
              <p>Untuk informasi kegiatan, kesempatan belajar, dan program FORCE selanjutnya, silakan bergabung ke komunitas WhatsApp kami melalui tombol di bawah.</p>
            </div>
            <a className="school-community-button" href={communityUrl} target="_blank" rel="noopener noreferrer">
              <span>Join Komunitas WhatsApp</span><b>→</b>
            </a>
          </section>

          <SchoolLeaderboard data={leaderboard} loading={leaderboardLoading} meId={me?.id} />
        </>
      ) : null}
    </div>
  );
}

function ShopProductCard({ product, balance, onSelect }) {
  const canRedeem = Number(balance || 0) >= Number(product.fpPrice || 0) && Number(product.stock || 0) > 0;
  return (
    <article className={`shop-product-card${product.featured ? ' is-featured' : ''}`}>
      <div className="shop-product-image">
        <img src={product.imageUrl || '/image/force-logo.png'} alt={product.name} loading="lazy" />
      </div>
      <div className="shop-product-body">
        <small>{product.categoryName || 'FORCE GOODS'}</small>
        <h3>{product.name}</h3>
        <p>{product.subtitle || product.description}</p>
        <div className="shop-product-footer">
          <strong>{fp(product.fpPrice)}</strong>
          <button type="button" disabled={!canRedeem} onClick={() => onSelect(product)}>
            {Number(product.stock || 0) <= 0 ? 'Habis' : canRedeem ? 'Tukar' : 'FP Kurang'}
          </button>
        </div>
        <span className="shop-stock">Stok {product.stock}</span>
      </div>
    </article>
  );
}

function RedeemModal({ product, me, balance, busy, onClose, onSubmit }) {
  const [form, setForm] = useState({
    recipientName: me?.name || '',
    phone: me?.phone || '+62',
    address: '',
    city: me?.city || '',
    postalCode: '',
    notes: '',
  });
  if (!product || typeof document === 'undefined') return null;

  const change = (key, value, max) => setForm((current) => ({ ...current, [key]: String(value || '').slice(0, max) }));
  const submit = (event) => {
    event.preventDefault();
    onSubmit(form);
  };

  return createPortal((
    <div className="shop-modal" role="dialog" aria-modal="true" aria-label={`Tukar ${product.name}`}>
      <button className="shop-modal-backdrop" type="button" onClick={onClose} aria-label="Tutup" />
      <form className="shop-redeem-dialog" onSubmit={submit}>
        <button className="shop-modal-close" type="button" onClick={onClose} aria-label="Tutup">×</button>
        <div className="shop-redeem-product">
          <img src={product.imageUrl || '/image/force-logo.png'} alt="" />
          <div><small>KONFIRMASI PENUKARAN</small><h2>{product.name}</h2><strong>{fp(product.fpPrice)}</strong></div>
        </div>
        <div className="shop-balance-warning">
          <span>Saldo saat ini <b>{Number(balance || 0).toLocaleString('id-ID')} FP</b></span>
          <span>Sisa setelah ditukar <b>{Math.max(0, Number(balance || 0) - Number(product.fpPrice || 0)).toLocaleString('id-ID')} FP</b></span>
        </div>
        <div className="shop-form-grid">
          <label>Nama Penerima<input required maxLength={60} value={form.recipientName} onChange={(event) => change('recipientName', event.target.value, 60)} /></label>
          <label>Nomor WhatsApp<input required maxLength={16} value={form.phone} onChange={(event) => change('phone', event.target.value.replace(/[^0-9+]/g, ''), 16)} /></label>
          <label className="shop-field-wide">Alamat Lengkap<textarea required maxLength={240} rows={4} value={form.address} onChange={(event) => change('address', event.target.value, 240)} placeholder="Nama jalan, nomor rumah, kecamatan, patokan" /></label>
          <label>Kota / Kabupaten<input required maxLength={40} value={form.city} onChange={(event) => change('city', event.target.value, 40)} /></label>
          <label>Kode Pos<input required inputMode="numeric" maxLength={8} value={form.postalCode} onChange={(event) => change('postalCode', event.target.value.replace(/\D/g, ''), 8)} /></label>
          <label className="shop-field-wide">Catatan Opsional<textarea maxLength={160} rows={2} value={form.notes} onChange={(event) => change('notes', event.target.value, 160)} /></label>
        </div>
        <p className="shop-redeem-note">Setelah dikonfirmasi, FP langsung dipotong dan permintaan masuk ke admin FORCE untuk diproses.</p>
        <button className={`btn primary full${busy ? ' is-loading' : ''}`} type="submit" disabled={busy}>{busy ? 'Memproses...' : `Konfirmasi Tukar ${Number(product.fpPrice).toLocaleString('id-ID')} FP`}</button>
      </form>
    </div>
  ), document.body);
}

export function ForceShopsPage({ me, refreshMe, onToast, playButton }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ balance: 0, products: [], orders: [] });
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [redeemBusy, setRedeemBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await featureApi('/api/shop/products');
      setData(payload);
    } catch (error) {
      onToast(error.message || 'FORCE Shops gagal dimuat.');
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => { load(); }, [load]);

  const categories = useMemo(() => {
    const map = new Map();
    (data.products || []).forEach((product) => map.set(product.categoryId || 'other', product.categoryName || 'Lainnya'));
    return [...map.entries()];
  }, [data.products]);

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data.products || []).filter((product) => {
      if (category !== 'all' && product.categoryId !== category) return false;
      if (!query) return true;
      return `${product.name} ${product.subtitle} ${product.description}`.toLowerCase().includes(query);
    });
  }, [category, data.products, search]);

  const redeem = async (form) => {
    if (!selected) return;
    playButton();
    setRedeemBusy(true);
    try {
      const response = await featureApi('/api/shop/redeem', { method: 'POST', body: { productId: selected.id, ...form } });
      setSelected(null);
      onToast(`Penukaran berhasil. Nomor pesanan ${response.order.orderNumber}.`);
      await Promise.all([load(), refreshMe?.()]);
    } catch (error) {
      onToast(error.message || 'Penukaran gagal diproses.');
    } finally {
      setRedeemBusy(false);
    }
  };

  return (
    <div className="shop-page">
      <section className="shop-hero">
        <div>
          <p className="eyebrow">FORCE SHOPS</p>
          <h1><span className="shop-hero-line shop-hero-accent">The Journey Changed you,</span><span className="shop-hero-line">before the Reward Found you.</span></h1>
          <p>Gunakan Force Points yang kamu kumpulkan dari setiap duel di FORCE Arena.</p>
        </div>
        <article className="shop-wallet-card">
          <span>SALDO FORCE POINTS</span>
          <strong>{fp(data.balance)}</strong>
          <small>Saldo belanja terpisah dari Lifetime FP dan level akun.</small>
        </article>
      </section>

      <section className="shop-toolbar">
        <label className="shop-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value.slice(0, 50))} placeholder="Cari barang favoritmu..." /></label>
        <div className="shop-category-tabs">
          <button className={category === 'all' ? 'is-active' : ''} type="button" onClick={() => setCategory('all')}>Semua</button>
          {categories.map(([id, name]) => <button key={id} className={category === id ? 'is-active' : ''} type="button" onClick={() => setCategory(id)}>{name}</button>)}
        </div>
      </section>

      <section className="shop-catalog-section">
        <div className="shop-section-title">
          <div><p className="eyebrow">KATALOG TESTING</p><h2>Produk Pilihan FORCE</h2></div>
        </div>
        {loading ? <div className="shop-loading"><span /><strong>Memuat katalog...</strong></div> : (
          <div className="shop-product-grid">
            {visibleProducts.length ? visibleProducts.map((product) => <ShopProductCard key={product.id} product={product} balance={data.balance} onSelect={setSelected} />) : <p className="shop-empty">Produk tidak ditemukan.</p>}
          </div>
        )}
      </section>

      <section className="shop-orders-section">
        <div className="shop-section-title"><div><p className="eyebrow">RIWAYAT PENUKARAN</p><h2>Pesanan Terakhir</h2></div></div>
        <div className="shop-order-list">
          {(data.orders || []).length ? data.orders.map((order) => (
            <article key={order.id}>
              <div><small>{order.orderNumber}</small><strong>{order.productName || 'Barang FORCE'}</strong><span>{new Date(order.createdAt).toLocaleString('id-ID')}</span></div>
              <b>{Number(order.totalFp || 0).toLocaleString('id-ID')} FP</b>
              <em className={`status-${order.status}`}>{order.statusLabel}</em>
            </article>
          )) : <p className="shop-empty">Belum ada penukaran barang.</p>}
        </div>
      </section>

      <RedeemModal product={selected} me={me} balance={data.balance} busy={redeemBusy} onClose={() => !redeemBusy && setSelected(null)} onSubmit={redeem} />
    </div>
  );
}
