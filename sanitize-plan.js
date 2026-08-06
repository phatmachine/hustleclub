// ============================================================
// HUSTLE CLUB — PLAN SANITISER
// The generated business plan is raw HTML from a language model, and
// it gets injected into the page with dangerouslySetInnerHTML. That
// makes this file the only thing standing between a prompt-injected
// reply and script execution in a teen's browser.
//
// ⚠️ WHY THE OLD APPROACH WAS REPLACED
// The previous version stripped things it did not like — script tags
// and on*="..." handlers. Deny-lists always leak. It caught
//   <img src=x onerror="alert(1)">
// and missed all of these:
//   <img src=x onerror=alert(1)>        (unquoted)
//   <img src=x onerror='alert(1)'>      (single-quoted)
//   <svg onload=alert(1)>
//   <a href="javascript:alert(1)">
//   <iframe src="javascript:alert(1)">
// 8 of 9 test payloads survived it.
//
// ✅ THE RULE NOW: allow-list, and drop ALL attributes.
// The plan spec (PLAN_SYS in prompts.js) uses a fixed set of tags and
// needs no attributes at all — no links, no images, no styles. So any
// tag outside ALLOWED_TAGS is removed, and every allowed tag is
// rewritten from scratch as a bare <tag>. There is nowhere left to
// hang an event handler or a javascript: URL.
//
// ⚠️ THE PLAN IS STYLED BY STRUCTURE, NOT BY CLASSES.
// The branded print layout (buildPlanDoc() in index.html) reads this
// bare, attribute-free markup and rebuilds it into cards, tables and
// callouts, adding every class itself. That is deliberate: the model
// never supplies a class, so the "no attributes" rule above stays
// absolute and the design can never be broken by model output.
//
// If you ever need a new tag in the plan, add it to ALLOWED_TAGS below
// and update BOTH the PLAN_SYS skeleton and buildPlanDoc() to match.
// Do NOT add attribute support without thinking hard about URL schemes.
//
// Isomorphic on purpose: pure string work, no DOM and no Node APIs, so
// server.js and index.html run the identical code (defence in depth —
// the server sanitises before sending, the page sanitises before
// rendering).
// ============================================================

/** The only tags the plan is allowed to contain.
 *  h1 is the venture headline; the table tags carry the startup budget.
 *  All of them are inert without attributes — a bare <td> cannot run
 *  anything — so this stays a pure-structure allow-list. */
export const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'br',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
];

const ALLOWED = new Set(ALLOWED_TAGS);
// Matches one tag-ish token: <foo ...>, </foo>, <!-- ... -->, <?...>
const TAG = /<[^>]*>?/g;
// A clean open/close tag we are willing to keep, e.g. "</h2" or "<li"
const SIMPLE = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)/;

/**
 * Reduce model-generated HTML to a safe subset.
 *
 * @param {string} html raw model output
 * @returns {string} HTML containing only bare allow-listed tags
 */
export function sanitizePlan(html) {
  let s = String(html == null ? '' : html);

  // Models like to wrap HTML in a markdown fence despite being told not to.
  s = s.replace(/```+\s*html?/gi, '').replace(/```+/g, '');

  // Comments can hide markup from a careless reader; the plan needs none.
  s = s.replace(/<!--[\s\S]*?-->/g, '');

  const out = [];
  let last = 0;
  let match;
  TAG.lastIndex = 0;

  while ((match = TAG.exec(s)) !== null) {
    // Text between tags: escape it so a stray "<" can never start a tag.
    out.push(escapeText(s.slice(last, match.index)));
    last = match.index + match[0].length;

    const parts = SIMPLE.exec(match[0]);
    if (!parts) continue; // "<!doctype", "<?xml", a bare "<" — drop it

    const closing = parts[1] === '/';
    const name = parts[2].toLowerCase();
    if (!ALLOWED.has(name)) continue; // script, img, svg, iframe, a, … all dropped

    // Rebuilt from the tag NAME only. Every attribute in the source —
    // onerror, onload, href, style, srcset — is discarded here.
    out.push(name === 'br' ? '<br>' : closing ? `</${name}>` : `<${name}>`);
  }

  out.push(escapeText(s.slice(last)));
  return out.join('');
}

// Escaping "&" naively would turn the model's own "&amp;" into a
// visible "&amp;" on the page. Only bare ampersands — ones that do not
// already start a valid entity — get escaped.
const BARE_AMP = /&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});)/g;

function escapeText(text) {
  return text.replace(BARE_AMP, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
