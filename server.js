// ============================================================
// HUSTLE CLUB — SERVER
// Serves the static page and proxies AI calls so the API key never
// touches the browser.
//
// This file is provider-agnostic on purpose. It knows about the
// canonical request shape and nothing else; llm-providers.js does
// the translating and credentials.js finds the key.
//
// USEFUL COMMANDS
//   npm start          run the site
//   npm run check      verify credentials + list the models your key
//                      can reach, without starting the server
//
// USEFUL ROUTES (safe to hit in a browser — neither leaks the key)
//   /api/llm/status    which provider/model is live, where the key
//                      came from, and what's wrong if anything is
//   /api/llm/models    the models your current key can actually use
// ============================================================

import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { getProvider, describeProviders, PROVIDER_IDS } from './llm-providers.js';
import { resolveCredentials, readSetting, fingerprint, ENV_FILE_PATH, envFileExists } from './credentials.js';
import { PURPOSES, geoNote, planGeoNote, currencyNote, buildPlanMessages } from './prompts.js';
import { GUARDRAILS_SYSTEM, screenInput, screenOutput } from './guardrails.js';
import { sanitizePlan } from './sanitize-plan.js';
import { createLimiter, clientIp } from './rate-limit.js';
import { logUsage, USAGE_LOG_FILE, usageLogEnabled } from './usage-log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable('x-powered-by'); // stop advertising the stack

const PORT = readSetting('PORT') || 3000;
const REQUEST_TIMEOUT_MS = Number(readSetting('LLM_TIMEOUT_MS') || 60000);

// ------------------------------------------------------------
// THE TRUST BOUNDARY
// ------------------------------------------------------------
// Everything a browser sends is hostile until proven otherwise. The
// ONLY things /api/chat accepts from a client are:
//
//   purpose   'chat' or 'plan'   — an enum, not a prompt
//   messages  the conversation   — screened, counted, length-capped
//   geo       a location hint    — scrubbed in prompts.js
//
// The system prompt, the model, and max_tokens are all decided HERE.
// A client cannot supply a system prompt (that would switch off the
// child-safety guardrails), cannot pick the model, and cannot ask for
// a bigger generation than the purpose allows.
//
// If you add a field to this endpoint, ask: what does a malicious
// caller do with it?
// ------------------------------------------------------------

const MAX_MESSAGES = Number(readSetting('LLM_MAX_MESSAGES') || 120);
const MAX_CHARS = Number(readSetting('LLM_MAX_CHARS') || 60000);

// Rate limits. Chat is 60/day in the UI, so the daily ceiling leaves
// headroom for a shared household/school IP without leaving the key open.
const burstLimiter = createLimiter({
  name: 'burst',
  windowMs: 60_000,
  max: Number(readSetting('RATE_LIMIT_PER_MINUTE') || 12),
});
const dailyLimiter = createLimiter({
  name: 'daily',
  windowMs: 24 * 60 * 60_000,
  max: Number(readSetting('RATE_LIMIT_PER_DAY') || 200),
});

// Behind nginx/Cloudflare every request looks like it came from the
// proxy, which would put all visitors in one rate-limit bucket. Enable
// TRUST_PROXY only when a proxy really is in front — otherwise clients
// can spoof X-Forwarded-For and slip the limiter.
const TRUST_PROXY = readSetting('TRUST_PROXY');
if (TRUST_PROXY) app.set('trust proxy', TRUST_PROXY === 'true' ? 1 : TRUST_PROXY);

// Admin token for the diagnostic routes. Without one they are
// loopback-only — they expose key fingerprints and server file paths.
const ADMIN_TOKEN = readSetting('LLM_ADMIN_TOKEN');

// ------------------------------------------------------------
// Configuration resolution
// ------------------------------------------------------------
// Re-run on every request so that rotating a key file (or editing
// .env when running outside Docker) takes effect immediately.
// Everything downstream is pure lookup, so this is cheap.

