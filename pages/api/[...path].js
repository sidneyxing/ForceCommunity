import { createClient } from "@supabase/supabase-js";
import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual, webcrypto } from "node:crypto";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_DUEL_LIMIT = 7;
const DUEL_HISTORY_LIMIT = 7;
const DUEL_QUESTION_COUNT = 5;
const QUESTION_TIME_LIMIT_MS = 10 * 1000;
const DUEL_REQUEST_WAIT_MS = 30 * 1000;
// A short shared server timestamp keeps both clients synchronized without making
// a matched pair stare at an unnecessary five-second countdown.
const DUEL_START_BUFFER_MS = 2 * 1000;
const ONLINE_CUTOFF_MS = 2 * 60 * 1000;
// Matchmaking is user-cancelled, not time-limited. This value is only used as
// a heartbeat/cleanup grace period for old deployments and must never end an
// actively polled search.
const MATCH_QUEUE_STALE_MS = 5 * 60 * 1000;
const DUEL_SETTLE_GRACE_MS = 15 * 1000;
const SESSION_DAYS = 30;
const SESSION_ROTATION_DAYS = 7;
const SESSION_KEEP_PER_USER = 1;
const DATA_RETENTION_DAYS = 30;
const APP_TIME_ZONE = "Asia/Jakarta";
const DAILY_CATEGORY_QUESTION_COUNT = 5; // Category mode: 4 selected-category + 1 FORCE CORE. Random mode: at least 1 FORCE CORE + 4 unrestricted questions.
const RESET_CODE_TTL_MS = 15 * 60 * 1000;
const SCHOOL_DATA_RETENTION_MS = 2 * ONE_DAY_MS;
const SCHOOL_LEADERBOARD_CACHE_SECONDS = 8;
const SCHOOL_MAX_PARTICIPANTS_DEFAULT = 1000;
const SCHOOL_EVENT_DISPLAY_NAME = "Simulasi FORCE Go to Schools";
const SCHOOL_QUESTION_TIME_LIMIT_MS = 10 * 1000;
const FORCE_WHATSAPP_URL =
  "https://chat.whatsapp.com/EsJQlvGeXVq1hZrxBvB465";
const SHOP_WEBHOOK_TIMEOUT_MS = 4500;
const MAX_EMAIL_LENGTH = 80;
const MAX_PASSWORD_LENGTH = 128;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{3,80}$/;
const SCHOOL_OPTIONS = [
  "SMAN 1 Manado",
  "SMAN 2 Manado",
  "SMAN 3 Manado",
  "SMAN 4 Manado",
  "SMAN 5 Manado",
  "SMAN 6 Manado",
  "SMAN 7 Manado",
  "SMAN 8 Manado",
  "SMAN 9 Binsus Manado",
  "SMAN 10 Manado",
  "SMKN 1 Manado",
  "SMKN 2 Manado",
  "SMKN 3 Manado",
  "SMKN 4 Manado",
  "SMKN 5 Manado",
  "SMKN 6 Manado",
  "SMKN 7 Manado",
  "SMKN 8 Manado",
  "SMKN 9 Manado",
  "SMKN 10 Manado",
  "SMA Kristen Irene",
  "Sudah Lulus",
];
const SCHOOL_SET = new Set(SCHOOL_OPTIONS);

// Basic server-side rate limit. Ini bukan pengganti WAF, tapi membantu menahan spam login/invite/answer.
const rateLimitStore = new Map();

const FORCE_CORE_CATEGORY = {
  key: "force_core",
  label: "FORCE CORE",
  description: "Arah hidup, tujuan hidup, loyalitas, kesetiaan, attitude, manner, dan aturan.",
  locked: true,
};

const QUESTION_CATEGORIES = [
  { key: "global", label: "Global", description: "Bahasa Inggris dan Geografi global seperti peta, bendera, dan bangsa-bangsa.", selectable: true, aliases: ["global", "english", "bahasa inggris", "geografi", "geography", "flag", "bendera", "peta", "map", "nations"] },
  { key: "tech", label: "Technology", description: "Logika, matematika, dan teknologi.", selectable: true, aliases: ["tech", "technology", "teknologi", "logic", "logika", "math", "matematika"] },
  { key: "media", label: "Media", description: "Istilah editing, media, visual thinking, dan cara melihat cakupan luas.", selectable: true, aliases: ["media", "editing", "editor", "visual"] },
  { key: "kitchen_cafe", label: "Kitchen & Cafe", description: "Bisnis praktikal, bahan makanan, teknik memasak, dan jenis makanan.", selectable: true, aliases: ["kitchen_cafe", "kitchen", "cafe", "cooking", "masak", "dapur", "makanan"] },
  { key: "mentoring", label: "Mentoring", description: "Jiwa pengajar, komunikasi, dan public speaking.", selectable: true, aliases: ["mentoring", "mentor", "public speaking", "teaching", "pengajar"] },
  { key: "orchestral", label: "Orchestral", description: "Musik, nada, dan alat musik.", selectable: true, aliases: ["orchestral", "orchestra", "music", "musik", "nada", "alat musik"] },
  { ...FORCE_CORE_CATEGORY, selectable: false, aliases: ["force_core", "force core", "core", "arah hidup", "tujuan hidup", "loyalitas", "attitude", "manner"] },
];

const SELECTABLE_DUEL_CATEGORIES = QUESTION_CATEGORIES
  .filter((category) => category.selectable)
  .map(({ key, label, description }) => ({ key, label, description }));
const CATEGORY_BY_KEY = new Map(QUESTION_CATEGORIES.map((category) => [category.key, category]));
const SELECTABLE_DUEL_CATEGORY_KEYS = new Set(SELECTABLE_DUEL_CATEGORIES.map((category) => category.key));
let seedPromise;
let seedModulePromise;
let weeklySeasonCheckedKey;
let maintenanceLastRunAt = 0;
let schoolMaintenanceLastRunAt = 0;
const schoolLeaderboardMemoryCache = new Map();
const schoolQuestionBankMemoryCache = { expiresAt: 0, rows: [] };
const schoolEventMemoryCache = new Map();
const SCHOOL_QUIZ_CACHE_MS = 30_000;

export default async function handler(req, res) {
  try {
    const method = req.method.toUpperCase();
    const path = resolveApiPath(req);
    assertBasicRateLimit(req, method, path);
    assertTrustedOrigin(req, method, path);

    if (method === "GET" && path === "/health") {
      return send(res, 200, {
        ok: true,
        service: "FORCE API",
        stateProvider: "supabase",
      });
    }

    if (path === "/realtime-config") {
      return send(res, 404, { error: "API route not found." });
    }
    if (path === "/worker/drain" && method !== "POST") {
      res.setHeader("Allow", "POST");
      return send(res, 405, { error: "Method not allowed." });
    }

    const db = getSupabase();

    if (method === "POST" && path === "/worker/drain") return workerDrain(req, res, db);

    // Auth/reset routes must stay light and public. Do not run seed/weekly jobs here,
    // so a password-reset email cannot fail because of unrelated maintenance work.
    if (method === "POST" && path === "/auth/register") return register(req, res, db);
    if (method === "POST" && path === "/auth/login") return login(req, res, db);
    if (method === "POST" && path === "/auth/logout") return logout(req, res, db);

    // Kalau nanti sudah beli domain dan domain sender Resend sudah verified,
    // route reset email ini bisa diaktifkan lagi. Untuk sementara user diarahkan hubungi WA admin.
    if (method === "POST" && path === "/auth/reset/request") return requestPasswordReset(req, res, db);
    if (method === "POST" && path === "/auth/reset/confirm") return confirmPasswordReset(req, res, db);

    // Tool sementara untuk admin reset password tanpa perlu generate hash manual.
    // Tetap wajib login sebagai admin + mengisi ADMIN_RESET_KEY.
    if (method === "POST" && path === "/admin/reset-password") {
      const adminUser = await requireUser(req, res, db);
      return adminResetPassword(req, res, db, adminUser);
    }

    await ensureSeedOnce(db);
    await ensureWeeklySeason(db);

    const user = await requireUser(req, res, db);
    if (method === "GET" && path === "/me") return send(res, 200, await mePayload(db, user));
    if (method === "POST" && path === "/me/password") return changeMyPassword(req, res, db, user);
    if (method === "PATCH" && path === "/me/profile") return updateProfile(req, res, db, user);
    if (method === "PATCH" && path === "/me/settings") return updateSettings(req, res, db, user);
    if (method === "GET" && path === "/members") return members(req, res, db, user);
    if (method === "POST" && /^\/members\/[^/]+\/relation$/.test(path)) return relation(req, res, db, user, path.split("/")[2]);
    if (method === "POST" && /^\/members\/[^/]+\/invite$/.test(path)) return inviteDuelRequest(req, res, db, user, path.split("/")[2]);
    if (method === "GET" && path === "/duel/categories") return duelCategories(res);
    if (method === "GET" && path === "/duel-requests") return duelRequests(res, db, user);
    if (method === "POST" && /^\/duel-requests\/[^/]+\/respond$/.test(path)) return respondDuelRequest(req, res, db, user, path.split("/")[2]);
    if (method === "GET" && path === "/leaderboard") return leaderboard(req, res, db, user);

    if (method === "GET" && path === "/schools/active") return schoolFeatureStatus(req, res, db, user);
    if (method === "POST" && path === "/schools/verify") return verifySchoolInvite(req, res, db, user);
    if (method === "POST" && path === "/schools/start") return startSchoolAttempt(req, res, db, user);
    if (method === "GET" && path === "/schools/resume") return resumeSchoolAttempt(req, res, db, user);
    if (method === "POST" && path === "/schools/answer") return answerSchoolQuestion(req, res, db, user);
    if (method === "GET" && path === "/schools/leaderboard") return schoolLeaderboard(req, res, db, user);

    if (method === "GET" && path === "/shop/products") return shopProducts(res, db, user);
    if (method === "GET" && path === "/shop/orders") return shopOrders(res, db, user);
    if (method === "POST" && path === "/shop/redeem") return redeemShopProduct(req, res, db, user);

    if (method === "GET" && path === "/badges") return send(res, 410, { error: "Sistem badge sementara dinonaktifkan untuk menghemat database." });
    if (method === "POST" && path === "/duel/start") return startDuel(req, res, db, user);
    if (method === "GET" && path === "/duel/matchmaking/status") return matchmakingStatus(res, db, user);
    if (method === "POST" && path === "/duel/matchmaking/cancel") return cancelMatchmaking(res, db, user);
    if (method === "GET" && /^\/duel\/[^/]+\/events$/.test(path)) return duelEvents(req, res, db, user, path.split("/")[2]);
    if (method === "GET" && /^\/duel\/[^/]+$/.test(path)) return getDuel(res, db, user, path.split("/")[2]);
    if (method === "GET" && /^\/duel\/[^/]+\/status$/.test(path)) return duelStatus(res, db, user, path.split("/")[2]);
    if (method === "POST" && path === "/duel/answer") return answerDuel(req, res, db, user);
    if (method === "POST" && path === "/duel/finish") return finishDuel(req, res, db, user);

    return send(res, 404, { error: "API route not found." });
  } catch (error) {
    console.error("FORCE_API_ERROR", {
      message: error?.message || "Server error",
      status: error?.status || 500,
      stack: error?.stack,
    });
    const status = Number(error?.status || 500);
    const publicMessage = status >= 500
      ? "Terjadi kesalahan pada server. Silakan coba lagi."
      : (error?.message || "Permintaan tidak dapat diproses.");
    return send(res, status, { error: publicMessage });
  }
}

function resolveApiPath(req) {
  const urlPath = new URL(req.url || "/", "http://localhost").pathname;
  const cleanUrlPath = urlPath.replace(/^\/api/, "") || "/";

  if (cleanUrlPath && cleanUrlPath !== "/" && cleanUrlPath !== "/[...path].js") {
    return cleanUrlPath;
  }

  const pathParts = Array.isArray(req.query.path)
    ? req.query.path
    : req.query.path
      ? [req.query.path]
      : [];

  return `/${pathParts.join("/")}`;
}

async function supabaseServerFetch(input, init) {
  try {
    return await fetch(input, init);
  } catch (error) {
    console.error("FORCE_SUPABASE_NETWORK_ERROR", {
      message: error?.message || "Supabase network request failed.",
    });
    return new Response(JSON.stringify({ message: "Database service unavailable." }), {
      status: 503,
      statusText: "Service Unavailable",
      headers: { "Content-Type": "application/json" },
    });
  }
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw Object.assign(new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."), { status: 500 });
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: supabaseServerFetch,
    },
  });
}

function send(res, status, payload, headers = {}) {
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(payload);
}

async function touchPresence() {
  // Supabase-only mode: avoid writing heartbeat on every request.
}

async function isOnlineUser(user = {}) {
  return isRecentlyOnline(user);
}

async function onlineStatusByUserIds(users = []) {
  const result = new Map();
  for (const user of users) result.set(user.id, isRecentlyOnline(user));
  return result;
}

async function publishDuelEvent() {
  // Supabase-only mode uses lightweight status polling instead of event streams.
}

async function queueDuelSettlement() {
  // Settlement is checked directly from Supabase in status/finish handlers.
  return false;
}

function body(req) {
  return req.body && typeof req.body === "object" ? req.body : {};
}

function id(prefix = "id") {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

function randomGivenId() {
  return String(Math.floor(1000000 + Math.random() * 9000000));
}

async function digest(value) {
  const buffer = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hashPassword(password, salt = id("salt")) {
  const hash = pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored = "") {
  const [salt, expectedHex] = String(stored || "").split(":");
  if (!salt || !expectedHex || !/^[a-f0-9]{64}$/i.test(expectedHex)) return false;
  const actual = pbkdf2Sync(password, salt, 100000, 32, "sha256");
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

function cookie(req, name) {
  const raw = req.headers.cookie || "";
  const found = raw.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.split("=").slice(1).join("=")) : "";
}

function sessionCookie(token, expired = false) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const maxAge = expired ? 0 : 60 * 60 * 24 * SESSION_DAYS;
  return `force_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Priority=High${secure}; Max-Age=${maxAge}`;
}

function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}

function zonedParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function timeZoneOffsetMs(date, timeZone = APP_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  const asUtc = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
  return asUtc - date.getTime();
}

function startOfTodayIso(date = new Date()) {
  const parts = zonedParts(date);
  const localMidnightAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  const offset = timeZoneOffsetMs(new Date(localMidnightAsUtc));
  return new Date(localMidnightAsUtc - offset).toISOString();
}

