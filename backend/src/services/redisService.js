// Redis service with an automatic in-memory fallback.
// If REDIS_URL is reachable it uses Redis; otherwise it falls back to an
// in-process store so the app still runs on hosts without Redis (e.g. Render free tier).
// NOTE: in-memory mode does not share state across instances and resets on restart,
// which is fine for a single-instance MVP / portfolio deployment.

let client = null;
let useMemory = false;
const mem = new Map(); // key -> { value, expiresAt|null }

const connectRedis = async () => {
  const url = process.env.REDIS_URL;

  // Allow explicitly disabling Redis.
  if (!url || process.env.USE_REDIS === 'false') {
    useMemory = true;
    console.log('ℹ️  Redis disabled — using in-memory store');
    return;
  }

  try {
    const { createClient } = require('redis');
    client = createClient({ url });
    client.on('error', (err) => console.error('Redis error:', err.message));
    client.on('connect', () => console.log('✅ Redis connected'));
    await client.connect();
  } catch (err) {
    console.error('⚠️  Redis unavailable, falling back to in-memory store:', err.message);
    useMemory = true;
    client = null;
  }
};

// ── low-level get/set/del/exists (work in both modes) ──────────
const set = async (key, value, ttlSeconds = null) => {
  if (useMemory) {
    mem.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
    return;
  }
  const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (ttlSeconds) await client.setEx(key, ttlSeconds, serialized);
  else await client.set(key, serialized);
};

const get = async (key) => {
  if (useMemory) {
    const e = mem.get(key);
    if (!e) return null;
    if (e.expiresAt && Date.now() > e.expiresAt) { mem.delete(key); return null; }
    return e.value;
  }
  const val = await client.get(key);
  if (!val) return null;
  try { return JSON.parse(val); } catch { return val; }
};

const del = async (key) => {
  if (useMemory) { mem.delete(key); return; }
  return client.del(key);
};

const exists = async (key) => {
  if (useMemory) {
    const e = mem.get(key);
    if (!e) return 0;
    if (e.expiresAt && Date.now() > e.expiresAt) { mem.delete(key); return 0; }
    return 1;
  }
  return client.exists(key);
};

// ── domain helpers (unchanged interface) ───────────────────────
const setLocation = async (tripId, lat, lng, speed, heading) =>
  set(`trip:location:${tripId}`, { lat, lng, speed, heading, ts: Date.now() }, 7200);
const getLocation = async (tripId) => get(`trip:location:${tripId}`);

const setOtp = async (phone, code) => set(`otp:${phone}`, code, 600);
const getOtp = async (phone) => get(`otp:${phone}`);
const delOtp = async (phone) => del(`otp:${phone}`);

const setActiveTrip = async (userId, tripId) => set(`user:trip:${userId}`, tripId, 7200);
const getActiveTrip = async (userId) => get(`user:trip:${userId}`);
const delActiveTrip = async (userId) => del(`user:trip:${userId}`);

const setTripToken = async (token, tripId) => set(`triptoken:${token}`, tripId, 7200);
const getTripByToken = async (token) => get(`triptoken:${token}`);

module.exports = {
  connectRedis,
  set, get, del, exists,
  setLocation, getLocation,
  setOtp, getOtp, delOtp,
  setActiveTrip, getActiveTrip, delActiveTrip,
  setTripToken, getTripByToken,
};