function resolveConfig() {
  const explicit = readSetting('LLM_PROVIDER');
  const chosen = explicit || autoDetectProvider();

  const provider = getProvider(chosen, {
    baseUrl: readSetting('LLM_BASE_URL'),
    model: readSetting('LLM_MODEL'),
    maxTokensField: readSetting('LLM_MAX_TOKENS_FIELD'),
    requiresKey: String(readSetting('LLM_REQUIRES_KEY') || '').toLowerCase() !== 'false',
  });

  // Model precedence: LLM_MODEL → <PREFIX>_MODEL → the provider's default.
  //
  // <PREFIX>_MODEL (MISTRAL_MODEL, ANTHROPIC_MODEL, …) is the one to
  // prefer: each provider keeps its own model name, so switching
  // LLM_PROVIDER just works. The generic LLM_MODEL applies to whichever
  // provider is active, which is a trap when you keep two configured —
  // a leftover LLM_MODEL=mistral-small-latest will be sent to Anthropic
  // and fail. modelSource is tracked so the boot banner can say which
  // setting won, and warn when LLM_MODEL is shadowing a specific one.
  const genericModel = readSetting('LLM_MODEL');
  const providerModel = readSetting(`${provider.envPrefix}_MODEL`);
  const model = genericModel || providerModel || provider.defaultModel;
  const modelSource = genericModel
    ? 'LLM_MODEL'
    : providerModel
      ? `${provider.envPrefix}_MODEL`
      : 'provider default';
  // Only a real conflict when they are genuinely two different settings.
  // For the `custom` provider the prefix IS "LLM", so both lookups read
  // LLM_MODEL and it would otherwise warn about shadowing itself.
  const modelShadowed = Boolean(genericModel && providerModel && provider.envPrefix !== 'LLM');

  // LLM_BASE_URL can also re-point a *known* provider — handy for a
  // corporate gateway, a regional endpoint or a caching proxy.
  const baseUrl = (readSetting('LLM_BASE_URL') || provider.baseUrl).replace(/\/+$/, '');

  const creds = resolveCredentials(provider);

  // Reasoning effort — only meaningful on reasoning-capable models
  // (Mistral Small 4 / magistral). Higher effort means the model
  // "thinks" before answering: better judgement, more tokens billed,
  // slower replies. Left unset, no parameter is sent at all.
  const reasoningEffort = readSetting(`${provider.envPrefix}_REASONING_EFFORT`)
    || readSetting('LLM_REASONING_EFFORT')
    || null;

  return {
    provider, model, baseUrl, creds,
    providerWasAutoDetected: !explicit,
    modelSource, modelShadowed, providerModel,
    reasoningEffort,
  };
}

/**
 * With no LLM_PROVIDER set, pick the first provider that actually has
 * a key present. This keeps an existing Anthropic-only deployment
 * working untouched after this upgrade, while a fresh install that
 * only has MISTRAL_API_KEY just works too.
 */
function autoDetectProvider() {
  const order = ['mistral', ...PROVIDER_IDS.filter((id) => id !== 'mistral')];
  for (const id of order) {
    const provider = getProvider(id);
    if (!provider.requiresKey) continue; // never auto-select a local server nobody asked for
    if (resolveCredentials(provider).key) return id;
  }
  return 'mistral'; // nothing configured yet — report against the default
}

/** Human-readable diagnosis of a broken/absent configuration, or null when healthy. */
function configProblem(config) {
  const { provider, creds, model } = config;
  if (creds.error) return creds.error;
  if (provider.requiresKey && !creds.key) {
    return `No API key found for ${provider.label}. Set ${provider.envPrefix}_API_KEY (or ${provider.envPrefix}_API_KEY_FILE) in ${ENV_FILE_PATH}. See CREDENTIALS.md.`;
  }
  if (!model) {
    return `No model configured for ${provider.label}. Set LLM_MODEL in ${ENV_FILE_PATH}.`;
  }
  return null;
}

// ------------------------------------------------------------
// Upstream call
// ------------------------------------------------------------

async function callProvider(config, canonicalBody) {
  const { provider, baseUrl, creds, model, reasoningEffort } = config;
  const url = provider.chatUrl(baseUrl);
  const payload = provider.toRequest({ ...canonicalBody, model, reasoning_effort: reasoningEffort });

  // Without this, a stalled provider holds the request (and a teen's
  // chat window) open indefinitely.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: provider.headers(creds.key),
      body: JSON.stringify(payload),
      signal: abort.signal,
    });

    const raw = await upstream.text();
    let json = null;
    try { json = raw ? JSON.parse(raw) : null; } catch { /* non-JSON error page from a proxy */ }

    if (!upstream.ok) {
      const detail = (json && provider.upstreamError(json)) || raw.slice(0, 300) || upstream.statusText;
      return {
        ok: false,
        status: upstream.status,
        detail,
        retryAfter: upstream.headers.get('retry-after'),
      };
    }

    const result = provider.fromResponse(json);
    return { ok: true, status: 200, result };
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------
// Routes
// ------------------------------------------------------------

