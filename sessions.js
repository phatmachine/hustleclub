// ============================================================
// HUSTLE CLUB — SESSION STORE (SQLite)
//
// ⚠️ THIS FILE BREAKS A PROMISE THE REST OF THE APP USED TO MAKE.
// Until this existed, no conversation ever left the browser: the page
// kept the chat in localStorage and the server logged only counts.
// That promise cost us two real things — a shared device handed
// between siblings or a class showed one teen another teen's chat,
// and a plan was trapped on whichever phone made it.
//
// So conversations are now stored, and the rules that make that
// acceptable live HERE, not in a policy document:
//   1. RETENTION. Rows are deleted after RETENTION_DAYS. The purge
//      runs at boot and hourly, not "when someone remembers".
//   2. NO IDENTITY. There is no user, no email, no device id. A row
//      is reachable only by its own code (codes.js).
//   3. NO GROWTH. One row per code, capped in size. A session that
//      is written a hundred times is still one row.
// Change any of those three and you are making a privacy decision,
// not a technical one. SECURITY.md documents the trade — keep it
// honest if you change this file.
//
// node:sqlite is built into Node (22+), so this adds no dependency
// and no native build step to an image that had neither.
// ============================================================

import { createRequire } from 'node:module';
import path from 'path';
import fs from 'fs';

// ⚠️ LOADED DEFENSIVELY, NOT WITH A STATIC IMPORT.
// `import { DatabaseSync } from 'node:sqlite'` throws at MODULE LOAD
// on a Node without it (before 22.5, or 22.5-23.3 without
// --experimental-sqlite). A static import would therefore turn "no
// SQLite" into "the whole site fails to boot" — trading a missing
// nice-to-have for a total outage. require() through createRequire is
// synchronous, so everything below stays sync, and catchable.
const require = createRequire(import.meta.url);
let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  console.error(
    '[sessions] ⚠ node:sqlite is not available on this Node build — recall codes are OFF, '
    + 'the chat still works from the browser. Needs Node 22.5+ (24 LTS recommended). '
    + err.message
  );
}

const DEFAULT_DIR = 'data';
const RETENTION_DAYS = Number(process.env.SESSION_RETENTION_DAYS || 90);
/** A conversation this big is a bug or an attack, not a teen chatting. */
const MAX_BYTES = 128 * 1024;
const HOUR = 3600 * 1000;

let db = null;
let purgeTimer = null;

export const SESSION_FILE = process.env.SESSION_DB_FILE
  || path.join(process.cwd(), DEFAULT_DIR, 'sessions.db');

/**
 * Open (and migrate) the store.
 *
 * Failure here must never take the site down: the chat works fine
 * without persistence, it just loses the come-back-later trick. So a
 * broken disk logs loudly and leaves `db` null, and every function
 * below degrades to "no store".
 */
export function openSessions() {
  if (db) return db;
  if (!DatabaseSync) return null; // already warned at load
  try {
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    db = new DatabaseSync(SESSION_FILE);
    // WAL keeps a reader (a teen restoring) from blocking a writer
    // (a teen mid-chat) on the same box.
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        code       TEXT PRIMARY KEY,
        messages   TEXT NOT NULL,
        stage      TEXT NOT NULL DEFAULT 'coaching',
        trial_complete BOOLEAN NOT NULL DEFAULT 0,
        feedback_given BOOLEAN NOT NULL DEFAULT 0,
        return_code TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at)');
    purgeExpired();
    if (!purgeTimer) {
      purgeTimer = setInterval(purgeExpired, HOUR);
      purgeTimer.unref(); // never hold the process open just to purge
    }
    console.log(`[sessions] store ready at ${SESSION_FILE} (retention ${RETENTION_DAYS}d)`);
  } catch (err) {
    db = null;
    console.error('[sessions] ⚠ could not open the store — come-back-later codes are OFF:', err.message);
  }
  return db;
}

export function sessionsEnabled() {
  return db !== null;
}

/** Delete anything past retention. Returns how many rows went. */
export function purgeExpired() {
  if (!db) return 0;
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * HOUR;
    const info = db.prepare('DELETE FROM sessions WHERE updated_at < ?').run(cutoff);
    const gone = Number(info.changes || 0);
    if (gone) console.log(`[sessions] purged ${gone} session(s) past ${RETENTION_DAYS} days`);
    return gone;
  } catch (err) {
    console.error('[sessions] purge failed:', err.message);
    return 0;
  }
}

/**
 * Write a conversation under `code`, creating the row if new.
 *
 * The caller owns code generation (server.js) so that a collision can
 * be retried against a fresh code rather than silently overwriting
 * somebody else's chat — hence INSERT, not INSERT OR REPLACE, on the
 * create path.
 */
