// ============================================================
// HUSTLE CLUB — CREDENTIALS
// Single source of truth for "where does the API key come from?"
//
// ▸ Everything here is SERVER-SIDE ONLY. No key ever reaches the
//   browser. The page talks to /api/chat; this file feeds the key
//   to that route.
//
// ▸ READ THIS IF YOU ARE ROTATING A KEY: see CREDENTIALS.md for the
//   short version. The long version is the lookup order below.
//
// LOOKUP ORDER (first hit wins) for a provider whose prefix is,
// say, MISTRAL:
//
//   1. MISTRAL_API_KEY_FILE   → path to a file containing the key
//   2. MISTRAL_API_KEY        → the key itself
//   3. LLM_API_KEY_FILE       → provider-neutral path fallback
//   4. LLM_API_KEY            → provider-neutral key fallback
//
// A "_FILE" entry is the recommended production form: the key lives
// outside the repo and outside the container image (a Docker secret,
// a mounted file, a file on the VPS with 600 perms). It is re-read
// on every request, so **editing that file rotates the key with no
// restart and no redeploy.**
//
// Plain env vars are read from the real process environment first,
// then from the .env file sitting next to this script. Note the
// restart caveat documented on readSetting() below.
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Override with ENV_FILE=/some/other/path if your .env lives elsewhere.
const ENV_FILE = process.env.ENV_FILE
  ? path.resolve(process.env.ENV_FILE)
  : path.join(__dirname, '.env');

// --- .env parsing -------------------------------------------
// Deliberately dependency-free: no dotenv package to install,
// audit or keep patched. Handles KEY=value, quotes, # comments
// and a leading `export `.

function parseEnv(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    let val = line.slice(eq + 1).trim();
    // Strip matching quotes; an unquoted value keeps everything up to a ` #` comment.
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    } else {
      val = val.replace(/\s+#.*$/, '').trim();
    }
    if (key) out[key] = val;
  }
  return out;
}

// Re-parsed only when the file's mtime changes, so calling this per
// request is cheap (one stat) but still picks up edits immediately.
let envCache = { mtimeMs: -1, values: {} };

function readEnvFile() {
  try {
    const stat = fs.statSync(ENV_FILE);
    if (stat.mtimeMs !== envCache.mtimeMs) {
      envCache = { mtimeMs: stat.mtimeMs, values: parseEnv(fs.readFileSync(ENV_FILE, 'utf8')) };
    }
  } catch {
    envCache = { mtimeMs: -1, values: {} }; // no .env file is a perfectly normal setup
  }
  return envCache.values;
}

/**
 * Read one configuration value.
 *
 * The real process environment wins over the .env file — that is the
 * standard convention, and it means a value injected by systemd, a
 * hosting panel or `docker compose --env-file` cannot be silently
 * shadowed by a stale .env sitting on disk.
 *
 * ⚠️ ROTATION CAVEAT: because docker-compose's `env_file:` copies .env
 * into the container's real environment at start-up, editing .env there
 * needs `docker compose up -d --force-recreate` to take effect. If you
 * want restart-free rotation, use the *_API_KEY_FILE form instead —
 * that path is read fresh every time.
 */
export function readSetting(name) {
  const live = process.env[name];
  if (live !== undefined && String(live).trim() !== '') return String(live).trim();
  const fromFile = readEnvFile()[name];
  if (fromFile !== undefined && String(fromFile).trim() !== '') return String(fromFile).trim();
  return undefined;
}

// --- secret files -------------------------------------------

let secretCache = new Map(); // path -> { mtimeMs, value }

function readSecretFile(filePath) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(__dirname, filePath);
  const stat = fs.statSync(resolved); // throws if missing — the caller turns that into a clear message
  const hit = secretCache.get(resolved);
  if (hit && hit.mtimeMs === stat.mtimeMs) return { value: hit.value, resolved };
  // .trim() matters: `echo "key" > secret.txt` leaves a trailing newline
  // that upstream APIs reject with a confusing 401.
  const value = fs.readFileSync(resolved, 'utf8').trim();
  secretCache.set(resolved, { mtimeMs: stat.mtimeMs, value });
  return { value, resolved };
}

// --- public API ---------------------------------------------

/**
 * Show a key safely in logs and on /api/llm/status.
 * Never log or return the raw key — this is the only representation
 * that should ever leave the server.
 */
export function fingerprint(key) {
  if (!key) return null;
  const s = String(key);
  if (s.length <= 10) return '…' + s.slice(-3);
  return s.slice(0, 4) + '…' + s.slice(-4);
}

/**
 * Resolve the API key for a provider.
 *
 * @param {{id:string, envPrefix:string, requiresKey:boolean}} provider
 * @returns {{key:string|null, source:string|null, detail:string|null, tried:string[], error:string|null}}
 *   `source` is the NAME of the setting that supplied the key (never the key).
 */
export function resolveCredentials(provider) {
  // Deduped because a provider whose prefix IS "LLM" (the custom one)
  // would otherwise list every name twice in the diagnostics.
  const seen = new Set();
  const candidates = [
    { name: `${provider.envPrefix}_API_KEY_FILE`, isFile: true },
    { name: `${provider.envPrefix}_API_KEY`, isFile: false },
    { name: 'LLM_API_KEY_FILE', isFile: true },
    { name: 'LLM_API_KEY', isFile: false },
  ].filter((c) => !seen.has(c.name) && seen.add(c.name));

  const tried = candidates.map((c) => c.name);

  for (const candidate of candidates) {
    const raw = readSetting(candidate.name);
    if (!raw) continue;
    if (!candidate.isFile) {
      return { key: raw, source: candidate.name, detail: null, tried, error: null };
    }
    try {
      const { value, resolved } = readSecretFile(raw);
      if (!value) {
        return {
          key: null, source: null, detail: resolved, tried,
          error: `${candidate.name} points at ${resolved}, but that file is empty.`,
        };
      }
      return { key: value, source: candidate.name, detail: resolved, tried, error: null };
    } catch (err) {
      return {
        key: null, source: null, detail: raw, tried,
        error: `${candidate.name} points at "${raw}", which could not be read (${err.code || err.message}).`,
      };
    }
  }

  // Providers such as a local Ollama need no key at all.
  if (!provider.requiresKey) {
    return { key: null, source: 'not required', detail: null, tried, error: null };
  }

  return { key: null, source: null, detail: null, tried, error: null };
}

export const ENV_FILE_PATH = ENV_FILE;
export const envFileExists = () => fs.existsSync(ENV_FILE);