// 2mb was generous for a text chat; the message caps above are the real
// control, but a smaller ceiling rejects junk before it is parsed.
app.use(express.json({ limit: '256kb' }));

// Baseline security headers. A strict script-src CSP is not practical
// here because index.html is built entirely from inline <script> and
// inline styles — so the directives below cover what CAN be locked down
// without breaking the page: no plugins, no <base> hijack, no framing.
// The real XSS control is sanitize-plan.js.
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy':
      "default-src 'self'; " +
      "img-src 'self' data: https:; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "script-src 'self' 'unsafe-inline' https://unpkg.com; " +
      "connect-src 'self' https://ipapi.co; " +
      "object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  });
  next();
});

// The static root is the project folder, which also holds server-side
// code and config. Two layers keep those out of the browser:
//
//  1. dotfiles:'deny' — .env and friends are never served. (This is
//     also express.static's default, but a credential leak is not a
//     thing to leave resting on an implicit default.)
//  2. The block list below — server-only files that would otherwise be
//     readable as plain text. credentials.js in particular tells a
//     reader exactly where your key file lives.
//
// Add new server-side modules here. Anything else — images, uploads,
// fonts — is served normally with no further changes.
//
// NOT in this list, and deliberately so: guardrails.js and
// sanitize-plan.js. The browser imports both — it screens and
// sanitises too, for instant feedback and as a second layer. They hold
// no secrets, and the security guarantee comes from the SERVER running
// them, not from the browser being unable to read them.
const SERVER_ONLY = new Set([
  'server.js', 'credentials.js', 'llm-providers.js',
  'prompts.js', 'rate-limit.js', 'usage-log.js',
  'package.json', 'package-lock.json',
  'Dockerfile', 'docker-compose.yml',
  'README.md', 'CREDENTIALS.md', 'SECURITY.md',
]);

app.use((req, res, next) => {
  const decoded = decodeURIComponent(req.path);
  // The usage log holds visitor metadata — never serve it over HTTP.
  if (/(^|\/)logs(\/|$)/i.test(decoded)) return res.status(404).send('Not found');
  if (SERVER_ONLY.has(path.basename(decoded))) return res.status(404).send('Not found');
  next();
});

app.use(express.static(__dirname, { dotfiles: 'deny' }));

/**
 * POST /api/chat
 *
 * In:  { purpose: 'chat'|'plan', messages: [{role, content}], geo?, timezone? }
 * Out: { text, model, provider, usage }
 *
 * Note what is NOT accepted: system, model, max_tokens. See the trust
 * boundary block at the top of this file.
 *
 * The `content` array in the response is Anthropic-shaped and exists
 * purely so any older copy of index.html still parses replies. New
 * code should read `text`.
 */