export function saveSession(code, messages, stage, trialComplete = false, feedbackGiven = false, returnCode = null) {
  if (!db) return false;
  const json = JSON.stringify(messages);
  if (json.length > MAX_BYTES) {
    console.warn(`[sessions] refused an oversized session (${json.length} bytes)`);
    return false;
  }
  const now = Date.now();
  try {
    db.prepare(`
      INSERT INTO sessions (code, messages, stage, trial_complete, feedback_given, return_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET
        messages = excluded.messages,
        stage = excluded.stage,
        trial_complete = excluded.trial_complete,
        feedback_given = excluded.feedback_given,
        return_code = excluded.return_code,
        updated_at = excluded.updated_at
    `).run(code, json, stage, trialComplete ? 1 : 0, feedbackGiven ? 1 : 0, returnCode, now, now);
    return true;
  } catch (err) {
    console.error('[sessions] save failed:', err.message);
    return false;
  }
}

/** Claim a brand-new code. False means "taken, pick another". */
export function claimCode(code) {
  if (!db) return false;
  const now = Date.now();
  try {
    db.prepare(`
      INSERT INTO sessions (code, messages, stage, trial_complete, feedback_given, return_code, created_at, updated_at)
      VALUES (?, '[]', 'coaching', 0, 0, NULL, ?, ?)
    `).run(code, now, now);
    return true;
  } catch {
    return false; // PRIMARY KEY conflict: that code is already someone's
  }
}

/** Read a conversation back. Null when there is nothing under that code. */
export function loadSession(code) {
  if (!db) return null;
  try {
    // Check both the session code and return code
    const row = db.prepare(
      'SELECT messages, stage, trial_complete, feedback_given, return_code, created_at, updated_at FROM sessions WHERE code = ? OR return_code = ?'
    ).get(code, code);
    if (!row) return null;
    // Expired but not yet swept: treat as gone rather than serving it.
    if (row.updated_at < Date.now() - RETENTION_DAYS * 24 * HOUR) return null;
    let messages;
    try {
      messages = JSON.parse(row.messages);
    } catch {
      return null;
    }
    if (!Array.isArray(messages)) return null;
    return {
      messages,
      stage: row.stage,
      trialComplete: Boolean(row.trial_complete),
      feedbackGiven: Boolean(row.feedback_given),
      returnCode: row.return_code || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  } catch (err) {
    console.error('[sessions] load failed:', err.message);
    return null;
  }
}

/** Counts only — used by the admin status route, never content. */
export function sessionStats() {
  if (!db) return { enabled: false };
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM sessions').get();
    return { enabled: true, sessions: Number(row.n || 0), retentionDays: RETENTION_DAYS };
  } catch {
    return { enabled: true, sessions: null, retentionDays: RETENTION_DAYS };
  }
}

/**
 * Check if a code belongs to a returning user who should get rate limit exemptions.
 * A returning user is one who has completed trial and is coming back to enter feedback and generate a plan.
 * This checks the return_code field specifically, as returning users are identified by their return code.
 */
export function isReturningUser(code) {
  if (!db) return false;
  try {
    // Check the return_code field specifically for returning users
    const row = db.prepare(
      'SELECT trial_complete, feedback_given FROM sessions WHERE return_code = ?'
    ).get(code);
    if (!row) return false;
    // User is returning if they have completed trial but not yet given feedback
    // This allows them to come back and enter feedback + generate plan
    return Boolean(row.trial_complete) && !Boolean(row.feedback_given);
  } catch (err) {
    console.error('[sessions] isReturningUser check failed:', err.message);
    return false;
  }
}

/**
 * Check if a session code has trial completed (for session continuation).
 * This is different from isReturningUser which checks return codes for feedback entry.
 */
export function isTrialComplete(sessionCode) {
  if (!db) return false;
  try {
    const row = db.prepare(
      'SELECT trial_complete FROM sessions WHERE code = ?'
    ).get(sessionCode);
    return row ? Boolean(row.trial_complete) : false;
  } catch (err) {
    console.error('[sessions] isTrialComplete check failed:', err.message);
    return false;
  }
}

/**
 * Mark a session as having trial completed and generate a return code for feedback entry.
 */
export function markTrialComplete(code, returnCode) {
  if (!db) return false;
  try {
    const now = Date.now();
    db.prepare(`
      UPDATE sessions SET 
        trial_complete = 1,
        return_code = ?,
        updated_at = ?
      WHERE code = ?
    `).run(returnCode || null, now, code);
    return true;
  } catch (err) {
    console.error('[sessions] markTrialComplete failed:', err.message);
    return false;
  }
}

/**
 * Mark a session as having feedback given, allowing plan generation.
 */
export function markFeedbackGiven(code) {
  if (!db) return false;
  try {
    const now = Date.now();
    db.prepare(`
      UPDATE sessions SET 
        feedback_given = 1,
        updated_at = ?
      WHERE code = ?
    `).run(now, code);
    return true;
  } catch (err) {
    console.error('[sessions] markFeedbackGiven failed:', err.message);
    return false;
  }
}
