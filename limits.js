// Usage limits. Every lesson build spends OpenAI credits, so each visitor and the whole site get a ceiling.
//
// Counts live in Upstash Redis when it is connected, because a serverless host runs several short-lived
// copies of this server that cannot share memory. Without Redis they stay in this process, which is exact
// on a single long-running server. Visitors are only ever stored as a salted hash, never as an IP address.

import { createHash } from "node:crypto";

const setting = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

const PER_HOUR = setting("LIMIT_PER_HOUR", 10);
const PER_DAY = setting("LIMIT_PER_DAY", 20);
const SITE_PER_DAY = setting("LIMIT_SITE_PER_DAY", 100);

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_REDIS = Boolean(REDIS_URL && REDIS_TOKEN);

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MANILA_MS = 8 * HOUR_MS; // "today" resets at midnight Philippine time

console.log(`Usage limits -> ${PER_HOUR}/hour and ${PER_DAY}/day per visitor, ${SITE_PER_DAY}/day for the site, counted in ${USE_REDIS ? "Redis" : "memory"}`);
if (process.env.VERCEL && !USE_REDIS) {
  console.warn("[limits] No Redis connected. Each server copy keeps its own counts, so the limits are not reliable on Vercel.");
}

// ---------- counters ----------

const memory = new Map();

function incrementInMemory(key, seconds) {
  const now = Date.now();
  if (memory.size > 5000) for (const [k, item] of memory) if (item.expires <= now) memory.delete(k);
  const item = memory.get(key);
  const count = item && item.expires > now ? item.count + 1 : 1;
  memory.set(key, { count, expires: now + seconds * 1000 });
  return count;
}

async function incrementInRedis(key, seconds) {
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify([["INCR", key], ["EXPIRE", key, seconds]]),
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const [reply] = await res.json();
  if (!Number.isInteger(reply?.result)) throw new Error(reply?.error || "unexpected reply");
  return reply.result;
}

// If Redis is unreachable the app keeps working and still limits, using this copy's own counts.
async function increment(key, seconds) {
  if (USE_REDIS) {
    try {
      return await incrementInRedis(key, seconds);
    } catch (err) {
      console.error(`[limits] Redis failed, counting in memory: ${err.message}`);
    }
  }
  return incrementInMemory(key, seconds);
}

// ---------- who is asking ----------

// IPv6 users control a whole /64 block, so one household is one network, not one address.
function networkOf(ip) {
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return groups.slice(0, 4).map((group) => parseInt(group, 16).toString(16)).join(":");
}

// Vercel overwrites x-forwarded-for with the real client address. Anywhere else the header could be faked.
function visitorId(req) {
  const forwarded = process.env.VERCEL ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "";
  const ip = (forwarded || req.socket.remoteAddress || "unknown").replace(/^::ffff:/, "");
  return createHash("sha256").update(`${process.env.OPENAI_API_KEY}:${networkOf(ip)}`).digest("hex").slice(0, 32);
}

// ---------- the check ----------

export async function checkUsage(req) {
  const now = Date.now();
  const id = visitorId(req);
  const hour = Math.floor(now / HOUR_MS);
  const day = Math.floor((now + MANILA_MS) / DAY_MS);
  const hourLeft = Math.ceil((HOUR_MS - (now % HOUR_MS)) / 1000);
  const dayLeft = Math.ceil((DAY_MS - ((now + MANILA_MS) % DAY_MS)) / 1000);
  const minutes = Math.ceil(hourLeft / 60);

  // In this order, so a refused request does not use up the wider allowance.
  const rules = [
    {
      key: `gabay:visitor:${id}:hour:${hour}`,
      max: PER_HOUR,
      seconds: hourLeft,
      message: `You've built a lot of lessons this hour. Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    },
    {
      key: `gabay:visitor:${id}:day:${day}`,
      max: PER_DAY,
      seconds: dayLeft,
      message: "You've reached today's limit for new lessons. Your saved lessons are still in My Lessons, and you can build more tomorrow.",
    },
    {
      key: `gabay:site:day:${day}`,
      max: SITE_PER_DAY,
      seconds: dayLeft,
      message: "The tutor center has reached its limit for new lessons today. Your saved lessons are still in My Lessons. Please come back tomorrow.",
    },
  ];

  for (const rule of rules) {
    if ((await increment(rule.key, rule.seconds)) > rule.max) {
      return { ok: false, retryAfter: rule.seconds, message: rule.message };
    }
  }
  return { ok: true };
}