app.post('/api/chat', async (req, res) => {
  const started = Date.now();
  const ip = clientIp(req);
  const body = req.body || {};

  // The geo hint is untrusted; prompts.js scrubs it before it reaches a
  // prompt and usage-log.js quotes it before it reaches the log.
  const geo = body.geo && typeof body.geo === 'object' ? body.geo : {};
  const base = { ip, geo, timezone: body.timezone };

  // --- 1. Rate limit BEFORE any work, so a flood costs us nothing ---
  for (const limiter of [burstLimiter, dailyLimiter]) {
    const verdict = limiter.take(ip);
    if (!verdict.allowed) {
      logUsage({ ...base, event: body.purpose, status: 'rate-limited', ms: Date.now() - started });
      res.set('Retry-After', String(verdict.retryAfterSec));
      return res.status(429).json({
        error: 'rate_limited',
        message: "You've been going fast — give it a minute and try again.",
      });
    }
  }

  // --- 2. Validate the shape ---
  const purpose = String(body.purpose || 'chat');
  const spec = PURPOSES[purpose];
  if (!spec) {
    return res.status(400).json({ error: 'bad_request', message: 'purpose must be "chat" or "plan"' });
  }

  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    return res.status(400).json({ error: 'bad_request', message: 'messages[] is required' });
  }
  if (messages.length > MAX_MESSAGES) {
    return res.status(413).json({ error: 'too_long', message: 'This conversation is too long. Start over to keep going.' });
  }

  // Roles are an enum and content must be a string: anything else is
  // either a bug or someone probing the upstream API's shape.
  const clean = [];
  let totalChars = 0;
  for (const m of messages) {
    const role = m && m.role === 'assistant' ? 'assistant' : 'user';
    const content = typeof (m && m.content) === 'string' ? m.content : '';
    if (!content) continue;
    totalChars += content.length;
    if (totalChars > MAX_CHARS) {
      return res.status(413).json({ error: 'too_long', message: 'This conversation is too long. Start over to keep going.' });
    }
    clean.push({ role, content });
  }
  if (clean.length === 0) {
    return res.status(400).json({ error: 'bad_request', message: 'no usable messages' });
  }

  // --- 3. Guardrails, server-side (the browser also screens, for speed) ---
  const lastUser = [...clean].reverse().find((m) => m.role === 'user');
  const screened = screenInput(lastUser ? lastUser.content : '');
  if (!screened.ok) {
    // Refused without calling the model at all: safer and free.
    logUsage({ ...base, event: purpose, status: 'blocked-input', ms: Date.now() - started });
    if (purpose === 'plan') {
      return res.status(422).json({ error: 'screened', message: screened.reply });
    }
    return res.json({ text: screened.reply, screened: true, content: [{ type: 'text', text: screened.reply }] });
  }

  // --- 4. Configuration ---
  let config;
  try {
    config = resolveConfig();
  } catch (err) {
    console.error('[llm] configuration error:', err.message);
    return res.status(503).json({ error: 'config_error', message: err.message });
  }
  const problem = configProblem(config);
  if (problem) {
    console.error('[llm] not configured:', problem);
    // 503 + this exact code is what makes the page say "Scout's not
    // plugged in yet" instead of the generic "the line dropped".
    return res.status(503).json({ error: 'no_credentials', message: problem });
  }

  // --- 5. Build the prompt HERE. Never from req.body. ---
  // Reasoning models spend part of max_tokens thinking, so they get the
  // larger ceiling — otherwise the answer is truncated or empty.
  // Both purposes get location + currency context. The plan used to get
  // neither, which is how a São Paulo plan ended up quoting "$80 saved"
  // next to "R$30 tune-up".
  const location = purpose === 'plan' ? planGeoNote(geo) : geoNote(geo);
  const canonical = {
    system: spec.system + location + currencyNote(geo) + GUARDRAILS_SYSTEM,
    messages: purpose === 'plan' ? buildPlanMessages(clean) : clean,
    max_tokens: config.reasoningEffort ? spec.reasoningMaxTokens : spec.maxTokens,
  };

  try {
    const outcome = await callProvider(config, canonical);

    if (!outcome.ok) {
      console.error(`[llm] ${config.provider.id} returned ${outcome.status}: ${outcome.detail}`);
      if (outcome.status === 401 || outcome.status === 403) {
        console.error(
          `[llm] → that key came from ${config.creds.source}. It is rejected: rotate it (CREDENTIALS.md) or check the account is active.`
        );
      }
      if (outcome.status === 404 || /model/i.test(outcome.detail || '')) {
        console.error(`[llm] → model "${config.model}" may not exist on ${config.provider.label}. Run: npm run check`);
      }
      // ── Classify the failure ────────────────────────────────────
      // These used to collapse into one generic "the line dropped, tap
      // Try again" message. That is actively wrong when the account is
      // out of credit: the teen retries forever and it can never work.
      //
      //   401/402/403 → our problem (key revoked, credit exhausted).
      //                 NOT transient. Do not invite a retry.
      //   429/503     → provider is busy or throttling us. Transient,
      //                 but retrying immediately makes it worse.
      //   everything else → transient blip, a retry is reasonable.
      const s = outcome.status;
      const kind = (s === 401 || s === 402 || s === 403) ? 'provider_unavailable'
        : (s === 429 || s === 503) ? 'provider_busy'
        : 'upstream_error';

      if (kind === 'provider_unavailable') {
        console.error(
          `[llm] ⛔ ${config.provider.label} REJECTED the request (HTTP ${s}). This is an ACCOUNT problem, ` +
          `not a user problem — check credit/billing and that the key from ${config.creds.source} is still valid. ` +
          `Users are being turned away until this is fixed.`
        );
      }

      logUsage({ ...base, event: purpose, status: kind.replace('_', '-'), provider: config.provider.id, model: config.model, ms: Date.now() - started });

      if (outcome.retryAfter) res.set('Retry-After', String(outcome.retryAfter));
      // The upstream message goes to OUR logs, not to the browser — it
      // can name accounts, orgs and internal limits.
      return res.status(kind === 'provider_busy' ? 503 : 502).json({
        error: kind,
        message: kind === 'provider_unavailable'
          ? 'The AI service is unavailable for this site right now.'
          : kind === 'provider_busy'
            ? 'The AI service is busy right now.'
            : 'The AI service returned an error.',
      });
    }

    let text = outcome.result.text;

    // --- 6a. Empty-reply guard ---
    // A reasoning model can burn its whole token budget thinking and
    // return no text chunk at all. Observed live before the budgets in
    // prompts.js were raised. Never render that as an empty chat
    // bubble — say something useful and make the cause loud in the log.
    if (!text || !text.trim()) {
      console.error(
        `[llm] ${config.model} returned no text for purpose="${purpose}" ` +
        `(usage ${JSON.stringify(outcome.result.usage)}). ` +
        (config.reasoningEffort
          ? `reasoning_effort=${config.reasoningEffort} likely consumed the whole ` +
            `max_tokens budget — raise reasoningMaxTokens in prompts.js or lower the effort.`
          : 'the model returned an empty completion.')
      );
      logUsage({ ...base, event: purpose, status: 'empty-reply', provider: config.provider.id, model: config.model, usage: outcome.result.usage, ms: Date.now() - started });
      if (purpose === 'plan') {
        return res.status(502).json({ error: 'upstream_error', message: 'Plan machine jammed. Try again in a minute.' });
      }
      const retry = 'Hmm, I lost my train of thought there. Say that again?\nOPTIONS: Try again';
      return res.json({ text: retry, content: [{ type: 'text', text: retry }] });
    }

    // --- 6b. Truncation guard ---
    // finish_reason='length' means max_tokens ran out mid-sentence.
    // For a PLAN that is not cosmetic: section 7 carries the safety and
    // legal small print, so a truncated plan is one that lost its
    // disclaimers. Never show a partial plan — regenerate instead.
    if (outcome.result.finishReason === 'length') {
      console.error(
        `[llm] ⚠ ${config.model} hit the token ceiling for purpose="${purpose}" ` +
        `(output ${outcome.result.usage?.output}). Raise ${config.reasoningEffort ? 'reasoningMaxTokens' : 'maxTokens'} ` +
        `in prompts.js, or lower the reasoning effort.`
      );
      logUsage({ ...base, event: purpose, status: 'truncated', provider: config.provider.id, model: config.model, usage: outcome.result.usage, ms: Date.now() - started });

      if (purpose === 'plan') {
        return res.status(502).json({
          error: 'truncated',
          message: 'That plan came out half-finished. Tap "Get my plan" again in a moment.',
        });
      }
      // A chat reply cut short still leaves the teen without the
      // OPTIONS line the UI needs, so give them a way forward.
      if (!/\bOPTIONS:/i.test(text)) {
        text = text.trimEnd() + '\n\n(Sorry — I ran out of breath there!)\nOPTIONS: Try again';
      }
    }

    // --- 6. Screen and sanitise the output ---
    if (purpose === 'plan') {
      text = sanitizePlan(text); // allow-list; see sanitize-plan.js
      const verdict = screenOutput(text);
      if (!verdict.ok) {
        logUsage({ ...base, event: purpose, status: 'blocked-output', provider: config.provider.id, model: config.model, usage: outcome.result.usage, ms: Date.now() - started });
        return res.status(422).json({ error: 'screened', message: verdict.message });
      }
    } else {
      const verdict = screenOutput(text);
      if (!verdict.ok) {
        logUsage({ ...base, event: purpose, status: 'blocked-output', provider: config.provider.id, model: config.model, usage: outcome.result.usage, ms: Date.now() - started });
        const safe = "Let's keep this one on track — tell me a bit more about your hustle.";
        return res.json({ text: safe, screened: true, content: [{ type: 'text', text: safe }] });
      }
    }

    logUsage({
      ...base, event: purpose, status: 'ok',
      provider: config.provider.id, model: outcome.result.model || config.model,
      usage: outcome.result.usage, ms: Date.now() - started,
    });

    return res.json({
      text,
      model: outcome.result.model || config.model,
      provider: config.provider.id,
      usage: outcome.result.usage,
      content: [{ type: 'text', text }], // back-compat, see doc block
    });
  } catch (err) {
    const timedOut = err.name === 'AbortError';
    console.error(`[llm] failed to reach ${config.provider.label} at ${config.baseUrl}:`, err.message);
    logUsage({ ...base, event: purpose, status: timedOut ? 'timeout' : 'unreachable', provider: config.provider.id, model: config.model, ms: Date.now() - started });
    return res.status(504).json({
      error: timedOut ? 'timeout' : 'unreachable',
      message: timedOut
        ? `${config.provider.label} did not respond within ${REQUEST_TIMEOUT_MS}ms`
        : `Could not reach ${config.provider.label}`,
    });
  }
});

