// ============================================================
// HUSTLE CLUB — USAGE LOG
// Plain-text, append-only record of when the app is used, from which
// region, and at what date and time. One line per event.
//
//   Default file : ./logs/usage.log     (override with USAGE_LOG_FILE)
//   Disable      : USAGE_LOG=off
//
// Read it with anything:
//   tail -f logs/usage.log
//   grep 'event=plan' logs/usage.log | wc -l
//   grep 'region="New Zealand' logs/usage.log
//
// ⚠️ PRIVACY — this app is used by 14-18 year olds. Two deliberate rules:
//
//   1. NO CONVERSATION CONTENT is ever written here. Not the messages,
//      not the business idea, not the plan. Those can contain a minor's
//      first name and suburb. Only counts and metadata are logged.
//
//   2. IP ADDRESSES ARE HASHED by default. You still get a stable
//      `visitor=` id — enough to count unique visitors and spot one
//      address hammering the API — without storing personal data about
//      a child. Set USAGE_LOG_IP=full only if you have a real reason
//      (an active abuse investigation) and a policy that covers it.
//
// The hash salt is random per process by default, so visitor ids are
// NOT comparable across restarts. Set USAGE_LOG_SALT to a fixed secret
// if you want them stable over time — that is a privacy trade-off:
// a fixed salt makes long-term tracking of one visitor possible.
//
// ⚠️ DOCKER: logs/ must be a mounted volume or the file disappears on
// every rebuild. docker-compose.yml has this wired up.
// ============================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ENABLED = String(process.env.USAGE_LOG || '').toLowerCase() !== 'off';
const LOG_FILE = process.env.USAGE_LOG_FILE
  ? path.resolve(process.env.USAGE_LOG_FILE)
  : path.join(__dirname, 'logs', 'usage.log');
const FULL_IP = String(process.env.USAGE_LOG_IP || '').toLowerCase() === 'full';
const SALT = process.env.USAGE_LOG_SALT || crypto.randomBytes(16).toString('hex');
const MAX_BYTES = Number(process.env.USAGE_LOG_MAX_BYTES || 10 * 1024 * 1024); // 10 MB then rotate

const HEADER = [
  '# Hustle Club usage log',
  '# One line per AI request. No conversation content is recorded.',
  '# Fields: <ISO-8601 UTC timestamp>  event=  status=  region=  tz=  visitor=  provider=  model=  tokens=in/out  ms=',
  '# visitor= is a salted hash of the IP, not the IP itself (see usage-log.js).',
  '',
].join('\n');

// Appends are chained so lines can never interleave, and a slow disk
// can never block an in-flight chat response.
let queue = Promise.resolve();
let warned = false;

function ensureFile() {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, HEADER);
}

// Size-based rotation keeps a long-running VPS from filling its disk.
function rotateIfNeeded() {
  try {
    if (fs.statSync(LOG_FILE).size < MAX_BYTES) return;
    fs.renameSync(LOG_FILE, LOG_FILE + '.1'); // previous .1 is replaced
    fs.writeFileSync(LOG_FILE, HEADER);
  } catch { /* rotation is best-effort */ }
}

/** Stable per-visitor id that is not personal data. */
function visitorId(ip) {
  if (!ip) return 'unknown';
  if (FULL_IP) return ip;
  return crypto.createHash('sha256').update(SALT + '|' + ip).digest('hex').slice(0, 8);
}

// Log values are quoted and stripped of anything that could forge a new
// line or a new field — the region comes from the browser and is
// therefore attacker-controlled (log-injection defence).
function quote(value) {
  const s = String(value == null ? '' : value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/"/g, "'")
    .trim()
    .slice(0, 80);
  return '"' + (s || '-') + '"';
}

function bare(value) {
  return String(value == null ? '-' : value).replace(/[^\w.:/-]/g, '') || '-';
}

/**
 * Record one use of the app.
 *
 * @param {object} e
 * @param {string} e.event     'chat' | 'plan'
 * @param {string} e.status    'ok' | 'blocked' | 'rate-limited' | 'error' | …
 * @param {string} e.ip        raw client IP (hashed before it is written)
 * @param {object} e.geo       { country, city, region } as reported by the browser
 * @param {string} [e.timezone]
 * @param {string} [e.provider]
 * @param {string} [e.model]
 * @param {object} [e.usage]   { input, output } token counts
 * @param {number} [e.ms]      request duration
 */
export function logUsage(e) {
  if (!ENABLED) return;

  const region = [e.geo && e.geo.country, e.geo && e.geo.city].filter(Boolean).join(' / ');
  const tokens = e.usage && (e.usage.input != null || e.usage.output != null)
    ? `${e.usage.input ?? '?'}/${e.usage.output ?? '?'}`
    : '-';

  const line = [
    new Date().toISOString(),
    'event=' + bare(e.event),
    'status=' + bare(e.status),
    'region=' + quote(region),
    'tz=' + quote(e.timezone),
    'visitor=' + bare(visitorId(e.ip)),
    'provider=' + bare(e.provider),
    'model=' + bare(e.model),
    'tokens=' + bare(tokens),
    'ms=' + bare(e.ms),
  ].join('  ') + '\n';

  // Never let logging break a user's chat: swallow errors, warn once.
  queue = queue
    .then(() => { ensureFile(); rotateIfNeeded(); return fs.promises.appendFile(LOG_FILE, line); })
    .catch((err) => {
      if (!warned) { warned = true; console.error(`[usage-log] cannot write ${LOG_FILE}: ${err.message}`); }
    });
}

export const USAGE_LOG_FILE = LOG_FILE;
export const usageLogEnabled = () => ENABLED;