function dateKey(date = new Date()) {
  const parts = zonedParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function weekKey(date = new Date()) {
  const parts = zonedParts(date);
  const localDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const weekday = localDate.getUTCDay() || 7;
  localDate.setUTCDate(localDate.getUTCDate() - weekday + 1);
  return localDate.toISOString().slice(0, 10);
}

function todayDate() {
  return dateKey();
}

function yesterdayDate() {
  return dateKey(new Date(new Date(startOfTodayIso()).getTime() - ONE_DAY_MS));
}

function daysAgoDate(days) {
  return dateKey(new Date(new Date(startOfTodayIso()).getTime() - days * ONE_DAY_MS));
}

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function answerPoints(answer) {
  if (!answer.is_correct) return 0;
  if (Number.isFinite(Number(answer.points)) && Number(answer.points) > 0) {
    return Math.max(0, Math.min(100, Number(answer.points)));
  }
  const elapsedMs = Math.max(0, Math.min(QUESTION_TIME_LIMIT_MS, Number(answer.answer_time_ms || QUESTION_TIME_LIMIT_MS)));
  const remainingMs = Math.max(0, QUESTION_TIME_LIMIT_MS - elapsedMs);
  return 50 + Math.round((remainingMs / QUESTION_TIME_LIMIT_MS) * 50);
}

function duelPoints(answers) {
  const total = answers.reduce((sum, answer) => sum + answerPoints(answer), 0);
  return Math.min(100, Math.round(total / DUEL_QUESTION_COUNT));
}

function participantSide(duel, userId) {
  if (duel.user_id === userId) return "user";
  if (duel.opponent_id === userId) return "opponent";
  return "";
}

function isDuelParticipant(duel, userId) {
  return Boolean(participantSide(duel, userId));
}

function resultForSide(result, side) {
  if (side !== "opponent" || result === "draw") return result;
  if (result === "win") return "lose";
  if (result === "lose") return "win";
  return result;
}

function resultForDuel(duel) {
  if (duel.status !== "finished") return null;
  const userFp = Number(duel.fp_awarded ?? duel.user_score ?? 0);
  const opponentFp = Number(duel.opponent_fp_awarded ?? duel.opponent_score ?? 0);
  if (userFp > opponentFp) return "win";
  if (userFp < opponentFp) return "lose";
  return "draw";
}

function scoreForSide(duel, side) {
  return side === "opponent"
    ? { mine: Number(duel.opponent_score || 0), theirs: Number(duel.user_score || 0) }
    : { mine: Number(duel.user_score || 0), theirs: Number(duel.opponent_score || 0) };
}

function isRecentlyOnline(user) {
  return Boolean(user?.last_seen_at && Date.now() - new Date(user.last_seen_at).getTime() <= ONLINE_CUTOFF_MS);
}

function duelAnswerDeadlineMs(duel) {
  const startsAt = duel.starts_at || duel.started_at;
  return new Date(startsAt).getTime() + (DUEL_QUESTION_COUNT * QUESTION_TIME_LIMIT_MS) + DUEL_SETTLE_GRACE_MS;
}

async function duelsTodayCount(db, userId) {
  return duelsTodayCountSupabase(db, userId);
}

async function duelsTodayCountSupabase(db, userId) {
  assertValidUserId(userId, "User");
  const startedAt = startOfTodayIso();
  const [asUser, asOpponent] = await Promise.all([
    db.from("duels").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("started_at", startedAt),
    db.from("duels").select("id", { count: "exact", head: true }).eq("opponent_id", userId).gte("started_at", startedAt),
  ]);
  if (asUser.error) throw asUser.error;
  if (asOpponent.error) throw asOpponent.error;
  return Number(asUser.count || 0) + Number(asOpponent.count || 0);
}

async function activeDuelIdForUser(db, userId) {
  assertValidUserId(userId, "User");
  const active = unwrap(await db
    .from("duels")
    .select("id, status, user_id, opponent_id, starts_at")
    .eq("status", "active")
    .or(`user_id.eq.${userId},opponent_id.eq.${userId}`)
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle());
  return active?.id || "";
}

async function incrementDailyDuelCounters() {
  // Supabase counts today's duel rows directly; no separate counter table is needed.
}

async function invalidateLeaderboardCaches() {
  // Leaderboard is read directly from Supabase in this build.
}

async function selectDuelsForUser(db, userId, {
  columns = "*",
  status = "",
  startedAtGte = "",
  ascending = false,
  limit = 100,
} = {}) {
  assertValidUserId(userId, "User");
  const build = (column) => {
    let query = db.from("duels").select(columns).eq(column, userId);
    if (status) query = query.eq("status", status);
    if (startedAtGte) query = query.gte("started_at", startedAtGte);
    return query.order("started_at", { ascending }).limit(limit);
  };
  const [asUser, asOpponent] = await Promise.all([build("user_id"), build("opponent_id")]);
  const rows = [...unwrap(asUser), ...unwrap(asOpponent)];
  return [...new Map(rows.map((row) => [row.id, row])).values()]
    .sort((a, b) => {
      const left = new Date(a.started_at || 0).getTime();
      const right = new Date(b.started_at || 0).getTime();
      return ascending ? left - right : right - left;
    })
    .slice(0, limit);
}

function ensureSeedOnce(db) {
  seedPromise ||= ensureSeed(db).catch((error) => {
    seedPromise = undefined;
    throw error;
  });
  return seedPromise;
}

async function loadSeedData() {
  // Keep seed data as a lazy import so public auth/reset routes do not crash
  // when api/data.js is missing or not copied during deployment.
  seedModulePromise ||= import("./data.js").catch((error) => {
    seedModulePromise = undefined;
    const message = error?.code === "ERR_MODULE_NOT_FOUND"
      ? "api/data.js belum ada di deployment. Copy data.js ke folder api/ karena [...path].js memakai import ./data.js."
      : error?.message || "Seed data gagal dimuat.";
    throw Object.assign(new Error(message), { status: 500 });
  });
  return seedModulePromise;
}

async function ensureSeed(db) {
  const { seedQuestions } = await loadSeedData();

  const questionCount = await db.from("questions").select("id", { count: "exact", head: true });
  if (!questionCount.error && !questionCount.count) {
    unwrap(await db.from("questions").insert(seedQuestions.map((q, index) => ({
      id: `q_${String(index + 1).padStart(3, "0")}`,
      category_key: categoryKeyFor(q[0]) || q[0] || "global",
      question: q[2],
      option_a: q[3],
      option_b: q[4],
      option_c: q[5],
      option_d: q[6],
      correct_option: q[7],
      active: true,
    }))));
  }

  const userCount = await db.from("users").select("id", { count: "exact", head: true });
  if (!userCount.error && !userCount.count) {
    const demoHash = hashPassword("ForceDemo123!");
    const samples = [
      ["Victor", "victor", "+628100000001", "Manado", "SMAN 1 Manado", "male", 0, 0, 0, "#d4af37"],
      ["Lunara", "lunara", "+628100000002", "Tomohon", "SMAN 2 Manado", "female", 0, 0, 0, "#9b111e"],
      ["Poporo", "poporo", "+628100000003", "Bitung", "SMKN 1 Manado", "male", 0, 0, 0, "#2f6f9f"],
      ["Zarah", "zarah", "+628100000004", "Minahasa", "SMAN 9 Binsus Manado", "female", 0, 0, 0, "#6a4fb3"],
      ["Gogodino", "godino", "+628100000005", "Manado", "SMKN 10 Manado", "female", 0, 0, 0, "#2f8e5f"],
    ];
    const users = samples.map(([name, username, phone, city, school, gender, fp, wins, streak]) => ({
      id: id("user"),
      given_id: randomGivenId(),
      name,
      username,
      phone,
      city,
      school,
      gender,
      password_hash: demoHash,
      lifetime_fp: fp,
      weekly_fp: Math.floor(fp / 4),
      wins,
      fire_streak_days: streak,
      last_fire_date: todayDate(),
      last_seen_at: new Date().toISOString(),
    }));
    unwrap(await db.from("users").insert(users));
    unwrap(await db.from("user_settings").insert(users.map((user) => ({ user_id: user.id }))));
  }
}

async function ensureWeeklySeason(db) {
  const currentWeek = weekKey();
  if (weeklySeasonCheckedKey === currentWeek) return;

  const state = unwrap(await db.from("system_settings").select("value").eq("key", "current_week_key").maybeSingle());

  if (!state) {
    unwrap(await db.from("system_settings").upsert({
      key: "current_week_key",
      value: currentWeek,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" }));
    weeklySeasonCheckedKey = currentWeek;
    return;
  }

  if (state.value === currentWeek) {
    weeklySeasonCheckedKey = currentWeek;
    return;
  }

  const previousWeek = state.value;
  const existingSnapshot = await db
    .from("weekly_rank_snapshots")
    .select("week_key", { count: "exact", head: true })
    .eq("week_key", previousWeek);

  if (!existingSnapshot.error && !existingSnapshot.count) {
    const leaders = unwrap(await db
      .from("users")
      .select("id, weekly_fp, lifetime_fp, created_at")
      .gt("weekly_fp", 0)
      .order("weekly_fp", { ascending: false })
      .order("lifetime_fp", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(3));

    if (leaders.length) {
      unwrap(await db.from("weekly_rank_snapshots").upsert(leaders.map((leader, index) => ({
        week_key: previousWeek,
        user_id: leader.id,
        rank: index + 1,
        weekly_fp: leader.weekly_fp,
      })), { onConflict: "week_key,rank" }));

    }
  }

  unwrap(await db.from("users").update({ weekly_fp: 0 }).neq("id", ""));
  unwrap(await db.from("system_settings").upsert({
    key: "current_week_key",
    value: currentWeek,
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" }));
  weeklySeasonCheckedKey = currentWeek;
}

async function generateUniqueGivenId(db) {
  for (let i = 0; i < 8; i += 1) {
    const candidate = randomGivenId();
    const row = unwrap(await db.from("users").select("id").eq("given_id", candidate).maybeSingle());
    if (!row) return candidate;
  }
  return String(Date.now()).slice(-7);
}

function normalizeEmail(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9@._+-]/g, "")
    .slice(0, MAX_EMAIL_LENGTH);
}

function isValidEmail(value = "") {
  const email = String(value || "");
  return email.length >= 6 && email.length <= MAX_EMAIL_LENGTH && /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email);
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
}

function requestOrigin(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || (req.socket?.encrypted ? "https" : "http");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return host ? `${protocol}://${host}` : "";
}

function assertTrustedOrigin(req, method, path) {
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return;
  // The worker is a server-to-server endpoint protected by its own required header secret.
  if (path === "/worker/drain") return;
  const suppliedOrigin = String(req.headers.origin || "").trim();
  const expectedOrigin = requestOrigin(req);
  if (!suppliedOrigin || !expectedOrigin || suppliedOrigin !== expectedOrigin) {
    throw Object.assign(new Error("Origin request tidak diizinkan."), { status: 403 });
  }
}

function safeSecretEqual(left, right) {
  const leftValue = String(left || "");
  const rightValue = String(right || "");
  if (!leftValue || !rightValue) return false;
  const leftDigest = createHash("sha256").update(leftValue).digest();
  const rightDigest = createHash("sha256").update(rightValue).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function assertBasicRateLimit(req, method, path) {
  if (method === "GET" && path === "/health") return;
  const rules = [
    { match: /^\/auth\/(login|register|reset)/, limit: 20, windowMs: 60_000 },
    { match: /^\/members\/[^/]+\/invite$/, limit: 30, windowMs: 60_000 },
    { match: /^\/duel\/(answer|start|finish)/, limit: 120, windowMs: 60_000 },
    { match: /^\/schools\/verify$/, limit: 30, windowMs: 60_000 },
    { match: /^\/schools\/(start|answer)$/, limit: 150, windowMs: 60_000 },
    { match: /^\/shop\/redeem$/, limit: 8, windowMs: 60_000 },
    { match: /.*/, limit: 360, windowMs: 60_000 },
  ];
  const rule = rules.find((item) => item.match.test(path));
  const key = `${clientIp(req)}:${path}:${method}`;
  const now = Date.now();
  const bucket = rateLimitStore.get(key) || { count: 0, resetAt: now + rule.windowMs };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + rule.windowMs;
  }
  bucket.count += 1;
  rateLimitStore.set(key, bucket);
  if (rateLimitStore.size > 5000) {
    for (const [storedKey, storedBucket] of rateLimitStore.entries()) {
      if (now > storedBucket.resetAt) rateLimitStore.delete(storedKey);
    }
  }
  if (bucket.count > rule.limit) {
    throw Object.assign(new Error("Terlalu banyak request. Coba lagi sebentar."), { status: 429 });
  }
}

function normalizeCompactText(value = "", max = 60) {
  return String(value || "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeUsername(value = "") {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9._-]/g, "").slice(0, 24);
}

function isValidUsername(value = "") {
  return /^[a-z0-9._-]{3,24}$/.test(String(value || ""));
}

function sanitizeLettersNumbersSpaces(value = "", max = 60) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[()*&^%$#@!~`+=_\-'":;|\?/.,><[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeName(value = "") {
  return sanitizeLettersNumbersSpaces(value, 60);
}

function normalizeCity(value = "") {
  return sanitizeLettersNumbersSpaces(value, 25);
}

function normalizeSchool(value = "") {
  const raw = sanitizeLettersNumbersSpaces(value, 40);
  return SCHOOL_SET.has(raw) ? raw : raw.slice(0, 40);
}

function isValidSchool(value = "") {
  const school = String(value || "").trim();
  return SCHOOL_SET.has(school) || /^[\p{L}\p{M}\p{N} ]{2,40}$/u.test(school);
}

function normalizePhone(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("62")) return `+${digits.slice(0, 15)}`;
  if (digits.startsWith("0")) return `+62${digits.slice(1, 14)}`;
  return `+62${digits.slice(0, 13)}`;
}

function isValidPhone(value = "") {
  return /^\+62\d{8,13}$/.test(String(value || ""));
}

function isValidPersonName(value = "") {
  return /^[\p{L}\p{M} ]{2,60}$/u.test(String(value || ""));
}

function isValidCity(value = "") {
  return /^[\p{L}\p{M}\p{N} ]{2,25}$/u.test(String(value || ""));
}

function sanitizeMemberSearch(value = "") {
  return normalizeCompactText(value, 40).replace(/[^\p{L}\p{N}_ .@-]/gu, "").trim();
}

function escapeLikePattern(value = "") {
  return String(value || "").replace(/[\\%_]/g, (char) => `\\${char}`);
}

function isValidMemberSearch(value = "") {
  const q = String(value || "");
  return q.length <= 40 && /^[\p{L}\p{N}_ .@-]*$/u.test(q);
}

function assertValidUserId(value, label = "Member") {
  if (!SAFE_ID_PATTERN.test(String(value || ""))) {
    throw Object.assign(new Error(`${label} tidak valid.`), { status: 400 });
  }
}

function assertValidRequestId(value) {
  if (!SAFE_ID_PATTERN.test(String(value || ""))) {
    throw Object.assign(new Error("Request duel tidak valid."), { status: 400 });
  }
}

function assertValidPassword(value, label = "Password") {
  if (String(value || "").length < 8 || String(value || "").length > MAX_PASSWORD_LENGTH) {
    throw Object.assign(new Error(`${label} harus 8-${MAX_PASSWORD_LENGTH} karakter.`), { status: 400 });
  }
}

function randomResetCode() {
  const value = Number(`0x${randomBytes(4).toString("hex")}`) % 1000000;
  return String(value).padStart(6, "0");
}

function badgeNumber(badge = {}) {
  const match = String(badge.id || "").match(/_(\d+)$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function badgeGroupOrder(badge = {}) {
  const number = badgeNumber(badge);
  if (number <= 10) return 10;   // Duel count
  if (number <= 20) return 20;   // Wins
  if (number <= 30) return 30;   // Win streak
  if (number <= 40) return 40;   // Lifetime FP
  if (number <= 50) return 50;   // Bible
  if (number <= 60) return 60;   // Character
  if (number <= 70) return 70;   // Technology
  if (number <= 80) return 80;   // Geography
  if (number <= 90) return 90;   // Logic
  if (number <= 100) return 100; // General knowledge
  if (number <= 110) return 110; // Health
  if (number <= 120) return 120; // Psychology
  if (number <= 130) return 130; // Economy
  if (number <= 140) return 140; // English
  if (number <= 150) return 150; // Weekly ranks
  return 999;
}

function compareBadgesByGroup(a, b) {
  return badgeGroupOrder(a) - badgeGroupOrder(b) || badgeNumber(a) - badgeNumber(b) || String(a.name || "").localeCompare(String(b.name || ""));
}

const SECRET_BADGE_NAMES = new Set([
  "flawless round",
  "speed strike",
  "clutch victor",
  "perfect brain",
  "top ten week",
  "bronze week",
  "silver week",
  "gold week",
  "c for christ",
  "peak of force",
]);

function isSecretBadge(badge = {}) {
  const number = badgeNumber(badge);
  const normalizedName = String(badge.name || "").trim().toLowerCase();
  return (number >= 141 && number <= 150) || SECRET_BADGE_NAMES.has(normalizedName);
}

function adminIdentifiers() {
  return String(process.env.ADMIN_USERS || process.env.ADMIN_USERNAMES || process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminUser(user = {}) {
  const allowed = adminIdentifiers();
  if (!allowed.length) return false;
  const candidates = [user.id, user.username, user.email, user.given_id]
    .filter(Boolean)
    .map((item) => String(item).trim().toLowerCase());
  return allowed.some((item) => candidates.includes(item));
}

function normalizeSenderEmail(value = "") {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

function resetSenderFromEnv() {
  const directFrom = normalizeSenderEmail(process.env.RESET_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || "");
  if (directFrom) return directFrom;

  const fromEmail = normalizeSenderEmail(process.env.RESET_FROM_ADDRESS || process.env.RESEND_FROM_ADDRESS || "");
  const fromName = normalizeSenderEmail(process.env.RESET_FROM_NAME || "FORCE");
  if (fromEmail) return `${fromName} <${fromEmail}>`;

  return "FORCE <onboarding@resend.dev>";
}

function resendErrorMessage(status, detail = "") {
  const message = String(detail || "").trim();
  if (status === 403 && /own email address|verify a domain|resend\.dev|domain/i.test(message)) {
    return "Resend menolak pengiriman. Kalau memakai onboarding@resend.dev, email tujuan harus sama dengan email akun Resend. Untuk kirim ke user lain, verify domain dulu di Resend lalu pakai sender dari domain itu.";
  }
  if (status === 401 || /api key|unauthorized|invalid/i.test(message)) {
    return "RESEND_API_KEY tidak valid atau belum tersimpan di Environment Variables Vercel.";
  }
  if (status === 422 || /from|sender|domain/i.test(message)) {
    return "RESET_FROM_EMAIL belum benar. Format aman: FORCE <onboarding@resend.dev> atau FORCE <noreply@domain-terverifikasi.com>.";
  }
  return message || "Cek RESEND_API_KEY, RESET_FROM_EMAIL, dan domain sender Resend.";
}

async function sendPasswordResetEmail(email, code) {
  const apiKey = process.env.RESEND_API_KEY || "";
  const from = resetSenderFromEnv();
  const replyTo = normalizeSenderEmail(process.env.RESET_REPLY_TO_EMAIL || process.env.FORCE_SUPPORT_EMAIL || "");
  const timeoutMs = Math.max(3000, Math.min(15000, Number(process.env.RESEND_TIMEOUT_MS || 8000)));

  if (!apiKey) {
    throw Object.assign(new Error("Email reset belum dikonfigurasi admin. Isi RESEND_API_KEY di Environment Variables Vercel."), { status: 500 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let responseText = "";
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "user-agent": "FORCE-reset/1.0",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Kode Reset Password FORCE",
        text: `Kode reset password FORCE kamu: ${code}. Kode berlaku 15 menit. Abaikan email ini kalau kamu tidak meminta reset password.`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#2a211e"><p>Kode reset password FORCE kamu:</p><h1 style="letter-spacing:6px;color:#9b111e">${code}</h1><p>Kode berlaku 15 menit.</p><p>Abaikan email ini kalau kamu tidak meminta reset password.</p></div>`,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    responseText = await response.text().catch(() => "");
  } catch (error) {
    const isAbort = error?.name === "AbortError";
    throw Object.assign(new Error(isAbort
      ? "Email reset timeout saat menghubungi Resend. Coba lagi, atau cek Vercel Function Region/network."
      : `Email reset gagal terhubung ke Resend: ${error.message || "network error"}`), { status: 502 });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    let detail = responseText;
    try {
      const parsed = responseText ? JSON.parse(responseText) : null;
      detail = parsed?.message || parsed?.error || parsed?.name || responseText;
    } catch {
      // Keep raw text if Resend returns non-JSON.
    }
    throw Object.assign(new Error(`Email reset gagal dikirim via Resend (${response.status}). ${resendErrorMessage(response.status, detail)}`), { status: 502 });
  }
}

async function requestPasswordReset(req, res, db) {
  // Kalau nanti sudah beli domain dan domain sender Resend sudah verified,
  // aktifkan kembali logic kirim kode 6 digit via Resend di sini.
  // Untuk sementara, reset password dibantu manual oleh admin via WhatsApp.
  return send(res, 503, {
    error: "Fitur reset password lewat email belum aktif. Silakan hubungi admin FORCE via WhatsApp 081392187414 untuk bantuan reset password.",
    disabled: true,
    contact: "081392187414",
  });
}

async function confirmPasswordReset(req, res, db) {
  // Kalau nanti sudah beli domain, endpoint confirm kode email bisa diaktifkan lagi.
  return send(res, 503, {
    error: "Fitur reset password lewat email belum aktif. Silakan hubungi admin FORCE via WhatsApp 081392187414.",
    disabled: true,
    contact: "081392187414",
  });
}

async function adminResetPassword(req, res, db, adminUser) {
  const data = body(req);
  const configuredKey = String(process.env.ADMIN_RESET_KEY || "").trim();
  const adminKey = String(data.adminKey || "").trim();
  const identifier = normalizeCompactText(data.identifier || data.username || data.email || "", MAX_EMAIL_LENGTH);
  const newPassword = String(data.newPassword || data.password || "");

  if (!isAdminUser(adminUser)) {
    return send(res, 403, { error: "Fitur reset password user hanya untuk akun admin." });
  }
  if (!configuredKey) {
    console.error("FORCE_ADMIN_RESET_DISABLED", { reason: "missing ADMIN_RESET_KEY" });
    return send(res, 503, { error: "Fitur admin sementara tidak tersedia." });
  }
  if (!safeSecretEqual(adminKey, configuredKey)) {
    return send(res, 403, { error: "Admin key salah. Reset password ditolak." });
  }
  if (identifier.length < 3 || identifier.length > MAX_EMAIL_LENGTH) {
    return send(res, 400, { error: "Isi username, email, atau ID pemain yang valid." });
  }
  try {
    assertValidPassword(newPassword, "Password baru");
  } catch (error) {
    return send(res, error.status || 400, { error: error.message });
  }

  const normalizedIdentifier = normalizeEmail(identifier);
  const usernameIdentifier = normalizeUsername(identifier);
  let user = unwrap(await db.from("users").select("id, username, email, given_id").eq("username", usernameIdentifier).maybeSingle());
  if (!user && isValidEmail(normalizedIdentifier)) {
    user = unwrap(await db.from("users").select("id, username, email, given_id").eq("email", normalizedIdentifier).maybeSingle());
  }
  if (!user && /^\d{7}$/.test(identifier)) {
    user = unwrap(await db.from("users").select("id, username, email, given_id").eq("given_id", identifier).maybeSingle());
  }
  if (!user) {
    return send(res, 404, { error: "Akun tidak ditemukan. Cek lagi username, email, atau ID pemain." });
  }

  unwrap(await db.from("users").update({ password_hash: hashPassword(newPassword) }).eq("id", user.id));
  await db.from("sessions").delete().eq("user_id", user.id);

  return send(res, 200, {
    ok: true,
    message: `Password @${user.username} berhasil direset. User harus login dengan password baru.`,
    user: { username: user.username, email: user.email, given_id: user.given_id },
  });
}

async function register(req, res, db) {
  const data = body(req);
  const name = normalizeName(data.name);
  const username = normalizeUsername(data.username);
  const phone = normalizePhone(data.phone);
  const email = normalizeEmail(data.email);
  const password = String(data.password || "");
  const city = normalizeCity(data.city);
  const school = normalizeSchool(data.school || data.school_other || data.schoolOther);
  const gender = ["male", "female"].includes(data.gender) ? data.gender : "male";

  if (!isValidPersonName(name)) return send(res, 400, { error: "Nama wajib 2-60 karakter dan hanya boleh huruf/spasi tanpa simbol." });
  if (!isValidUsername(username)) return send(res, 400, { error: "Username harus 3-24 karakter dan hanya boleh huruf kecil, angka, _, -, atau titik. Username tidak bisa diganti." });
  if (!isValidPhone(phone)) return send(res, 400, { error: "Nomor WhatsApp harus format +62 dan hanya angka, contoh +6281234567890." });
  if (!isValidEmail(email)) return send(res, 400, { error: "Email aktif tidak valid." });
  try {
    assertValidPassword(password);
  } catch (error) {
    return send(res, error.status || 400, { error: error.message });
  }
  if (!isValidCity(city)) return send(res, 400, { error: "Kota wajib 2-25 karakter dan hanya boleh huruf/angka/spasi tanpa simbol." });
  if (!isValidSchool(school)) return send(res, 400, { error: "Asal sekolah wajib diisi. Pilih sekolah dari daftar atau isi Others maksimal 40 karakter tanpa simbol." });

  const existingUsername = unwrap(await db.from("users").select("id").eq("username", username).maybeSingle());
  const existingPhone = unwrap(await db.from("users").select("id").eq("phone", phone).maybeSingle());
  const existingEmail = unwrap(await db.from("users").select("id").eq("email", email).maybeSingle());
  if (existingUsername || existingPhone || existingEmail) return send(res, 400, { error: "Username, nomor WhatsApp, atau email sudah dipakai." });

  const userId = id("user");
  unwrap(await db.from("users").insert({
    id: userId,
    given_id: await generateUniqueGivenId(db),
    name,
    username,
    phone,
    email,
    city,
    school,
    gender,
    password_hash: hashPassword(password),
  }));
  unwrap(await db.from("user_settings").insert({ user_id: userId }));
  return send(res, 200, { ok: true });
}

async function login(req, res, db) {
  const data = body(req);
  const username = normalizeUsername(data.username);
  const password = String(data.password || "");
  if (!isValidUsername(username) || password.length < 1 || password.length > MAX_PASSWORD_LENGTH) {
    return send(res, 401, { error: "Username atau password salah." });
  }
  const user = unwrap(await db.from("users").select("*").eq("username", username).maybeSingle());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return send(res, 401, { error: "Username atau password salah." });
  }
  const token = id("sess");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * ONE_DAY_MS).toISOString();
  await db.from("sessions").delete().eq("user_id", user.id);
  unwrap(await db.from("sessions").insert({
    token_hash: await digest(token),
    user_id: user.id,
    expires_at: expiresAt,
    user_agent: req.headers["user-agent"] || "",
    ip_hint: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "",
  }));
  await runStorageMaintenance(db, user.id);
  await Promise.all([
    db.from("users").update({ last_seen_at: new Date().toISOString() }).eq("id", user.id),
    touchPresence(user),
  ]);
  return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(token) });
}

async function logout(req, res, db) {
  const token = cookie(req, "force_session");
  if (token) await db.from("sessions").delete().eq("token_hash", await digest(token));
  return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", true) });
}

async function requireUser(req, res, db) {
  const token = cookie(req, "force_session");
  if (!token) throw Object.assign(new Error("Silakan login dulu."), { status: 401 });
  const session = unwrap(await db.from("sessions").select("token_hash, user_id, expires_at, created_at").eq("token_hash", await digest(token)).maybeSingle());
  if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
    throw Object.assign(new Error("Session expired."), { status: 401 });
  }

  const sessionAgeMs = Date.now() - new Date(session.created_at || 0).getTime();
  if (sessionAgeMs >= SESSION_ROTATION_DAYS * ONE_DAY_MS) {
    const rotatedToken = id("sess");
    const rotatedAt = new Date().toISOString();
    const rotatedExpiresAt = new Date(Date.now() + SESSION_DAYS * ONE_DAY_MS).toISOString();
    const updated = unwrap(await db.from("sessions").update({
      token_hash: await digest(rotatedToken),
      expires_at: rotatedExpiresAt,
      created_at: rotatedAt,
      user_agent: req.headers["user-agent"] || "",
      ip_hint: clientIp(req),
    }).eq("token_hash", session.token_hash).select("token_hash"));
    if (updated.length) res.setHeader("Set-Cookie", sessionCookie(rotatedToken));
  }

  const user = unwrap(await db.from("users").select("*").eq("id", session.user_id).single());

  // Supabase-only presence: update at most once per minute to keep online status useful without writing on every API call.
  const lastSeenMs = user.last_seen_at ? new Date(user.last_seen_at).getTime() : 0;
  if (Date.now() - lastSeenMs > 60 * 1000) {
    await db.from("users").update({ last_seen_at: new Date().toISOString() }).eq("id", user.id);
  }

  return user;
}

async function settingsFor(db, userId) {
  let settings = unwrap(await db.from("user_settings").select("*").eq("user_id", userId).maybeSingle());
  if (!settings) {
    settings = unwrap(await db.from("user_settings").insert({ user_id: userId }).select("*").single());
  }
  return settings;
}

async function mePayload(db, user) {
  // A fire streak is only alive through today (already played) or yesterday
  // (the user can still extend it today). Older values must not remain visible.
  const fireStreakExpired = Number(user.fire_streak_days || 0) > 0
    && user.last_fire_date !== todayDate()
    && user.last_fire_date !== yesterdayDate();
  if (fireStreakExpired && Number(user.fire_streak_days || 0) !== 0) {
    await db.from("users").update({ fire_streak_days: 0 }).eq("id", user.id);
    user = { ...user, fire_streak_days: 0 };
  }
  const settings = await settingsFor(db, user.id);
  await runStorageMaintenance(db, user.id);
  const leaders = unwrap(await db.from("users").select("id, username, weekly_fp, lifetime_fp, created_at").order("weekly_fp", { ascending: false }).order("lifetime_fp", { ascending: false }).order("created_at", { ascending: true }).limit(200));
  const myRank = leaders.findIndex((row) => row.id === user.id) + 1 || null;
  const duelsToday = await duelsTodayCount(db, user.id);
  const duelRows = await selectDuelsForUser(db, user.id, {
    columns: "id, status, user_id, opponent_id, opponent_name, user_score, opponent_score, fp_awarded, opponent_fp_awarded, started_at, finished_at",
    status: "finished",
    ascending: false,
    limit: DUEL_HISTORY_LIMIT,
  });
  const otherUserIds = [...new Set(duelRows
    .map((duel) => duel.user_id === user.id ? duel.opponent_id : duel.user_id)
    .filter(Boolean))];
  const otherUsers = otherUserIds.length
    ? unwrap(await db.from("users").select("id, username").in("id", otherUserIds))
    : [];
  const otherById = new Map(otherUsers.map((row) => [row.id, row]));
  const duelHistory = duelRows.map((duel) => {
    const side = participantSide(duel, user.id);
    const opponentId = side === "user" ? duel.opponent_id : duel.user_id;
    return {
      ...duel,
      opponent_name: otherById.get(opponentId)?.username || duel.opponent_name || "Force Rival",
      result: resultForSide(resultForDuel(duel), side),
      user_score: side === "user" ? duel.user_score : duel.opponent_score,
      opponent_score: side === "user" ? duel.opponent_score : duel.user_score,
      fp_awarded: side === "user" ? duel.fp_awarded : Number(duel.opponent_fp_awarded || 0),
    };
  });
  const { password_hash, ...safeUser } = user;
  return {
    user: { ...safeUser, settings, is_admin: isAdminUser(user) },
    dashboard: {
      myRank,
      top3: leaders.slice(0, 3).map((row, index) => ({ ...row, rank: index + 1 })),
      duelsToday,
      dailyDuelLimit: DAILY_DUEL_LIMIT,
      duelHistory,
    },
  };
}

async function runStorageMaintenance(db, userId = null) {
  const now = Date.now();
  if (userId) await trimUserSessions(db, userId);
  if (now - maintenanceLastRunAt < 5 * 60 * 1000) return;
  maintenanceLastRunAt = now;
  const jobs = [
    cleanupExpiredSessions(db),
    cleanupExpiredPasswordResetCodes(db),
    cleanupOldDuels(db),
    cleanupOldWeeklySnapshots(db),
    cleanupExpiredDuelRequests(db),
    cleanupDuelRequestHistory(db),
    cleanupMatchQueue(db),
  ];
  await Promise.all(jobs);
}

async function cleanupExpiredSessions(db) {
  await db.from("sessions").delete().lt("expires_at", new Date().toISOString());
}

async function cleanupExpiredPasswordResetCodes(db) {
  await db.from("password_reset_codes").delete().lt("expires_at", new Date().toISOString());
  await db.from("password_reset_codes").delete().not("used_at", "is", null).lt("used_at", new Date(Date.now() - ONE_DAY_MS).toISOString());
}

async function trimUserSessions(db, userId) {
  const oldSessions = unwrap(await db
    .from("sessions")
    .select("token_hash")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(SESSION_KEEP_PER_USER, 1000));
  if (oldSessions.length) {
    await db.from("sessions").delete().in("token_hash", oldSessions.map((session) => session.token_hash));
  }
}

async function cleanupDuelRequestHistory(db) {
  await cleanupAcceptedFinishedDuelRequests(db);
  const now = Date.now();
  await db.from("duel_requests").delete().in("status", ["declined", "cancelled"]).lt("responded_at", new Date(now - 60 * 60 * 1000).toISOString());
  await db.from("duel_requests").delete().eq("status", "accepted").lt("responded_at", new Date(now - 10 * 60 * 1000).toISOString());
}

async function cleanupAcceptedFinishedDuelRequests(db) {
  const rows = unwrap(await db
    .from("duel_requests")
    .select("id, duel_id")
    .eq("status", "accepted")
    .not("duel_id", "is", null)
    .limit(100));
  if (!rows.length) return;

  const duelIds = [...new Set(rows.map((row) => row.duel_id).filter(Boolean))];
  const activeDuels = duelIds.length
    ? unwrap(await db.from("duels").select("id").in("id", duelIds).eq("status", "active"))
    : [];
  const activeDuelIds = new Set(activeDuels.map((duel) => duel.id));
  const staleRequestIds = rows.filter((row) => !activeDuelIds.has(row.duel_id)).map((row) => row.id);
  if (staleRequestIds.length) {
    await db.from("duel_requests").update({ status: "cancelled", responded_at: new Date().toISOString() }).in("id", staleRequestIds);
  }
}

async function cleanupMatchQueue(db) {
  const now = Date.now();
  await db.from("duel_queue").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("status", "matched").lt("updated_at", new Date(now - 2 * 60 * 1000).toISOString());
  await db.from("duel_queue").delete().eq("status", "cancelled").lt("updated_at", new Date(now - 60 * 60 * 1000).toISOString());
}

async function cleanupOldDuels(db) {
  const now = Date.now();
  await db.from("duels").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("status", "active").lt("started_at", new Date(now - 30 * 60 * 1000).toISOString());
  await db.from("duels").delete().in("status", ["finished", "cancelled"]).lt("finished_at", new Date(now - DATA_RETENTION_DAYS * ONE_DAY_MS).toISOString());
}

async function cleanupOldWeeklySnapshots(db) {
  // Hall of Legends only needs recent weekly winners.
  // Once a weekly snapshot is older than 2 weeks, remove it automatically.
  await db.from("weekly_rank_snapshots").delete().lt("week_key", daysAgoDate(14));
}

async function changeMyPassword(req, res, db, user) {
  const data = body(req);
  const currentPassword = String(data.currentPassword || data.oldPassword || "");
  const newPassword = String(data.newPassword || data.password || "");
  const confirmPassword = String(data.confirmPassword || "");

  if (!currentPassword || currentPassword.length > MAX_PASSWORD_LENGTH) return send(res, 400, { error: "Password lama wajib diisi." });
  try {
    assertValidPassword(newPassword, "Password baru");
  } catch (error) {
    return send(res, error.status || 400, { error: error.message });
  }
  if (confirmPassword && newPassword !== confirmPassword) return send(res, 400, { error: "Konfirmasi password baru tidak sama." });
  if (!verifyPassword(currentPassword, user.password_hash)) {
    return send(res, 401, { error: "Password lama salah." });
  }
  if (verifyPassword(newPassword, user.password_hash)) {
    return send(res, 400, { error: "Password baru tidak boleh sama dengan password lama." });
  }

  unwrap(await db.from("users").update({ password_hash: hashPassword(newPassword) }).eq("id", user.id));

  // Tetap pertahankan sesi login saat ini, tapi hapus sesi lama di device lain.
  const token = cookie(req, "force_session");
  if (token) {
    const tokenHash = await digest(token);
    await db.from("sessions").delete().eq("user_id", user.id).neq("token_hash", tokenHash);
  }

  return send(res, 200, { ok: true, message: "Password berhasil diganti." });
}

async function updateProfile(req, res, db, user) {
  const data = body(req);
  const name = normalizeName(data.name);
  const requestedUsername = normalizeUsername(data.username);
  const phone = normalizePhone(data.phone);
  const email = normalizeEmail(data.email);
  const city = normalizeCity(data.city);
  const gender = ["male", "female"].includes(data.gender) ? data.gender : "";

  if (requestedUsername && requestedUsername !== user.username) {
    return send(res, 400, { error: "Username tidak bisa diganti setelah akun dibuat." });
  }
  if (!isValidPersonName(name)) return send(res, 400, { error: "Nama harus 2-60 karakter dan hanya boleh huruf/spasi tanpa simbol." });
  if (!isValidPhone(phone)) return send(res, 400, { error: "Nomor WhatsApp harus format +62 dan hanya angka." });
  if (!isValidEmail(email)) return send(res, 400, { error: "Email aktif tidak valid." });
  if (city && !isValidCity(city)) return send(res, 400, { error: "Nama kota harus 2-25 karakter dan hanya boleh huruf/angka/spasi tanpa simbol." });
  if (!gender) return send(res, 400, { error: "Jenis kelamin tidak valid." });

  const phoneExists = unwrap(await db.from("users").select("id").eq("phone", phone).neq("id", user.id).maybeSingle());
  if (phoneExists) return send(res, 400, { error: "Nomor WhatsApp sudah dipakai." });
  const emailExists = unwrap(await db.from("users").select("id").eq("email", email).neq("id", user.id).maybeSingle());
  if (emailExists) return send(res, 400, { error: "Email sudah dipakai." });

  unwrap(await db.from("users").update({ name, phone, email, city, gender }).eq("id", user.id));
  return send(res, 200, { ok: true });
}

async function updateSettings(req, res, db, user) {
  const data = body(req);
  const musicEnabled = data.music_enabled === undefined ? true : Boolean(data.music_enabled);
  const sfxEnabled = data.sfx_enabled === undefined ? true : Boolean(data.sfx_enabled);
  unwrap(await db.from("user_settings").upsert({
    user_id: user.id,
    music_enabled: musicEnabled,
    sfx_enabled: sfxEnabled,
  }, { onConflict: "user_id" }));
  return send(res, 200, { ok: true });
}

async function members(req, res, db, user) {
  const rawQ = String(req.query.q || "");
  if (rawQ.length > 40) return send(res, 400, { error: "Pencarian member maksimal 40 karakter." });
  const q = sanitizeMemberSearch(rawQ);
  if (q !== rawQ.trim() || !isValidMemberSearch(q)) {
    return send(res, 400, { error: "Pencarian member hanya boleh huruf, angka, spasi, underscore, titik, @, dan strip." });
  }
  const tabRaw = String(req.query.tab || "all");
  const tab = ["all", "online", "favourites"].includes(tabRaw) ? tabRaw : "all";
  const rels = unwrap(await db.from("relationships").select("owner_id, target_id, is_favourite").eq("owner_id", user.id));
  const relByTarget = new Map(rels.map((rel) => [rel.target_id, rel]));
  const memberColumns = "id, given_id, name, username, city, school, gender, lifetime_fp, weekly_fp, wins, losses, draws, total_correct, total_answer_time_ms, total_answers, current_win_streak, fire_streak_days, last_seen_at";
  const applyBaseFilters = (query) => {
    let next = query.neq("id", user.id);
    if (tab === "favourites") {
      const ids = rels.filter((rel) => rel.is_favourite).map((rel) => rel.target_id);
      if (!ids.length) return null;
      next = next.in("id", ids);
    }
    return next.order("weekly_fp", { ascending: false }).order("username", { ascending: true }).limit(80);
  };
  if (tab === "favourites") {
    const ids = rels.filter((rel) => rel.is_favourite).map((rel) => rel.target_id);
    if (!ids.length) return send(res, 200, { members: [] });
  }
  let rows;
  if (q) {
    const safeQ = escapeLikePattern(q);
    const searches = [
      applyBaseFilters(db.from("users").select(memberColumns).ilike("username", `%${safeQ}%`)),
      applyBaseFilters(db.from("users").select(memberColumns).ilike("name", `%${safeQ}%`)),
      applyBaseFilters(db.from("users").select(memberColumns).ilike("given_id", `%${safeQ}%`)),
    ].filter(Boolean);
    const results = await Promise.all(searches);
    rows = [...new Map(results.flatMap((result) => unwrap(result)).map((row) => [row.id, row])).values()]
      .sort((a, b) => Number(b.weekly_fp || 0) - Number(a.weekly_fp || 0) || String(a.username || "").localeCompare(String(b.username || "")))
      .slice(0, 80);
  } else {
    const query = applyBaseFilters(db.from("users").select(memberColumns));
    rows = query ? unwrap(await query) : [];
  }
  const onlineById = await onlineStatusByUserIds(rows);
  const members = rows.map((member) => {
    const rel = relByTarget.get(member.id) || {};
    const online = Boolean(onlineById.get(member.id));
    return { ...member, online, is_friend: true, is_favourite: Boolean(rel.is_favourite) };
  }).filter((member) => tab !== "online" || member.online);
  return send(res, 200, { members, stateProvider: "supabase" });
}

async function relation(req, res, db, user, targetId) {
  assertValidUserId(targetId);
  if (targetId === user.id) return send(res, 400, { error: "Tidak bisa menandai diri sendiri." });
  const data = body(req);
  if (data.type !== "favourite") return send(res, 200, { ok: true, relation: { is_friend: true, is_favourite: false } });
  const current = unwrap(await db.from("relationships").select("owner_id, target_id, is_favourite").eq("owner_id", user.id).eq("target_id", targetId).maybeSingle());
  let next;
  if (!current) {
    next = unwrap(await db.from("relationships").insert({ owner_id: user.id, target_id: targetId, is_favourite: true }).select("owner_id, target_id, is_favourite").single());
  } else {
    next = unwrap(await db.from("relationships").update({ is_favourite: !current.is_favourite }).eq("owner_id", user.id).eq("target_id", targetId).select("owner_id, target_id, is_favourite").single());
  }
  return send(res, 200, { ok: true, relation: { is_friend: true, is_favourite: Boolean(next.is_favourite) } });
}

async function inviteDuelRequest(req, res, db, user, targetId) {
  const data = body(req);
  const categoryKey = parseDuelCategorySelection(data.category_key ?? data.categoryKey ?? data.category ?? req.query?.category_key ?? req.query?.category ?? "");
  return inviteDuelRequestSupabase(res, db, user, targetId, categoryKey);
}

async function duelRequests(res, db, user) {
  return duelRequestsSupabase(res, db, user);
}

async function respondDuelRequest(req, res, db, user, requestId) {
  return respondDuelRequestSupabase(req, res, db, user, requestId);
}

async function inviteDuelRequestSupabase(res, db, user, targetId, categoryKey = "") {
  categoryKey = parseDuelCategorySelection(categoryKey);
  assertValidUserId(targetId);
  if (targetId === user.id) return send(res, 400, { error: "Tidak bisa invite diri sendiri." });
  const myActiveDuelId = await activeDuelIdForUser(db, user.id);
  if (myActiveDuelId) return send(res, 400, { error: "Kamu masih sedang dalam permainan." });
  const targetActiveDuelId = await activeDuelIdForUser(db, targetId);
  if (targetActiveDuelId) return send(res, 400, { error: "Member sedang dalam permainan, belum bisa di-invite." });
  await cleanupExpiredDuelRequests(db);
  const [myCount, member] = await Promise.all([
    duelsTodayCount(db, user.id),
    db.from("users").select("id, last_seen_at").eq("id", targetId).maybeSingle(),
  ]);
  if (myCount >= DAILY_DUEL_LIMIT) return send(res, 429, { error: `Limit ${DAILY_DUEL_LIMIT} duel per hari sudah tercapai.` });
  if (member.error) throw member.error;
  const target = member.data;
  if (!target) return send(res, 404, { error: "Member tidak ditemukan." });
  if (!await isOnlineUser(target)) return send(res, 400, { error: "Member sedang offline, tidak bisa di-invite duel." });
  const opponentTodayCount = await duelsTodayCount(db, targetId);
  if (opponentTodayCount >= DAILY_DUEL_LIMIT) return send(res, 429, { error: `Lawan sudah mencapai limit ${DAILY_DUEL_LIMIT}/${DAILY_DUEL_LIMIT} hari ini.` });

  // Prevent repeated taps from creating many pending invites and making the UI/server unstable.
  // While one outgoing invite is still alive, return that invite instead of inserting/refreshing another one.
  const existingOutgoing = unwrap(await db
    .from("duel_requests")
    .select("*")
    .eq("requester_id", user.id)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle());

  if (existingOutgoing) {
    return send(res, 200, {
      ok: true,
      alreadyPending: true,
      request: existingOutgoing,
      expires_in_ms: Math.max(0, new Date(existingOutgoing.expires_at).getTime() - Date.now()),
    });
  }

  const expiresAt = new Date(Date.now() + DUEL_REQUEST_WAIT_MS).toISOString();
  const request = unwrap(await db.from("duel_requests").insert({ id: id("req"), requester_id: user.id, target_id: targetId, play_mode: duelPlayMode(categoryKey), category_key: categoryKey || null, status: "pending", expires_at: expiresAt }).select("*").single());
  return send(res, 200, { ok: true, request, expires_in_ms: DUEL_REQUEST_WAIT_MS });
}

async function duelRequestsSupabase(res, db, user) {
  await cleanupExpiredDuelRequests(db);
  const requestColumns = "id, created_at, expires_at, requester_id, target_id, play_mode, category_key, status, duel_id";
  const [incomingRows, outgoingRows] = await Promise.all([
    db.from("duel_requests").select(requestColumns).eq("target_id", user.id).in("status", ["pending", "accepted"]).order("created_at", { ascending: false }).limit(20),
    db.from("duel_requests").select(requestColumns).eq("requester_id", user.id).in("status", ["pending", "accepted"]).order("created_at", { ascending: false }).limit(20),
  ]);
  let rows = [...new Map([...unwrap(incomingRows), ...unwrap(outgoingRows)].map((row) => [row.id, row])).values()]
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 20);

  // Jangan kirim lagi request accepted lama yang duel-nya sudah selesai/cancelled.
  // Ini mencegah polling invite lama memanggil beginDuel() lagi setelah duel pertama selesai.
  const acceptedDuelIds = [...new Set(rows
    .filter((row) => row.status === "accepted" && row.duel_id)
    .map((row) => row.duel_id))];
  if (acceptedDuelIds.length) {
    const activeDuels = unwrap(await db
      .from("duels")
      .select("id, status")
      .in("id", acceptedDuelIds)
      .eq("status", "active"));
    const activeDuelIds = new Set(activeDuels.map((duel) => duel.id));
    const staleAcceptedIds = rows
      .filter((row) => row.status === "accepted" && row.duel_id && !activeDuelIds.has(row.duel_id))
      .map((row) => row.id);
    if (staleAcceptedIds.length) {
      await db.from("duel_requests").update({ status: "cancelled", responded_at: new Date().toISOString() }).in("id", staleAcceptedIds);
    }
    rows = rows.filter((row) => row.status !== "accepted" || (row.duel_id && activeDuelIds.has(row.duel_id)));
  }

  const requesterIds = [...new Set(rows.map((row) => row.requester_id))];
  const targetIds = [...new Set(rows.map((row) => row.target_id))];
  const userIds = [...new Set([...requesterIds, ...targetIds])];
  const requesters = requesterIds.length
    ? unwrap(await db.from("users").select("id, username, name").in("id", requesterIds))
    : [];
  const users = userIds.length
    ? unwrap(await db.from("users").select("id, username, name").in("id", userIds))
    : [];
  const byId = new Map(requesters.map((requester) => [requester.id, requester]));
  const userById = new Map(users.map((row) => [row.id, row]));
  const incoming = rows.filter((row) => row.target_id === user.id && row.status === "pending");
  const outgoing = rows.filter((row) => row.requester_id === user.id);
  const nowMs = Date.now();
  const withCountdown = (row) => ({
    ...row,
    expires_in_ms: Math.max(0, new Date(row.expires_at).getTime() - nowMs),
  });
  return send(res, 200, {
    requests: incoming.map((row) => ({
      ...withCountdown(row),
      id: row.id,
      created_at: row.created_at,
      expires_at: row.expires_at,
      requester_id: row.requester_id,
      requester_username: byId.get(row.requester_id)?.username || "member",
      requester_name: byId.get(row.requester_id)?.name || "Member",
      play_mode: row.play_mode || duelPlayMode(row.category_key),
      category_key: row.category_key || null,
      category_label: duelCategoryLabel(row.category_key || ""),
    })),
    outgoing: outgoing.map((row) => ({
      ...withCountdown(row),
      id: row.id,
      status: row.status,
      created_at: row.created_at,
      expires_at: row.expires_at,
      duel_id: row.duel_id,
      target_id: row.target_id,
      target_username: userById.get(row.target_id)?.username || "member",
      target_name: userById.get(row.target_id)?.name || "Member",
      play_mode: row.play_mode || duelPlayMode(row.category_key),
      category_key: row.category_key || null,
      category_label: duelCategoryLabel(row.category_key || ""),
    })),
  });
}

async function respondDuelRequestSupabase(req, res, db, user, requestId) {
  assertValidRequestId(requestId);
  const data = body(req);
  if (!["accept", "decline"].includes(String(data.action || ""))) {
    return send(res, 400, { error: "Aksi request duel tidak valid." });
  }
  await cleanupExpiredDuelRequests(db);
  const row = unwrap(await db.from("duel_requests").select("*").eq("id", requestId).eq("target_id", user.id).eq("status", "pending").maybeSingle());
  if (!row) return send(res, 404, { error: "Request duel tidak ditemukan." });
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    unwrap(await db.from("duel_requests").update({ status: "cancelled", responded_at: new Date().toISOString() }).eq("id", requestId));
    return send(res, 400, { error: "Waktu accept sudah lewat 30 detik." });
  }
  if (data.action !== "accept") {
    unwrap(await db.from("duel_requests").update({ status: "declined", responded_at: new Date().toISOString() }).eq("id", requestId));
    return send(res, 200, { ok: true });
  }
  const duel = await createDuel(db, user, row.requester_id, row.category_key || "");
  unwrap(await db.from("duel_requests").update({ status: "accepted", responded_at: new Date().toISOString(), duel_id: duel.id }).eq("id", requestId));
  return send(res, 200, { ok: true, duel });
}

async function cleanupExpiredDuelRequests(db) {
  await db
    .from("duel_requests")
    .update({ status: "cancelled", responded_at: new Date().toISOString() })
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString());
}


async function leaderboard(req, res, db, viewer = null) {
  await cleanupOldWeeklySnapshots(db);
  const requestedSchool = normalizeSchool(req?.query?.school || "");
  const schoolFilter = requestedSchool && isValidSchool(requestedSchool) ? requestedSchool : "";
  let query = db
    .from("users")
    .select("id, name, username, gender, school, lifetime_fp, weekly_fp, fire_streak_days, created_at")
    .order("weekly_fp", { ascending: false })
    .order("lifetime_fp", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(200);
  if (schoolFilter) query = query.eq("school", schoolFilter);
  const rows = unwrap(await query);

  const ranked = rows.map((row, index) => ({
    id: row.id,
    name: row.name,
    username: row.username,
    gender: row.gender,
    school: row.school || "",
    lifetime_fp: Number(row.lifetime_fp || 0),
    weekly_fp: Number(row.weekly_fp || 0),
    fire_streak_days: Number(row.fire_streak_days || 0),
    rank: index + 1,
    is_me: row.id === viewer?.id,
  }));

  const fire = [...rows]
    .sort((a, b) => Number(b.fire_streak_days || 0) - Number(a.fire_streak_days || 0))
    .slice(0, 3)
    .map(({ username, fire_streak_days }) => ({ username, fire_streak_days }));

  const lifetime = [...rows]
    .sort((a, b) => Number(b.lifetime_fp || 0) - Number(a.lifetime_fp || 0))
    .slice(0, 3)
    .map(({ username, lifetime_fp }) => ({ username, lifetime_fp }));

  const latestSnapshot = unwrap(await db
    .from("weekly_rank_snapshots")
    .select("week_key")
    .order("week_key", { ascending: false })
    .limit(1)
    .maybeSingle());
  const previousWeekRows = latestSnapshot
    ? unwrap(await db
      .from("weekly_rank_snapshots")
      .select("user_id, week_key, rank, weekly_fp, created_at")
      .eq("week_key", latestSnapshot.week_key)
      .order("rank", { ascending: true })
      .limit(3))
    : [];
  const snapshotUserIds = [...new Set(previousWeekRows.map((row) => row.user_id))];
  const snapshotUsers = snapshotUserIds.length
    ? unwrap(await db.from("users").select("id, name, username").in("id", snapshotUserIds))
    : [];
  const snapshotByUser = new Map(snapshotUsers.map((user) => [user.id, user]));
  const lastWinners = previousWeekRows.map((row) => ({
    ...row,
    name: snapshotByUser.get(row.user_id)?.name || "Member",
    username: snapshotByUser.get(row.user_id)?.username || "member",
  }));

  const schoolRows = unwrap(await db
    .from("users")
    .select("school")
    .not("school", "is", null)
    .neq("school", "")
    .limit(3000));
  const dynamicSchoolOptions = [...new Set([
    ...SCHOOL_OPTIONS,
    ...schoolRows.map((row) => normalizeSchool(row.school)).filter((school) => school && isValidSchool(school)),
  ])].sort((a, b) => {
    const ai = SCHOOL_OPTIONS.indexOf(a);
    const bi = SCHOOL_OPTIONS.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
    return a.localeCompare(b, "id");
  });

  const payload = {
    rows: ranked,
    schoolFilter,
    schoolOptions: dynamicSchoolOptions,
    legends: { lastWeek: lastWinners, fire, lifetime },
    weekly: {
      currentWeek: weekKey(),
      recapAt: "Minggu 23:50 WIB",
      resetAt: "Senin 00:00 WIB",
      lastWinners,
    },
  };
  return send(res, 200, { ...payload, stateProvider: "supabase" });
}

async function badges(res, db, user) {
  return send(res, 410, { error: "Sistem badge sementara dinonaktifkan untuk menghemat database.", total: 0, unlocked: 0, badges: [] });
}

async function startDuel(req, res, db, user) {
  const data = body(req);
  const categoryKey = parseDuelCategorySelection(data.category_key ?? data.categoryKey ?? data.category ?? req.query?.category_key ?? req.query?.category ?? "");
  return send(res, 200, await joinMatchmaking(db, user, categoryKey));
}

async function joinMatchmaking(db, user, categoryKey = "") {
  return joinMatchmakingSupabase(db, user, categoryKey);
}

async function joinMatchmakingSupabase(db, user, categoryKey = "") {
  categoryKey = parseDuelCategorySelection(categoryKey);

  const matchResult = await db.rpc("force_matchmake_duel", {
    p_user_id: user.id,
    p_category_key: categoryKey || null,
    p_daily_limit: DAILY_DUEL_LIMIT,
    p_start_buffer_ms: DUEL_START_BUFFER_MS,
  });
  if (matchResult.error) throw normalizeDuelPoolError(matchResult.error);

  const match = matchResult.data || {};
  if (match.state === "matched" && match.duel_id) {
    const duel = unwrap(await db
      .from("duels")
      .select("*")
      .eq("id", match.duel_id)
      .maybeSingle());
    if (!duel || duel.status !== "active" || !isDuelParticipant(duel, user.id)) {
      throw Object.assign(new Error("Duel hasil matchmaking tidak ditemukan."), { status: 500 });
    }
    return {
      duel: await duelPayload(db, duel, user.id),
      alreadyInDuel: Boolean(match.already_in_duel),
    };
  }

  return {
    waiting: true,
    message: categoryKey ? `Menunggu lawan online untuk kategori ${duelCategoryLabel(categoryKey)}. Jangan tutup halaman ini.` : "Menunggu lawan online untuk duel random. Jangan tutup halaman ini.",
    category_key: categoryKey || null,
    category_label: duelCategoryLabel(categoryKey),
    queue: { staleInMs: MATCH_QUEUE_STALE_MS, category_key: categoryKey || null },
  };
}

function normalizeDuelPoolError(error) {
  const message = String(error?.message || "");

  if (message.includes("LIMIT_REACHED")) {
    return Object.assign(new Error(`Limit ${DAILY_DUEL_LIMIT} duel per hari sudah tercapai.`), { status: 429 });
  }

  if (message.includes("QUESTION_POOL_NOT_READY") || message.includes("DAILY_POOL_GENERATION_FAILED")) {
    return Object.assign(new Error(`Bank soal minimal ${DUEL_QUESTION_COUNT} pertanyaan belum tersedia.`), { status: 500 });
  }

  if (message.includes("NOT_ENOUGH_ACTIVE_QUESTIONS")) {
    return Object.assign(new Error(`Stok soal belum cukup. Pastikan kategori pilihan punya minimal 4 soal aktif dan FORCE CORE punya minimal 1 soal aktif.`), { status: 400 });
  }

  if (message.includes("DAILY_POOL_INCOMPLETE")) {
    return Object.assign(new Error("Bank soal belum lengkap. Coba tambah soal aktif sesuai kategori pilihan."), { status: 500 });
  }

  return error;
}

async function matchmakingStatus(res, db, user) {
  return matchmakingStatusSupabase(res, db, user);
}

async function matchmakingStatusSupabase(res, db, user) {
  const queue = unwrap(await db
    .from("duel_queue")
    .select("status, duel_id, play_mode, category_key, last_seen_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle());

  if (!queue || queue.status === "cancelled") {
    return send(res, 200, {
      waiting: false,
      cancelled: true,
      reason: "queue_cancelled",
      message: "Pencarian lawan dibatalkan atau sudah timeout.",
    });
  }

  if (queue.status === "matched") {
    if (!queue.duel_id) {
      await db.from("duel_queue").update({
        status: "cancelled",
        duel_id: null,
        updated_at: new Date().toISOString(),
      }).eq("user_id", user.id).eq("status", "matched");
      return send(res, 200, {
        waiting: false,
        cancelled: true,
        reason: "matched_without_duel",
        message: "Match lama sudah tidak valid. Silakan cari lawan lagi.",
      });
    }

    const duel = unwrap(await db.from("duels").select("*").eq("id", queue.duel_id).maybeSingle());
    if (duel && duel.status === "active" && isDuelParticipant(duel, user.id)) {
      return send(res, 200, { waiting: false, duel: await duelPayload(db, duel, user.id) });
    }

    await db.from("duel_queue").update({
      status: "cancelled",
      duel_id: null,
      updated_at: new Date().toISOString(),
    }).eq("user_id", user.id).eq("status", "matched");

    return send(res, 200, {
      waiting: false,
      cancelled: true,
      reason: "matched_duel_not_active",
      message: "Match sebelumnya sudah batal atau selesai. Silakan cari lawan lagi.",
    });
  }

  // The atomic RPC refreshes the heartbeat and retries pairing in one database
  // transaction, so two simultaneous entrants cannot remain stuck waiting.
  const retry = await joinMatchmakingSupabase(db, user, queue.category_key || "");
  return send(res, 200, retry);
}

async function cancelMatchmaking(res, db, user) {
  const queue = unwrap(await db
    .from("duel_queue")
    .select("status, duel_id")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle());

  if (queue?.status === "matched" && queue.duel_id) {
    const duel = unwrap(await db.from("duels").select("id, status").eq("id", queue.duel_id).maybeSingle());
    if (duel?.status === "active") {
      return send(res, 200, { ok: true, alreadyMatched: true, message: "Match sudah terbentuk. Duel akan dimulai." });
    }
  }

  await db.from("duel_queue").update({
    status: "cancelled",
    duel_id: null,
    updated_at: new Date().toISOString(),
  }).eq("user_id", user.id).in("status", ["waiting", "matched"]);

  return send(res, 200, { ok: true });
}

async function duelEvents(req, res, db, user, duelId) {
  assertValidUserId(duelId, "Duel");
  let duel = unwrap(await db.from("duels").select("*").eq("id", duelId).maybeSingle());
  if (!duel || !isDuelParticipant(duel, user.id)) return send(res, 404, { error: "Duel tidak ditemukan." });
  duel = await maybeSettleDuel(db, duel);
  return send(res, 200, { ok: true, cursor: String(req.query?.cursor || "0-0"), events: [], status: await duelStatusPayload(db, duel, user.id), stateProvider: "supabase" });
}

async function getDuel(res, db, user, duelId) {
  const duel = unwrap(await db.from("duels").select("*").eq("id", duelId).maybeSingle());
  if (!duel || !isDuelParticipant(duel, user.id)) return send(res, 404, { error: "Duel tidak ditemukan." });
  return send(res, 200, { duel: await duelPayload(db, duel, user.id) });
}

async function duelStatus(res, db, user, duelId) {
  let duel = unwrap(await db.from("duels").select("*").eq("id", duelId).maybeSingle());
  if (!duel || !isDuelParticipant(duel, user.id)) return send(res, 404, { error: "Duel tidak ditemukan." });
  duel = await maybeSettleDuel(db, duel);
  return send(res, 200, { status: await duelStatusPayload(db, duel, user.id) });
}

async function ensureDailyQuestionPool(db, force = false) {
  // Schema v4.1 tidak memakai daily pool lagi.
  // Function ini dibiarkan sebagai compatibility no-op untuk kode lama.
  const result = await db.rpc("force_pick_question_ids", {
    p_category_key: "global",
    p_limit: 1,
    p_exclude_ids: [],
  });
  if (result.error) throw normalizeDuelPoolError(result.error);
  return Array.isArray(result.data) ? result.data.length : 0;
}

async function pickQuestionIds(db, categoryKey, limit, excludeIds = []) {
  const result = await db.rpc("force_pick_question_ids", {
    p_category_key: categoryKey,
    p_limit: limit,
    p_exclude_ids: [...new Set(excludeIds.filter(Boolean))],
  });
  if (result.error) throw normalizeDuelPoolError(result.error);
  const ids = Array.isArray(result.data) ? result.data : [];
  if (ids.length < limit) {
    throw Object.assign(new Error(`Stok soal kategori ${duelCategoryLabel(categoryKey)} belum cukup.`), { status: 400 });
  }
  return ids;
}

async function recentQuestionExclusions() {
  // Supabase-only low-cost build: skip per-user recent-question cache.
  return [];
}

async function rememberRecentQuestions() {
  // No temporary cache table is used in the Supabase-only build.
}

async function duelQuestionSet(db, categoryKey = "", participantIds = []) {
  categoryKey = parseDuelCategorySelection(categoryKey);
  const excludeCategories = categoryKey
    ? [categoryKey, FORCE_CORE_CATEGORY.key]
    : QUESTION_CATEGORIES.map((category) => category.key);
  const excludeIds = await recentQuestionExclusions(participantIds, excludeCategories);
  let selectedIds;
  if (categoryKey) {
    const mainIds = await pickQuestionIds(db, categoryKey, DUEL_QUESTION_COUNT - 1, excludeIds);
    const coreIds = await pickQuestionIds(db, FORCE_CORE_CATEGORY.key, 1, [...excludeIds, ...mainIds]);
    selectedIds = [...mainIds, ...coreIds];
  } else {
    const coreIds = await pickQuestionIds(db, FORCE_CORE_CATEGORY.key, 1, excludeIds);
    // Ask for five candidates because the SQL fallback may ignore exclusions.
    // Filtering here guarantees the required core ID is not duplicated.
    const randomCandidates = await pickQuestionIds(db, null, DUEL_QUESTION_COUNT, [...excludeIds, ...coreIds]);
    const randomIds = randomCandidates.filter((questionId) => !coreIds.includes(questionId)).slice(0, DUEL_QUESTION_COUNT - 1);
    selectedIds = [...randomIds, ...coreIds];
  }
  const uniqueSelectedIds = [...new Set(selectedIds)].slice(0, DUEL_QUESTION_COUNT);
  const rows = unwrap(await db.from("questions").select("*").in("id", uniqueSelectedIds));
  const byId = new Map(rows.map((question) => [question.id, question]));
  const questions = uniqueSelectedIds.map((questionId) => byId.get(questionId)).filter(Boolean);
  if (questions.length < DUEL_QUESTION_COUNT) {
    const message = categoryKey
      ? `Bank soal kategori ${duelCategoryLabel(categoryKey)} belum cukup. Butuh 4 soal kategori pilihan + 1 soal FORCE CORE.`
      : `Bank soal random belum cukup. Butuh minimal 1 soal FORCE CORE + ${DUEL_QUESTION_COUNT - 1} soal aktif bebas.`;
    throw Object.assign(new Error(message), { status: 500 });
  }
  await rememberRecentQuestions(participantIds, questions);
  return questions;
}

async function dailyDuelQuestions(db, categoryKey = "", participantIds = []) {
  return duelQuestionSet(db, categoryKey, participantIds);
}

async function duelQuestions(db, duelId) {
  const rows = unwrap(await db
    .from("duel_questions")
    .select("question_id, position")
    .eq("duel_id", duelId)
    .order("position", { ascending: true }));
  const ids = rows.map((row) => row.question_id);
  if (!ids.length) return [];
  const questions = unwrap(await db.from("questions").select("*").in("id", ids));
  const byId = new Map(questions.map((question) => [question.id, question]));
  return rows.map((row) => byId.get(row.question_id)).filter(Boolean);
}

async function duelPayload(db, duel, viewerId) {
  const questions = await ensureDuelQuestionSet(db, duel);
  const opponentId = participantSide(duel, viewerId) === "user" ? duel.opponent_id : duel.user_id;
  const opponent = opponentId
    ? unwrap(await db.from("users").select("id, username, gender").eq("id", opponentId).maybeSingle())
    : null;
  return duelPayloadFromQuestions(duel, questions, viewerId, opponent);
}

async function ensureDuelQuestionSet(db, duel) {
  let questions = await duelQuestions(db, duel.id);
  if (questions.length >= DUEL_QUESTION_COUNT) return questions;

  const existingAnswers = await db
    .from("duel_answers")
    .select("duel_id", { count: "exact", head: true })
    .eq("duel_id", duel.id);
  if (existingAnswers.error) throw existingAnswers.error;

  if (duel.status !== "active" || Number(existingAnswers.count || 0) > 0) {
    throw Object.assign(new Error("Soal duel tidak lengkap. Duel ini tidak bisa dilanjutkan."), { status: 409 });
  }

  const selectedQuestions = await dailyDuelQuestions(db, duel.play_mode === "category" ? duel.category_key : "", [duel.user_id, duel.opponent_id].filter(Boolean));
  if (selectedQuestions.length < DUEL_QUESTION_COUNT) {
    throw Object.assign(new Error(`Bank soal minimal ${DUEL_QUESTION_COUNT} pertanyaan belum tersedia.`), { status: 500 });
  }

  await db.from("duel_questions").delete().eq("duel_id", duel.id);
  unwrap(await db.from("duel_questions").insert(selectedQuestions.map((question, index) => ({
    duel_id: duel.id,
    question_id: question.id,
    position: index + 1,
  }))));

  questions = await duelQuestions(db, duel.id);
  if (questions.length < DUEL_QUESTION_COUNT) {
    throw Object.assign(new Error("Soal duel gagal dimuat. Coba mulai duel baru."), { status: 500 });
  }
  return questions;
}

function publicQuestion(question = {}) {
  const { correct_option, active, ...safe } = question;
  const categoryKey = question.category_key || "";
  const categoryLabel = duelCategoryLabel(categoryKey);
  return { ...safe, category: categoryLabel, category_key: categoryKey || null, category_label: categoryLabel };
}

function duelPayloadFromQuestions(duel, questions, viewerId, opponent = null) {
  const side = participantSide(duel, viewerId) || "user";
  const score = scoreForSide(duel, side);
  return {
    id: duel.id,
    mode: duel.opponent_id ? "realtime" : "unmatched",
    side,
    opponent_id: opponent?.id || (side === "user" ? duel.opponent_id : duel.user_id),
    status: duel.status,
    starts_at: duel.starts_at || duel.started_at,
    server_now: new Date().toISOString(),
    result: resultForSide(resultForDuel(duel), side),
    opponent_name: opponent?.username || duel.opponent_name || "Force Rival",
    opponent_gender: opponent?.gender || "male",
    opponent_score: score.theirs,
    play_mode: duel.play_mode || "category",
    category_key: duel.category_key || null,
    category_label: duelCategoryLabel(duel.category_key || ""),
    force_core_included: true,
    questions: questions.map(publicQuestion),
  };
}

function normalizeAnswerRow(row = {}) {
  return {
    duel_id: row.duel_id,
    question_id: row.question_id,
    user_id: row.user_id,
    selected_option: ["A", "B", "C", "D"].includes(row.selected_option) ? row.selected_option : null,
    is_correct: Boolean(row.is_correct),
    answer_time_ms: Math.max(0, Math.min(QUESTION_TIME_LIMIT_MS, Number(row.answer_time_ms || 0))),
    points: Math.max(0, Math.min(100, Number(row.points || 0))),
    answered_at: row.answered_at || new Date().toISOString(),
  };
}

async function readDuelAnswers(db, duelId) {
  return unwrap(await db
    .from("duel_answers")
    .select("duel_id, question_id, user_id, selected_option, is_correct, answer_time_ms, points, answered_at")
    .eq("duel_id", duelId)
    .order("answered_at", { ascending: true }));
}

async function duelStatusPayload(db, duel, viewerId) {
  const side = participantSide(duel, viewerId);
  const answers = await readDuelAnswers(db, duel.id);
  const mineId = side === "opponent" ? duel.opponent_id : duel.user_id;
  const theirsId = side === "opponent" ? duel.user_id : duel.opponent_id;
  const mine = answers.filter((answer) => answer.user_id === mineId);
  const theirs = answers.filter((answer) => answer.user_id === theirsId);
  const score = scoreForSide(duel, side);
  const publicAnswer = (answer) => ({
    questionId: answer.question_id,
    isCorrect: Boolean(answer.is_correct),
    answeredAt: answer.answered_at,
  });
  return {
    duelId: duel.id,
    status: duel.status,
    stateProvider: "supabase",
    server_now: new Date().toISOString(),
    result: resultForSide(resultForDuel(duel), side),
    mineAnswered: mine.length,
    opponentAnswered: duel.opponent_id ? theirs.length : Math.min(mine.length, DUEL_QUESTION_COUNT),
    mineAnswers: mine.map(publicAnswer),
    opponentAnswers: duel.opponent_id ? theirs.map(publicAnswer) : [],
    mineScore: duel.status === "finished" ? score.mine : mine.filter((answer) => answer.is_correct).length,
    opponentScore: duel.status === "finished" ? score.theirs : duel.opponent_id ? theirs.filter((answer) => answer.is_correct).length : Number(duel.opponent_score || 0),
    fpAwarded: side === "opponent" ? Number(duel.opponent_fp_awarded || 0) : Number(duel.fp_awarded || 0),
  };
}

async function createDuel(db, user, opponentId = null, categoryKey = "") {
  categoryKey = parseDuelCategorySelection(categoryKey);
  if (!opponentId) {
    throw Object.assign(new Error("Menunggu lawan online. Duel tidak dibuat dengan bot/template offline."), { status: 400 });
  }
  const todayCount = await duelsTodayCount(db, user.id);
  if (todayCount >= DAILY_DUEL_LIMIT) throw Object.assign(new Error(`Limit ${DAILY_DUEL_LIMIT} duel per hari sudah tercapai.`), { status: 429 });
  const opponentTodayCount = await duelsTodayCount(db, opponentId);
  if (opponentTodayCount >= DAILY_DUEL_LIMIT) {
    throw Object.assign(new Error(`Lawan sudah mencapai limit ${DAILY_DUEL_LIMIT} duel hari ini.`), { status: 429 });
  }

  const myActiveDuelId = await activeDuelIdForUser(db, user.id);
  if (myActiveDuelId) throw Object.assign(new Error("Kamu masih sedang dalam permainan."), { status: 400 });
  const opponentActiveDuelId = await activeDuelIdForUser(db, opponentId);
  if (opponentActiveDuelId) throw Object.assign(new Error("Lawan sedang dalam permainan."), { status: 400 });

  const questions = await dailyDuelQuestions(db, categoryKey, [user.id, opponentId].filter(Boolean));
  if (questions.length < DUEL_QUESTION_COUNT) {
    throw Object.assign(new Error(`Bank soal minimal ${DUEL_QUESTION_COUNT} pertanyaan belum tersedia.`), { status: 500 });
  }

  const opponent = unwrap(await db.from("users").select("id, username, gender, last_seen_at").eq("id", opponentId).neq("id", user.id).maybeSingle());
  if (!opponent) throw Object.assign(new Error("Lawan tidak ditemukan."), { status: 404 });
  if (!await isOnlineUser(opponent)) throw Object.assign(new Error("Lawan sedang offline, duel dibatalkan."), { status: 400 });

  const duelId = id("duel");
  try {
    unwrap(await db.from("duels").insert({
      id: duelId,
      user_id: user.id,
      opponent_id: opponent.id,
      opponent_name: opponent.username,
      play_mode: duelPlayMode(categoryKey),
      category_key: categoryKey || null,
      starts_at: new Date(Date.now() + DUEL_START_BUFFER_MS).toISOString(),
    }));
    unwrap(await db.from("duel_questions").insert(questions.map((question, index) => ({
      duel_id: duelId,
      question_id: question.id,
      position: index + 1,
    }))));
  } catch (error) {
    await db.from("duels").delete().eq("id", duelId);
    throw error;
  }

  await incrementDailyDuelCounters(user.id, opponent.id);

  const duel = unwrap(await db.from("duels").select("*").eq("id", duelId).single());
  return duelPayloadFromQuestions(duel, questions, user.id, opponent);
}

async function answerDuel(req, res, db, user) {
  const data = body(req);
  const duelId = String(data.duelId || "");
  const questionId = String(data.questionId || "");
  const selected = ["A", "B", "C", "D"].includes(data.selectedOption) ? data.selectedOption : null;
  if (!SAFE_ID_PATTERN.test(duelId) || !SAFE_ID_PATTERN.test(questionId)) {
    return send(res, 400, { error: "Data jawaban tidak valid." });
  }

  const submitted = await db.rpc("force_submit_duel_answer", {
    p_duel_id: duelId,
    p_user_id: user.id,
    p_question_id: questionId,
    p_selected_option: selected,
  });
  if (submitted.error) {
    const message = String(submitted.error.message || "");
    if (/sudah dijawab/i.test(message)) return send(res, 409, { error: "Pertanyaan ini sudah dijawab." });
    if (/belum dimulai|belum mulai/i.test(message)) return send(res, 409, { error: "Pertanyaan belum dimulai." });
    if (/urutan/i.test(message)) return send(res, 409, { error: "Urutan pertanyaan tidak sesuai. Muat ulang duel." });
    if (/bukan peserta/i.test(message)) return send(res, 403, { error: "Akses duel ditolak." });
    if (/tidak aktif|tidak ditemukan/i.test(message)) return send(res, 404, { error: "Duel tidak aktif." });
    throw submitted.error;
  }
  const saved = Array.isArray(submitted.data) ? submitted.data[0] : submitted.data;
  const duel = unwrap(await db.from("duels").select("*").eq("id", duelId).single());
  const latestDuel = await maybeSettleDuel(db, duel);
  return send(res, 200, {
    isCorrect: Boolean(saved?.is_correct),
    points: Number(saved?.points || 0),
    answerTimeMs: Number(saved?.answer_time_ms || 0),
    status: await duelStatusPayload(db, latestDuel, user.id),
  });
}
async function finishDuel(req, res, db, user) {
  const data = body(req);
  let duel = unwrap(await db.from("duels").select("*").eq("id", data.duelId).maybeSingle());
  if (!duel || !isDuelParticipant(duel, user.id)) return send(res, 404, { error: "Duel tidak aktif." });
  if (duel.status === "finished") return sendFinishedDuel(res, db, duel, user.id, []);

  const answers = (await readDuelAnswers(db, data.duelId)).filter((answer) => answer.user_id === user.id);
  const pastDeadline = Date.now() >= duelAnswerDeadlineMs(duel);
  if (answers.length < DUEL_QUESTION_COUNT && !pastDeadline) return send(res, 400, { error: "Jawab semua pertanyaan dulu." });

  if (duel.opponent_id) {
    const allAnswers = await readDuelAnswers(db, data.duelId);
    const userAnswers = allAnswers.filter((answer) => answer.user_id === duel.user_id);
    const opponentAnswers = allAnswers.filter((answer) => answer.user_id === duel.opponent_id);
    if ((userAnswers.length < DUEL_QUESTION_COUNT || opponentAnswers.length < DUEL_QUESTION_COUNT) && !pastDeadline) {
      return send(res, 200, { waiting: true, status: await duelStatusPayload(db, duel, user.id) });
    }
  }

  await settleDuel(db, duel);
  duel = unwrap(await db.from("duels").select("*").eq("id", data.duelId).single());
  if (duel.status !== "finished") {
    return send(res, 200, { waiting: true, status: await duelStatusPayload(db, duel, user.id) });
  }
  return sendFinishedDuel(res, db, duel, user.id, []);
}

async function workerDrain(req, res, db) {
  const configuredSecret = String(process.env.WORKER_SECRET || "").trim();
  if (!configuredSecret) {
    return send(res, 503, { error: "Worker tidak tersedia." });
  }
  const supplied = String(req.headers["x-worker-secret"] || "").trim();
  if (!safeSecretEqual(supplied, configuredSecret)) {
    return send(res, 403, { error: "Akses worker ditolak." });
  }
  const limit = Math.max(1, Math.min(25, Number(req.query?.limit || 10)));
  const result = await drainDuelWorker(db, { limit });
  return send(res, 200, { ok: true, stateProvider: "supabase", ...result });
}

async function drainDuelWorker(db, { limit = 10, onlyDuelId = "" } = {}) {
  let rows = [];
  if (onlyDuelId) {
    const duel = unwrap(await db.from("duels").select("*").eq("id", onlyDuelId).maybeSingle());
    rows = duel ? [duel] : [];
  } else {
    rows = unwrap(await db
      .from("duels")
      .select("*")
      .eq("status", "active")
      .lt("starts_at", new Date(Date.now() - DUEL_QUESTION_COUNT * QUESTION_TIME_LIMIT_MS).toISOString())
      .order("starts_at", { ascending: true })
      .limit(limit));
  }

  const summary = { processed: 0, settled: 0, waiting: 0, errors: [] };
  for (const duel of rows) {
    summary.processed += 1;
    try {
      const before = duel.status;
      const after = await maybeSettleDuel(db, duel);
      if (before !== after.status || after.status === "finished") summary.settled += 1;
      else summary.waiting += 1;
    } catch (error) {
      summary.errors.push({ duelId: duel.id, message: error?.message || "Worker error" });
    }
  }
  return summary;
}

async function maybeSettleDuel(db, duel) {
  if (!duel || duel.status !== "active") return duel;
  const answers = await readDuelAnswers(db, duel.id);
  const userAnswered = answers.filter((answer) => answer.user_id === duel.user_id).length;
  const opponentAnswered = duel.opponent_id ? answers.filter((answer) => answer.user_id === duel.opponent_id).length : DUEL_QUESTION_COUNT;
  const ready = (userAnswered >= DUEL_QUESTION_COUNT && opponentAnswered >= DUEL_QUESTION_COUNT) || Date.now() >= duelAnswerDeadlineMs(duel);
  if (!ready) return duel;
  await settleDuel(db, duel);
  return unwrap(await db.from("duels").select("*").eq("id", duel.id).maybeSingle()) || duel;
}

async function sendFinishedDuel(res, db, duel, viewerId, newBadges = []) {
  const side = participantSide(duel, viewerId);
  const score = scoreForSide(duel, side);
  return send(res, 200, {
    result: {
      result: resultForSide(resultForDuel(duel), side),
      fpAwarded: side === "opponent" ? Number(duel.opponent_fp_awarded || 0) : Number(duel.fp_awarded || 0),
      userScore: score.mine,
      opponentScore: score.theirs,
      avgTimeMs: side === "opponent" ? Number(duel.opponent_avg_time_ms || 0) : Number(duel.user_avg_time_ms || 0),
      newBadges: [],
    },
    status: await duelStatusPayload(db, duel, viewerId),
  });
}

async function settleDuel(db, duel) {
  if (duel.status === "finished") return {};
  const allAnswers = await readDuelAnswers(db, duel.id);
  const userAnswers = allAnswers.filter((answer) => answer.user_id === duel.user_id);
  const opponentAnswers = duel.opponent_id
    ? allAnswers.filter((answer) => answer.user_id === duel.opponent_id)
    : [];
  const userCorrect = userAnswers.filter((answer) => answer.is_correct).length;
  const opponentCorrect = duel.opponent_id
    ? opponentAnswers.filter((answer) => answer.is_correct).length
    : Number(duel.opponent_score || 0);
  const userFp = duelPoints(userAnswers);
  const opponentFp = duel.opponent_id ? duelPoints(opponentAnswers) : 0;
  const result = userFp > opponentFp ? "win" : userFp < opponentFp ? "lose" : "draw";
  const userAvgMs = Math.round(userAnswers.reduce((sum, answer) => sum + Number(answer.answer_time_ms || 0), 0) / Math.max(1, userAnswers.length));
  const opponentAvgMs = duel.opponent_id
    ? Math.round(opponentAnswers.reduce((sum, answer) => sum + Number(answer.answer_time_ms || 0), 0) / Math.max(1, opponentAnswers.length))
    : Number(duel.opponent_avg_time_ms || 0);

  const updated = unwrap(await db.from("duels").update({
    status: "finished",
    user_score: userFp,
    opponent_score: opponentFp,
    user_avg_time_ms: userAvgMs,
    opponent_avg_time_ms: opponentAvgMs,
    fp_awarded: userFp,
    opponent_fp_awarded: opponentFp,
    finished_at: new Date().toISOString(),
  }).eq("id", duel.id).eq("status", "active").select("id"));
  if (!updated.length) return {};

  await db.from("duel_queue").update({
    status: "cancelled",
    duel_id: null,
    updated_at: new Date().toISOString(),
  }).in("user_id", [duel.user_id, duel.opponent_id].filter(Boolean)).eq("duel_id", duel.id);


  const newBadgesByUserId = {};
  const user = unwrap(await db.from("users").select("*").eq("id", duel.user_id).single());
  newBadgesByUserId[user.id] = await updateUserAfterDuel(db, user, result, userCorrect, userAnswers, userFp);
  if (duel.opponent_id) {
    const opponent = unwrap(await db.from("users").select("*").eq("id", duel.opponent_id).single());
    newBadgesByUserId[opponent.id] = await updateUserAfterDuel(db, opponent, resultForSide(result, "opponent"), opponentCorrect, opponentAnswers, opponentFp);
    await invalidateLeaderboardCaches(user.school, opponent.school);
  } else {
    await invalidateLeaderboardCaches(user.school);
  }
  return newBadgesByUserId;
}

async function updateUserAfterDuel(db, user, result, score, answers, fp) {
  const totalTime = answers.reduce((sum, answer) => sum + Number(answer.answer_time_ms || 0), 0);
  const newFire = nextFireStreak(user);
  const updatePayload = {
    lifetime_fp: Number(user.lifetime_fp || 0) + fp,
    weekly_fp: Number(user.weekly_fp || 0) + fp,
    wins: Number(user.wins || 0) + (result === "win" ? 1 : 0),
    losses: Number(user.losses || 0) + (result === "lose" ? 1 : 0),
    draws: Number(user.draws || 0) + (result === "draw" ? 1 : 0),
    total_correct: Number(user.total_correct || 0) + score,
    total_answer_time_ms: Number(user.total_answer_time_ms || 0) + totalTime,
    total_answers: Number(user.total_answers || 0) + answers.length,
    current_win_streak: result === "win" ? Number(user.current_win_streak || 0) + 1 : 0,
    fire_streak_days: newFire.fire_streak_days,
    last_fire_date: newFire.last_fire_date,
    last_seen_at: new Date().toISOString(),
  };
  unwrap(await db.from("users").update(updatePayload).eq("id", user.id));
  return [];
}

function nextFireStreak(user) {
  const today = todayDate();
  if (user.last_fire_date === today) return { fire_streak_days: user.fire_streak_days || 1, last_fire_date: today };
  if (user.last_fire_date === yesterdayDate()) return { fire_streak_days: Number(user.fire_streak_days || 0) + 1, last_fire_date: today };
  return { fire_streak_days: 1, last_fire_date: today };
}

function normalizeCategory(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function categoryKeyFor(value = "") {
  const normalized = normalizeCategory(value);
  if (!normalized) return "";
  for (const category of QUESTION_CATEGORIES) {
    if (category.key === normalized.replace(/ /g, "_")) return category.key;
    if ((category.aliases || []).some((alias) => normalized.includes(normalizeCategory(alias)))) return category.key;
  }
  return "";
}

function normalizeDuelCategory(value = "") {
  const direct = String(value || "").trim().toLowerCase();
  const key = categoryKeyFor(direct) || categoryKeyFor(String(value || ""));
  return SELECTABLE_DUEL_CATEGORY_KEYS.has(key) ? key : "";
}

function parseDuelCategorySelection(value = "") {
  const raw = String(value ?? "").trim();
  const normalized = normalizeCategory(raw);
  if (!raw || ["mix", "all", "random", "acak"].includes(normalized)) return "";
  const categoryKey = normalizeDuelCategory(raw);
  if (!categoryKey) {
    throw Object.assign(new Error("Kategori duel tidak valid. Kosongkan kategori untuk mode random, atau pilih salah satu kategori yang tersedia."), { status: 400 });
  }
  return categoryKey;
}

function duelPlayMode(categoryKey = "") {
  return categoryKey ? "category" : "mix";
}

function duelCategoryLabel(categoryKey = "") {
  return categoryKey ? CATEGORY_BY_KEY.get(categoryKey)?.label || categoryKey : "Random";
}

function duelCategoriesPayload() {
  return {
    categories: SELECTABLE_DUEL_CATEGORIES,
    forceCore: FORCE_CORE_CATEGORY,
    rules: {
      selectableCount: SELECTABLE_DUEL_CATEGORIES.length,
      totalQuestions: DUEL_QUESTION_COUNT,
      selectedCategoryQuestions: DUEL_QUESTION_COUNT - 1,
      forceCoreQuestions: 1,
      inviteCountdownMs: DUEL_REQUEST_WAIT_MS,
    },
  };
}

function duelCategories(res) {
  return send(res, 200, duelCategoriesPayload());
}

async function categoryCorrectIncrements(db, answers = []) {
  const correctAnswers = answers.filter((answer) => answer.is_correct);
  const questionIds = [...new Set(correctAnswers.map((answer) => answer.question_id).filter(Boolean))];
  if (!questionIds.length) return {};
  const questions = unwrap(await db.from("questions").select("id, category_key").in("id", questionIds));
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const increments = {};
  for (const answer of correctAnswers) {
    const question = questionById.get(answer.question_id) || {};
    const categoryKey = question.category_key || "";
    if (categoryKey) increments[categoryKey] = Number(increments[categoryKey] || 0) + 1;
  }
  return increments;
}

function levelFromPoints(points) {
  return Math.min(100, Math.floor(Number(points || 0) / 1000) + 1);
}

async function awardBadges(db, userId) {
  return [];
}

async function todayCorrectCount(db, userId) {
  const result = await db
    .from("duel_answers")
    .select("duel_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_correct", true)
    .gte("answered_at", startOfTodayIso());
  if (result.error) throw result.error;
  return result.count || 0;
}

async function hasPerfectBrainDay(db, userId) {
  const todayStart = startOfTodayIso();
  const duels = await selectDuelsForUser(db, userId, {
    columns: "id, user_id, opponent_id, user_score, opponent_score, fp_awarded, opponent_fp_awarded, status, started_at",
    status: "finished",
    startedAtGte: todayStart,
    ascending: true,
    limit: 100,
  });

  if (!duels.length) return false;

  const answers = unwrap(await db
    .from("duel_answers")
    .select("duel_id, is_correct, answered_at")
    .eq("user_id", userId)
    .gte("answered_at", todayStart)
    .order("answered_at", { ascending: true })
    .limit(1000));

  if (answers.length < duels.length * DUEL_QUESTION_COUNT) return false;
  if (answers.some((answer) => !answer.is_correct)) return false;

  return duels.every((duel) => {
    const side = participantSide(duel, userId);
    return resultForSide(resultForDuel(duel), side) !== "lose";
  });
}

async function todayFastCorrectCount(db, userId) {
  const result = await db
    .from("duel_answers")
    .select("duel_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_correct", true)
    .lt("answer_time_ms", 5000)
    .gte("answered_at", startOfTodayIso());
  if (result.error) throw result.error;
  return result.count || 0;
}

async function hasFlawlessRound(db, userId) {
  const rows = unwrap(await db
    .from("duel_answers")
    .select("duel_id, is_correct, answered_at")
    .eq("user_id", userId)
    .order("answered_at", { ascending: false })
    .limit(5000));
  const byDuel = new Map();
  for (const row of rows) {
    const stats = byDuel.get(row.duel_id) || { total: 0, correct: 0 };
    stats.total += 1;
    if (row.is_correct) stats.correct += 1;
    byDuel.set(row.duel_id, stats);
  }
  return [...byDuel.values()].some((stats) => stats.total >= DUEL_QUESTION_COUNT && stats.correct >= DUEL_QUESTION_COUNT);
}

async function hasClutchVictory(db, userId) {
  const rows = await selectDuelsForUser(db, userId, {
    columns: "id, user_id, opponent_id, user_score, opponent_score, fp_awarded, opponent_fp_awarded, status, started_at",
    status: "finished",
    ascending: false,
    limit: 5000,
  });
  return rows.some((duel) => {
    const side = participantSide(duel, userId);
    const mine = side === "opponent" ? Number(duel.opponent_fp_awarded || duel.opponent_score || 0) : Number(duel.fp_awarded || duel.user_score || 0);
    const theirs = side === "opponent" ? Number(duel.fp_awarded || duel.user_score || 0) : Number(duel.opponent_fp_awarded || duel.opponent_score || 0);
    return mine > theirs && mine - theirs === 1;
  });
}

async function hasFiveConsecutiveC(db, userId) {
  const rows = unwrap(await db
    .from("duel_answers")
    .select("selected_option, answered_at")
    .eq("user_id", userId)
    .order("answered_at", { ascending: true })
    .limit(5000));
  let streak = 0;
  for (const row of rows) {
    streak = row.selected_option === "C" ? streak + 1 : 0;
    if (streak >= 5) return true;
  }
  return false;
}

async function currentWeeklyRank(db, userId) {
  const rows = unwrap(await db
    .from("users")
    .select("id, weekly_fp, lifetime_fp, created_at")
    .order("weekly_fp", { ascending: false })
    .order("lifetime_fp", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(10));
  const index = rows.findIndex((row) => row.id === userId);
  return index >= 0 ? index + 1 : Number.POSITIVE_INFINITY;
}

// =========================================================
// FORCE Go to Schools
// =========================================================

function normalizeSchoolInviteCode(value = "") {
  const code = String(value ?? "")
    .slice(0, 128)
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .toUpperCase();

  return /^[A-Z0-9-]{6,32}$/.test(code) ? code : "";
}

async function schoolQuestionCount(db) {
  return (await activeSchoolQuestionBank(db)).length;
}

async function activeSchoolQuestionBank(db) {
  if (schoolQuestionBankMemoryCache.expiresAt > Date.now() && schoolQuestionBankMemoryCache.rows.length) {
    return schoolQuestionBankMemoryCache.rows;
  }
  const rows = unwrap(await db
    .from("school_event_questions")
    .select("id, position, question, question_type, image_url, option_a, option_b, option_c, option_d")
    .eq("active", true)
    .order("position", { ascending: true }));
  schoolQuestionBankMemoryCache.rows = rows;
  schoolQuestionBankMemoryCache.expiresAt = Date.now() + SCHOOL_QUIZ_CACHE_MS;
  return rows;
}

async function schoolEventById(db, eventId) {
  const cached = schoolEventMemoryCache.get(eventId);
  if (cached?.expiresAt > Date.now()) return cached.value;
  const rawEvent = unwrap(await db
    .from("school_events")
    .select("id, school_name, max_participants")
    .eq("id", eventId)
    .single());
  const event = await hydrateSchoolEvent(db, rawEvent);
  schoolEventMemoryCache.set(eventId, { value: event, expiresAt: Date.now() + SCHOOL_QUIZ_CACHE_MS });
  return event;
}

async function hydrateSchoolEvent(db, event) {
  if (!event?.id) return null;
  return {
    ...event,
    // All Go to Schools events use the same shared active question bank.
    total_questions: await schoolQuestionCount(db),
  };
}

function schoolEventPayload(event = {}, access = null) {
  return {
    id: event.id,
    name: SCHOOL_EVENT_DISPLAY_NAME,
    schoolName: event.school_name,
    maxParticipants: Number(event.max_participants || SCHOOL_MAX_PARTICIPANTS_DEFAULT),
    totalQuestions: Number(event.total_questions || 0),
    timeLimitMs: SCHOOL_QUESTION_TIME_LIMIT_MS,
    startsAt: null,
    endsAt: null,
    visibleUntil: access?.visible_until || null,
    whatsappUrl: FORCE_WHATSAPP_URL,
  };
}

function schoolQuestionPayload(question = {}) {
  const imageUrl = String(question.image_url || "").trim();
  return {
    id: question.id,
    question: question.question,
    question_type: question.question_type || (imageUrl ? "image" : "text"),
    image_url: /^(https?:\/\/|\/)/i.test(imageUrl) ? imageUrl : "",
    option_a: question.option_a,
    option_b: question.option_b,
    option_c: question.option_c,
    option_d: question.option_d,
  };
}

async function activeSchoolEventForCode(db, rawCode) {
  const code = normalizeSchoolInviteCode(rawCode);
  if (!code) {
    throw Object.assign(new Error("Code yang anda masukan salah."), { status: 400, publicCodeError: true });
  }

  // Query ini hanya berjalan di backend dengan SUPABASE_SERVICE_ROLE_KEY.
  // invitation_code hanya dipakai sebagai filter dan tidak pernah dikirim ke browser.
  const result = await db
    .from("school_events")
    .select("id, school_name, max_participants")
    .eq("invitation_code", code)
    .maybeSingle();

  if (result.error) throw result.error;
  if (!result.data) {
    throw Object.assign(new Error("Code yang anda masukan salah."), { status: 400, publicCodeError: true });
  }

  // Kode yang benar tetap dapat membuka akses. Ketersediaan soal diperiksa
  // ketika peserta menekan tombol mulai agar kesalahan konfigurasi soal tidak
  // disamarkan sebagai invitation code yang salah.
  return hydrateSchoolEvent(db, result.data);
}

function schoolAccountVisibleUntil(user) {
  const createdAtMs = new Date(user?.created_at || 0).getTime();
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return 0;
  return createdAtMs + SCHOOL_DATA_RETENTION_MS;
}

function schoolAccessWindow(user) {
  const openedAtMs = Date.now();
  const accountVisibleUntilMs = schoolAccountVisibleUntil(user);
  return {
    openedAt: new Date(openedAtMs).toISOString(),
    visibleUntil: new Date(Math.min(openedAtMs + SCHOOL_DATA_RETENTION_MS, accountVisibleUntilMs)).toISOString(),
  };
}

async function getSchoolAccess(db, eventId, userId) {
  return unwrap(await db
    .from("school_event_access")
    .select("*")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle());
}

async function ensureSchoolEventAccess(db, user, event) {
  const accountVisibleUntilMs = schoolAccountVisibleUntil(user);
  if (!accountVisibleUntilMs || accountVisibleUntilMs <= Date.now()) {
    throw Object.assign(new Error("Masa akses Go to Schools untuk akun ini sudah berakhir."), { status: 410 });
  }
  let access = await getSchoolAccess(db, event.id, user.id);
  if (!access) {
    const window = schoolAccessWindow(user);
    const insert = await db.from("school_event_access").insert({
      id: id("school_access"),
      event_id: event.id,
      user_id: user.id,
      opened_at: window.openedAt,
      visible_until: window.visibleUntil,
    }).select("*").single();
    if (insert.error && insert.error.code !== "23505") throw insert.error;
    access = insert.error ? await getSchoolAccess(db, event.id, user.id) : insert.data;
  }
  if (!access || new Date(access.visible_until).getTime() <= Date.now()) {
    throw Object.assign(new Error("Masa akses Go to Schools untuk akun ini sudah berakhir."), { status: 410 });
  }
  return access;
}

async function activeSchoolAccessForUser(db, user) {
  const accountVisibleUntilMs = schoolAccountVisibleUntil(user);
  if (!accountVisibleUntilMs || accountVisibleUntilMs <= Date.now()) return null;
  const accesses = unwrap(await db
    .from("school_event_access")
    .select("*")
    .eq("user_id", user.id)
    .gt("visible_until", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(20));

  for (const access of accesses) {
    if (new Date(access.visible_until).getTime() > accountVisibleUntilMs) {
      access.visible_until = new Date(accountVisibleUntilMs).toISOString();
      await db.from("school_event_access").update({ visible_until: access.visible_until }).eq("event_id", access.event_id).eq("user_id", user.id);
    }
    const rawEvent = unwrap(await db
      .from("school_events")
      .select("id, school_name, max_participants")
      .eq("id", access.event_id)
      .maybeSingle());
    const event = await hydrateSchoolEvent(db, rawEvent);
    if (event) return { event, access };
  }

  // Every account should see the golden Go to Schools entry while an event
  // exists. Prefer the event for the user's school, then use the newest event.
  let rawEvent = null;
  if (user.school) {
    rawEvent = unwrap(await db
      .from("school_events")
      .select("id, school_name, max_participants")
      .eq("school_name", user.school)
      .limit(1)
      .maybeSingle());
  }
  if (!rawEvent) {
    const events = unwrap(await db
      .from("school_events")
      .select("id, school_name, max_participants")
      .limit(1));
    rawEvent = Array.isArray(events) ? events[0] : null;
  }
  const event = await hydrateSchoolEvent(db, rawEvent);
  if (!event) return null;
  const access = await ensureSchoolEventAccess(db, user, event);
  return { event, access };
}

async function maybeCleanupSchoolData(db) {
  if (Date.now() - schoolMaintenanceLastRunAt < 30 * 60 * 1000) return;
  schoolMaintenanceLastRunAt = Date.now();
  const result = await db.rpc("force_cleanup_school_event_data");
  if (result.error) console.warn("FORCE_SCHOOL_CLEANUP_WARNING", result.error.message);
}

async function ensureSchoolFpAwarded(db, attemptId, userId) {
  const result = await db.rpc("force_award_school_fp", {
    p_attempt_id: attemptId,
    p_user_id: userId,
  });
  if (result.error) throw result.error;
  return Array.isArray(result.data) ? result.data[0] : result.data;
}

async function schoolFeatureStatus(req, res, db, user) {
  await maybeCleanupSchoolData(db);
  const active = await activeSchoolAccessForUser(db, user);
  if (!active) return send(res, 200, { available: false });

  const { event, access } = active;
  const attempt = unwrap(await db
    .from("school_attempts")
    .select("*")
    .eq("event_id", event.id)
    .eq("user_id", user.id)
    .maybeSingle());

  let result = null;
  if (attempt?.status === "finished") {
    result = await schoolResultForUser(db, event, attempt, user, access);
  }

  return send(res, 200, {
    available: true,
    visibleUntil: access.visible_until,
    event: schoolEventPayload(event, access),
    attemptStatus: attempt?.status || "not_started",
    result,
  });
}

async function verifySchoolInvite(req, res, db, user) {
  try {
    await maybeCleanupSchoolData(db);
    const event = await activeSchoolEventForCode(db, body(req).code);
    const access = await ensureSchoolEventAccess(db, user, event);
    return send(res, 200, {
      ok: true,
      event: schoolEventPayload(event, access),
      visibleUntil: access.visible_until,
    });
  } catch (error) {
    // Browser hanya menerima pesan aman. Detail database tetap dicatat di
    // Vercel Function Logs agar masalah konfigurasi dapat diperiksa admin.
    console.error("FORCE_SCHOOL_VERIFY_ERROR", {
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
      status: error?.status,
    });

    if (error?.publicCodeError || Number(error?.status) === 400 || Number(error?.status) === 404) {
      return send(res, 400, { error: "Code yang anda masukan salah." });
    }

    return send(res, 500, {
      error: "Code yang anda masukan salah.",
    });
  }
}

async function schoolAttemptQuestionState(db, attempt, event, access = null) {
  const nextPosition = Number(attempt.current_index || 0) + 1;
  const questions = await activeSchoolQuestionBank(db);
  const question = questions[nextPosition - 1] || null;
  if (!question) throw Object.assign(new Error("Soal Go to Schools belum tersedia atau urutannya belum lengkap. Hubungi admin FORCE."), { status: 503 });
  return {
    finished: false,
    attemptId: attempt.id,
    event: schoolEventPayload(event, access),
    index: nextPosition,
    total: Number(event.total_questions || 0),
    timeLimitMs: SCHOOL_QUESTION_TIME_LIMIT_MS,
    questionStartedAt: attempt.question_started_at,
    question: schoolQuestionPayload(question),
  };
}

async function startSchoolAttempt(req, res, db, user) {
  await maybeCleanupSchoolData(db);
  const event = await activeSchoolEventForCode(db, body(req).code);
  if (!event?.total_questions) {
    return send(res, 503, { error: "Soal Go to Schools belum tersedia. Hubungi admin FORCE." });
  }
  const access = await ensureSchoolEventAccess(db, user, event);
  let attempt = unwrap(await db
    .from("school_attempts")
    .select("*")
    .eq("event_id", event.id)
    .eq("user_id", user.id)
    .maybeSingle());

  if (!attempt) {
    const attemptId = id("school_attempt");
    const startedAt = new Date().toISOString();
    const result = await db.rpc("force_start_school_attempt", {
      p_event_id: event.id,
      p_user_id: user.id,
      p_attempt_id: attemptId,
      p_started_at: startedAt,
      p_expires_at: new Date(Date.now() + SCHOOL_DATA_RETENTION_MS).toISOString(),
    });
    if (result.error) throw result.error;
    attempt = Array.isArray(result.data) ? result.data[0] : result.data;
  }

  if (attempt.status === "finished") {
    return send(res, 200, { finished: true, result: await schoolResultForUser(db, event, attempt, user, access) });
  }
  if (attempt.status !== "active") {
    throw Object.assign(new Error("Attempt sekolah tidak dapat dilanjutkan."), { status: 409 });
  }

  return send(res, 200, await schoolAttemptQuestionState(db, attempt, event, access));
}

async function resumeSchoolAttempt(req, res, db, user) {
  await maybeCleanupSchoolData(db);
  const active = await activeSchoolAccessForUser(db, user);
  if (!active) return send(res, 410, { error: "Akses event tidak ditemukan atau sudah berakhir. Masukkan invitation code kembali." });
  const { event, access } = active;
  const attempt = unwrap(await db
    .from("school_attempts")
    .select("*")
    .eq("event_id", event.id)
    .eq("user_id", user.id)
    .maybeSingle());
  if (!attempt) return send(res, 404, { error: "Belum ada simulasi yang dapat dilanjutkan." });
  if (attempt.status === "finished") {
    return send(res, 200, { finished: true, result: await schoolResultForUser(db, event, attempt, user, access) });
  }
  if (attempt.status !== "active") return send(res, 409, { error: "Simulasi tidak dapat dilanjutkan." });
  return send(res, 200, await schoolAttemptQuestionState(db, attempt, event, access));
}

async function answerSchoolQuestion(req, res, db, user) {
  const data = body(req);
  const attemptId = String(data.attemptId || "");
  const questionId = String(data.questionId || "");
  const selectedOption = String(data.option || "").trim().toUpperCase();
  if (!SAFE_ID_PATTERN.test(attemptId) || !SAFE_ID_PATTERN.test(questionId)) {
    return send(res, 400, { error: "Attempt atau pertanyaan tidak valid." });
  }
  if (selectedOption && !["A", "B", "C", "D"].includes(selectedOption)) {
    return send(res, 400, { error: "Pilihan jawaban tidak valid." });
  }

  const submitted = await db.rpc("force_submit_school_answer", {
    p_attempt_id: attemptId,
    p_user_id: user.id,
    p_question_id: questionId,
    p_selected_option: selectedOption,
    p_answered_at: new Date().toISOString(),
  });
  if (submitted.error) {
    const message = submitted.error.message || "Jawaban gagal disimpan.";
    if (/sudah dijawab/i.test(message)) return send(res, 409, { error: "Pertanyaan ini sudah dijawab." });
    if (/urutan/i.test(message)) return send(res, 409, { error: "Urutan pertanyaan tidak sesuai. Muat ulang halaman." });
    throw submitted.error;
  }
  const saved = Array.isArray(submitted.data) ? submitted.data[0] : submitted.data;
  if (!saved?.event_id) throw new Error("Respons jawaban sekolah tidak lengkap.");

  const [event, access] = await Promise.all([
    schoolEventById(db, saved.event_id),
    getSchoolAccess(db, saved.event_id, user.id),
  ]);
  if (saved.finished || saved.already_finished) {
    await invalidateSchoolLeaderboardCache(event.id);
    const attempt = unwrap(await db.from("school_attempts").select("*").eq("id", attemptId).single());
    return send(res, 200, {
      finished: true,
      wasCorrect: Boolean(saved.was_correct),
      earnedPoints: Number(saved.earned_points || 0),
      result: await schoolResultForUser(db, event, attempt, user, access),
    });
  }

  const nextState = await schoolAttemptQuestionState(db, {
    id: attemptId,
    current_index: Number(saved.current_index || 0),
    question_started_at: saved.question_started_at,
  }, event, access);
  return send(res, 200, {
    ...nextState,
    wasCorrect: Boolean(saved.was_correct),
    earnedPoints: Number(saved.earned_points || 0),
  });
}

async function invalidateSchoolLeaderboardCache(eventId) {
  schoolLeaderboardMemoryCache.delete(eventId);
}

async function buildSchoolLeaderboard(db, eventId) {
  const rawEvent = unwrap(await db
    .from("school_events")
    .select("id, school_name, max_participants")
    .eq("id", eventId)
    .maybeSingle());
  const event = await hydrateSchoolEvent(db, rawEvent);
  if (!event) throw Object.assign(new Error("Event sekolah tidak ditemukan."), { status: 404 });
  const attempts = unwrap(await db
    .from("school_attempts")
    .select("user_id, score, correct_count, total_answer_time_ms, finished_at")
    .eq("event_id", event.id)
    .eq("status", "finished")
    .order("score", { ascending: false })
    .limit(Number(event.max_participants || SCHOOL_MAX_PARTICIPANTS_DEFAULT)));
  const userIds = [...new Set(attempts.map((row) => row.user_id).filter(Boolean))];
  const users = userIds.length
    ? unwrap(await db.from("users").select("id, username, name").in("id", userIds))
    : [];
  const userById = new Map(users.map((row) => [row.id, row]));
  const sorted = [...attempts].sort((a, b) =>
    Number(b.score || 0) - Number(a.score || 0)
    || Number(b.correct_count || 0) - Number(a.correct_count || 0)
    || Number(a.total_answer_time_ms || 0) - Number(b.total_answer_time_ms || 0)
    || new Date(a.finished_at || 0).getTime() - new Date(b.finished_at || 0).getTime());
  const allRows = sorted.map((row, index) => ({
    rank: index + 1,
    userId: row.user_id,
    username: userById.get(row.user_id)?.username || "member",
    name: userById.get(row.user_id)?.name || "FORCE Warrior",
    score: Number(row.score || 0),
    correctCount: Number(row.correct_count || 0),
    totalAnswerTimeMs: Number(row.total_answer_time_ms || 0),
  }));
  return {
    event: schoolEventPayload(event),
    totalQuestions: Number(event.total_questions || 0),
    totalFinished: allRows.length,
    rows: allRows.slice(0, 10),
    allRows,
  };
}

async function cachedSchoolLeaderboard(db, eventId) {
  const inMemory = schoolLeaderboardMemoryCache.get(eventId);
  if (inMemory && inMemory.expiresAt > Date.now()) return inMemory.value;
  const built = await buildSchoolLeaderboard(db, eventId);
  schoolLeaderboardMemoryCache.set(eventId, { expiresAt: Date.now() + SCHOOL_LEADERBOARD_CACHE_SECONDS * 1000, value: built });
  return built;
}

async function schoolResultForUser(db, event, attempt, user, access = null) {
  const awarded = await ensureSchoolFpAwarded(db, attempt.id, user.id);
  const currentAttempt = awarded?.attempt || attempt;
  const board = await cachedSchoolLeaderboard(db, event.id);
  const mine = board.allRows.find((row) => row.userId === user.id);
  const answered = Math.max(1, Number(currentAttempt.current_index || event.total_questions || 1));
  return {
    event: schoolEventPayload(event, access),
    attemptId: currentAttempt.id || attempt.id,
    score: Number(currentAttempt.score || attempt.score || 0),
    convertedFp: Number(awarded?.converted_fp ?? currentAttempt.converted_fp ?? attempt.converted_fp ?? 0),
    correctCount: Number(currentAttempt.correct_count || attempt.correct_count || 0),
    totalQuestions: Number(event.total_questions || 0),
    averageTimeSeconds: Number(currentAttempt.total_answer_time_ms || attempt.total_answer_time_ms || 0) / answered / 1000,
    rank: mine?.rank || null,
    finishedAt: currentAttempt.finished_at || attempt.finished_at,
  };
}

async function schoolLeaderboard(req, res, db, user) {
  const eventId = String(req.query.eventId || "");
  if (!SAFE_ID_PATTERN.test(eventId)) return send(res, 400, { error: "Event sekolah tidak valid." });
  const board = await cachedSchoolLeaderboard(db, eventId);
  const me = board.allRows.find((row) => row.userId === user.id) || null;
  return send(res, 200, {
    event: board.event,
    totalQuestions: board.totalQuestions,
    totalFinished: board.totalFinished,
    rows: board.rows,
    me,
  });
}

// =========================================================
// FORCE Shops - FP-only testing flow
// =========================================================

function shopStatusLabel(status = "pending") {
  return ({
    pending: "Menunggu Admin",
    confirmed: "Dikonfirmasi",
    processing: "Diproses",
    shipped: "Dikirim",
    completed: "Selesai",
    cancelled: "Dibatalkan",
  })[status] || status;
}

async function ensureForceWallet(db, user) {
  let wallet = unwrap(await db.from("force_wallets").select("*").eq("user_id", user.id).maybeSingle());
  if (!wallet) {
    wallet = unwrap(await db.from("force_wallets").insert({
      user_id: user.id,
      balance: Math.max(0, Number(user.lifetime_fp || 0)),
    }).select("*").single());
  }
  return wallet;
}

function shopProductPayload(product = {}) {
  return {
    id: product.id,
    sku: product.sku,
    categoryId: product.category_id,
    categoryName: product.shop_categories?.name || "FORCE Goods",
    name: product.name,
    subtitle: product.subtitle,
    description: product.description,
    imageUrl: product.image_url,
    fpPrice: Number(product.fp_price || 0),
    stock: Number(product.stock || 0),
    featured: Boolean(product.featured),
    badge: product.badge || "",
  };
}

async function userShopOrders(db, userId) {
  const rows = unwrap(await db
    .from("shop_orders")
    .select("id, order_number, status, total_fp, created_at, shop_order_items(product_name_snapshot)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(12));
  return rows.map((row) => ({
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    statusLabel: shopStatusLabel(row.status),
    totalFp: Number(row.total_fp || 0),
    productName: Array.isArray(row.shop_order_items) ? row.shop_order_items[0]?.product_name_snapshot : row.shop_order_items?.product_name_snapshot,
    createdAt: row.created_at,
  }));
}

async function shopProducts(res, db, user) {
  const wallet = await ensureForceWallet(db, user);
  const products = unwrap(await db
    .from("shop_products")
    .select("*, shop_categories(name)")
    .eq("active", true)
    .order("featured", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true }));
  return send(res, 200, {
    balance: Number(wallet.balance || 0),
    products: products.map(shopProductPayload),
    orders: await userShopOrders(db, user.id),
  });
}

async function shopOrders(res, db, user) {
  return send(res, 200, { orders: await userShopOrders(db, user.id) });
}

function sanitizeShopText(value = "", max = 160) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function shopOrderNumber() {
  const date = todayDate().replace(/-/g, "");
  return `FS-${date}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

async function notifyShopOrderToN8n(db, payload) {
  const url = String(process.env.N8N_SHOP_WEBHOOK_URL || "").trim();
  if (!url) {
    await db.from("shop_orders").update({ notification_status: "not_configured" }).eq("id", payload.order.id);
    return { sent: false, reason: "not_configured" };
  }
  let status = "failed";
  let errorMessage = "";
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.N8N_SHOP_WEBHOOK_SECRET ? { "x-force-webhook-secret": process.env.N8N_SHOP_WEBHOOK_SECRET } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SHOP_WEBHOOK_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`n8n webhook ${response.status}`);
    status = "sent";
  } catch (error) {
    errorMessage = String(error?.message || "Webhook gagal").slice(0, 220);
    console.warn("FORCE_SHOP_N8N_WARNING", errorMessage);
  }
  await db.from("shop_orders").update({
    notification_status: status,
    notification_error: errorMessage,
    notified_at: status === "sent" ? new Date().toISOString() : null,
  }).eq("id", payload.order.id);
  return { sent: status === "sent", reason: errorMessage || status };
}

async function redeemShopProduct(req, res, db, user) {
  const data = body(req);
  const productId = String(data.productId || "");
  if (!SAFE_ID_PATTERN.test(productId)) return send(res, 400, { error: "Produk tidak valid." });

  const recipientName = sanitizeShopText(data.recipientName, 60);
  const phone = normalizePhone(data.phone);
  const address = sanitizeShopText(data.address, 240);
  const city = sanitizeShopText(data.city, 40);
  const postalCode = String(data.postalCode || "").replace(/\D/g, "").slice(0, 8);
  const notes = sanitizeShopText(data.notes, 160);
  if (recipientName.length < 2 || !isValidPhone(phone) || address.length < 10 || city.length < 2 || postalCode.length < 4) {
    return send(res, 400, { error: "Lengkapi nama penerima, WhatsApp, alamat, kota, dan kode pos dengan benar." });
  }

  await ensureForceWallet(db, user);
  const orderId = id("shop_order");
  const orderNumber = shopOrderNumber();
  const result = await db.rpc("force_redeem_shop_product", {
    p_user_id: user.id,
    p_product_id: productId,
    p_order_id: orderId,
    p_order_number: orderNumber,
    p_recipient_name: recipientName,
    p_phone: phone,
    p_address: address,
    p_city: city,
    p_postal_code: postalCode,
    p_notes: notes,
  });
  if (result.error) {
    const message = result.error.message || "Penukaran gagal.";
    if (/saldo/i.test(message)) return send(res, 400, { error: "Force Points belum cukup untuk produk ini." });
    if (/stok/i.test(message)) return send(res, 409, { error: "Stok produk sudah habis." });
    throw result.error;
  }
  const redemption = result.data || {};

  const product = unwrap(await db.from("shop_products").select("name, sku, image_url, fp_price").eq("id", productId).single());
  const webhookPayload = {
    event: "force.shop.order.created",
    sentAt: new Date().toISOString(),
    order: {
      id: orderId,
      orderNumber,
      totalFp: Number(redemption.fp_price || product.fp_price || 0),
      status: "pending",
    },
    product: {
      id: productId,
      sku: product.sku,
      name: product.name,
      imageUrl: product.image_url,
    },
    member: {
      id: user.id,
      givenId: user.given_id,
      username: user.username,
      name: user.name,
    },
    shipping: { recipientName, phone, address, city, postalCode, notes },
  };
  const notification = await notifyShopOrderToN8n(db, webhookPayload);

  return send(res, 200, {
    ok: true,
    order: {
      id: orderId,
      orderNumber,
      status: "pending",
      statusLabel: shopStatusLabel("pending"),
      totalFp: Number(redemption.fp_price || product.fp_price || 0),
    },
    balance: Number(redemption.balance_after || 0),
    notification,
  });
}