/**
 * Gate for the diagnostic routes.
 *
 * These report absolute server paths (your .env, your key file) and a
 * fingerprint of the live key. That is exactly the reconnaissance an
 * attacker wants, so they are NOT public:
 *
 *   • requests from loopback always pass (you, on the box, via curl)
 *   • otherwise LLM_ADMIN_TOKEN must be set AND presented as
 *     `Authorization: Bearer <token>`
 *   • with no token configured, remote callers get a plain 404
 *
 * Generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
function adminOnly(req, res, next) {
  const ip = clientIp(req);
  const isLocal = /^(::1|::ffff:127\.|127\.)/.test(String(ip));
  if (isLocal) return next();

  if (!ADMIN_TOKEN) return res.status(404).send('Not found');

  const presented = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  // Constant-time compare so the token can't be guessed a byte at a time.
  const a = Buffer.from(presented);
  const b = Buffer.from(ADMIN_TOKEN);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(404).send('Not found');
  }
  return next();
}

/**
 * GET /api/llm/status — configuration health. Admin-gated: reports
 * where the key came from and a fingerprint, never the key itself.
 */
app.get('/api/llm/status', adminOnly, (req, res) => {
  try {
    const config = resolveConfig();
    const problem = configProblem(config);
    res.status(problem ? 503 : 200).json({
      ok: !problem,
      problem,
      provider: { id: config.provider.id, label: config.provider.label, autoDetected: config.providerWasAutoDetected },
      model: config.model,
      baseUrl: config.baseUrl,
      credentials: {
        configured: Boolean(config.creds.key) || !config.provider.requiresKey,
        source: config.creds.source,
        file: config.creds.detail,
        fingerprint: fingerprint(config.creds.key),
        checked: config.creds.tried,
      },
      envFile: { path: ENV_FILE_PATH, exists: envFileExists() },
      availableProviders: describeProviders(),
    });
  } catch (err) {
    res.status(503).json({ ok: false, problem: err.message });
  }
});

/**
 * GET /api/llm/models — ask the provider what this key can use.
 * The fastest way to fix a "model not found" error.
 */
app.get('/api/llm/models', adminOnly, async (req, res) => {
  let config;
  try {
    config = resolveConfig();
  } catch (err) {
    return res.status(503).json({ error: 'config_error', message: err.message });
  }

  const problem = configProblem(config);
  if (problem) return res.status(503).json({ error: 'no_credentials', message: problem });

  try {
    const upstream = await fetch(config.provider.modelsUrl(config.baseUrl), {
      headers: config.provider.headers(config.creds.key),
    });
    const json = await upstream.json();
    if (!upstream.ok) {
      return res.status(502).json({
        error: 'upstream_error',
        message: config.provider.upstreamError(json) || upstream.statusText,
      });
    }
    res.json({
      provider: config.provider.id,
      current: config.model,
      models: config.provider.listModels(json),
    });
  } catch (err) {
    res.status(502).json({ error: 'unreachable', message: err.message });
  }
});

// ------------------------------------------------------------
// Start-up / `npm run check`
// ------------------------------------------------------------

function printStartupReport(config, problem) {
  const { provider, model, baseUrl, creds, providerWasAutoDetected, modelSource, modelShadowed, providerModel } = config;
  console.log('─'.repeat(62));
  console.log(`  Provider : ${provider.label}${providerWasAutoDetected ? '  (auto-detected — pin it with LLM_PROVIDER)' : ''}`);
  console.log(`  Model    : ${model || '(none)'}   ← from ${modelSource}`);
  if (config.reasoningEffort) console.log(`  Reasoning: effort=${config.reasoningEffort}`);
  console.log(`  Endpoint : ${baseUrl}`);
  if (modelShadowed) {
    console.log(`  ⚠  LLM_MODEL is overriding ${provider.envPrefix}_MODEL="${providerModel}".`);
    console.log(`     LLM_MODEL applies to whichever provider is active, so it will be`);
    console.log(`     sent to ${provider.label} too. Remove LLM_MODEL and keep the`);
    console.log(`     per-provider settings if you switch providers.`);
  }
  if (creds.key) {
    console.log(`  Key      : ${fingerprint(creds.key)} from ${creds.source}${creds.detail ? ` → ${creds.detail}` : ''}`);
  } else if (!provider.requiresKey) {
    console.log('  Key      : not required by this provider');
  }
  if (problem) {
    console.log('─'.repeat(62));
    console.log(`  ⚠  ${problem}`);
    console.log(`     Checked, in order: ${creds.tried.join(', ')}`);
    if (provider.keysUrl) console.log(`     Get a key: ${provider.keysUrl}`);
    console.log('     Full instructions: CREDENTIALS.md');
  }
  console.log('─'.repeat(62));
}

function printSecurityReport() {
  console.log(`  Rate limit : ${burstLimiter.max}/min and ${dailyLimiter.max}/day per IP`);
  console.log(`  Usage log  : ${usageLogEnabled() ? USAGE_LOG_FILE : 'disabled (USAGE_LOG=off)'}`);
  console.log(`  Admin API  : ${ADMIN_TOKEN ? 'token required' : 'loopback only (set LLM_ADMIN_TOKEN for remote access)'}`);
  if (!TRUST_PROXY) {
    console.log('  ⚠  TRUST_PROXY is not set. If nginx/Cloudflare sits in front of');
    console.log('     this app, every visitor shares one rate-limit bucket. See .env.example.');
  }
  console.log('─'.repeat(62));
}

// `node server.js --check` verifies the setup and exits. Run this after
// every credential change — it proves the key works before real users find out.
if (process.argv.includes('--check')) {
  const run = async () => {
    let config;
    try {
      config = resolveConfig();
    } catch (err) {
      console.error(`\n  ✖ ${err.message}\n`);
      process.exit(1);
    }
    const problem = configProblem(config);
    printStartupReport(config, problem);
    if (problem) process.exit(1);

    process.stdout.write('  Testing the key against the provider… ');
    try {
      const upstream = await fetch(config.provider.modelsUrl(config.baseUrl), {
        headers: config.provider.headers(config.creds.key),
      });
      const json = await upstream.json().catch(() => null);
      if (!upstream.ok) {
        console.log('✖');
        console.log(`\n  ${config.provider.label} rejected the key (HTTP ${upstream.status}): ${config.provider.upstreamError(json) || upstream.statusText}`);
        if (upstream.status === 401) console.log('  The key is wrong, expired, or revoked. Rotate it — see CREDENTIALS.md.');
        console.log('');
        process.exit(1);
      }
      const models = config.provider.listModels(json);
      console.log('✔ key accepted');
      const hit = models.find((m) => m.id === config.model);
      console.log(`\n  Configured model "${config.model}" ${hit ? 'is available. ✔' : 'was NOT in this key\'s model list. ✖'}`);
      if (models.length) {
        console.log(`\n  ${models.length} models available to this key:`);
        for (const m of models.slice(0, 40)) console.log(`    ${m.id === config.model ? '→' : ' '} ${m.id}`);
        if (models.length > 40) console.log(`      …and ${models.length - 40} more`);
        console.log('\n  Pin a different one with LLM_MODEL in .env.');
      }
      console.log('');
      process.exit(hit ? 0 : 1);
    } catch (err) {
      console.log('✖');
      console.log(`\n  Could not reach ${config.baseUrl} — ${err.message}\n`);
      process.exit(1);
    }
  };
  run();
} else {
  app.listen(PORT, () => {
    console.log(`\n  Hustle Club listening on port ${PORT}`);
    try {
      const config = resolveConfig();
      printStartupReport(config, configProblem(config));
      printSecurityReport();
    } catch (err) {
      console.log(`\n  ⚠  ${err.message}\n`);
    }
  });
}
