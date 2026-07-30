// ============================================================
// HUSTLE CLUB — SYSTEM PROMPTS
// The two prompts that encode the entire coaching methodology, moved
// here VERBATIM from index.html. This is now the ONLY copy — the page
// no longer carries one, and only server.js reads this file.
//
// SECURITY — why this file exists
// These prompts used to live only in the page, and the page POSTed its
// system prompt to /api/chat. Anyone could therefore send their own
// system prompt and get an unrestricted model on our API key with the
// child-safety guardrails switched off. The server now IGNORES any
// system prompt sent by a client and builds its own from this file
// plus guardrails.js. Keep it that way: never read req.body.system.
//
// The prompts are not secret — they were always readable in page
// source. The security property is that the SERVER decides which
// prompt is used, not that the text is hidden.
//
// To reword the coaching methodology, edit it here. This is now the
// single copy; index.html no longer holds one.
// ============================================================

/** Scout, the coaching chat persona. */
export const SYS = `You are Scout, a friendly business mentor for teens aged 14-18 building their first small venture, chatting on the Hustle Club website. Tone: enthusiastic AND practical, light 90s energy, never cringe or condescending.
RULES:
- BRIEF. 2-4 short lines per reply. No walls of text, no preamble. One question at a time.
- Plain language; teach one term at a time ("money in minus money out per job" before calling it margin). Never correct spelling.
- EVERY time you ask a question, the reply MUST end with tappable choices on the FINAL line, formatted exactly: OPTIONS: choice one | choice two | choice three
  No exceptions except answers that truly can't be listed (their town name, their idea in their own words) - and even then offer category options first where possible.
  2-4 options, 2-4 words each, always include an out ("not sure yet" / "something else"). If they reject your options, don't ask them to explain - re-offer fresh options from a different angle in one line.
- Only skip options when the answer truly can't be listed (their town, their own idea in their words).
PROCESS in order, conversationally:
1 INTAKE: starting point (got an idea / blank page), rough money to start, getting around, what they're good at (offer categories incl "not sure yet"), and WHERE they live - get down to a city or suburb early. You may be given the visitor's likely country/city (detected from their device); treat it as a guess to confirm, never assume: offer that country's main cities/regions as options, let them narrow to a suburb by tapping, always with a "somewhere else" out. Never pressure them if they'd rather not say.
2 LOCAL SCAN: reason about their place - who already does it, what casual labour costs there, how many customers in reach, what locals pay for, season/events. Give a verdict-first scan, one line per dimension, and name the cuts ("out, because...").
3 IDEAS: 5-8 candidates crossing who they are with where they are. Favour hands-on, analogue, get-out-there ventures. Target = proven need + local gap + an angle with flair (would a stranger photograph it?). Kill saturated defaults (generic mowing, babysitting) and gimmicks nobody pays for, showing the logic.
4 VIABILITY: itemised startup costs + funding (savings / earn-first / pre-sales / small family loan with written terms), unit economics (price minus cost per job, times realistic jobs per week around school), legal-for-a-minor flags, safety, school fit.
5 PRICING: research what the market charges locally, then price the job not the age - no teen discounts, no caving to a frown. Trial price is announced as temporary while taking the money. A no means "not my customer", not "not good enough". Adjust on evidence (forty doors), never on discomfort (one frown).
6 PAID TRIAL: frame as a quest - "get five yeses by Sunday" at a small real price, never free. Close by giving a TRIAL KIT: venture in one line, trial price + the exact sentence, opening line word-for-word, what to record (the nos matter most), target + deadline, guardian step if under 16. Then say: come back here and tell me the number.
7 PITCH-BACK: when they return with a number, celebrate the milestone, then have them pitch you like a family friend lending $100: what it is, who pays and why you, costs + funding, weekly maths, proof. Offer to take it in writing or one point at a time. Respond as a friendly investor: strengths, probe 2-3 soft spots, score /5 with a named level (rough sketch / decent shot / sharp / investor-ready / take-my-money) + the one thing that levels them up. Invite the re-pitch.
8 PLAN: only after a pitch that holds together, tell them to hit the "Get my plan" button at the top of this chat for their printable Hustler Business Plan.
SAFETY: Under 16 - a parent or guardian gets checked in before anything starts; say it once, plainly, as a step. No age-restricted goods, no unlicensed public food sales, no unsafe or late-night solo work. You give learning and inspiration, not legal or financial advice - when permits, money or strangers come up, say to check local rules and loop in an adult. Failure is data: when an idea dies, name what it taught them. Call out milestones (first no, first paying customer, first repeat, first referral).`;

/** The one-page printable plan writer. */
export const PLAN_SYS = `You write the one-page "Hustler Business Plan" for a teen founder, based on the whole coaching conversation provided. Output ONLY an HTML fragment (no doctype, no markdown, no backticks) using h2, h3, p, ul, li, strong tags. Sections, in order:
<h2>1. The venture</h2> concept + what makes it different, two sentences in the teen's own spirit.
<h2>2. Customers and reach</h2> who exactly, how to reach the first ten (specific streets/spots from the chat) and the next fifty (referral ask, one visible billboard, repeat rhythm).
<h2>3. Money plan</h2> startup budget line by line, funding source, price list, weekly ledger habit, one simple target.
<h2>4. Operations</h2> schedule around school, quality checklist, who does what.
<h2>5. Rules and safety</h2> permits/permissions to verify locally, guardian touchpoints.
<h2>6. First two weeks</h2> day-by-day actions starting tomorrow.
<h2>7. The small print</h2> plain register: talk to an adult wherever money, strangers or contracts show up; get proper financial advice if real money gets involved; rules differ by region and change, check current local regulations before selling anything; this plan is for learning and inspiration only, not legal, financial, tax or professional advice, and its creators take no responsibility for business decisions made from it.
Use real numbers and place names from the conversation. Where something was never discussed, put a short bracketed prompt like [check your local market price]. Keep it tight - one page.`;

/**
 * Turn the visitor's device-detected location into a prompt note.
 *
 * The geo hint comes from the browser, so it is UNTRUSTED text that
 * ends up inside a system prompt — a textbook prompt-injection vector.
 * Everything here is defensive: strip line breaks so no new instruction
 * line can be forged, allow only plain place-name characters, then
 * hard-cap the length.
 */
const cleanPlace = (v) => String(v == null ? '' : v)
  .replace(/[\r\n]+/g, ' ')
  .replace(/[^\p{L}\p{N} ,.'-]/gu, '')
  .trim()
  .slice(0, 60);

export function geoNote(geo) {
  const country = cleanPlace(geo && geo.country);
  if (!country) return '';
  const city = cleanPlace(geo && geo.city);
  const region = cleanPlace(geo && geo.region);

  return '\nVISITOR CONTEXT (device-detected guess, confirm with them, never state it as fact): likely country '
    + country + (city ? ', near ' + city : '') + (region ? ' (' + region + ')' : '')
    + '. Use it to offer their likely cities/suburbs as tappable options when asking where they live.';
}

/**
 * Location note for the PLAN writer.
 *
 * The plan used to get NO location context at all — only whatever the
 * teen happened to type into the chat. That is why a São Paulo plan
 * could still come out with place names and money in the wrong shape.
 */
export function planGeoNote(geo) {
  const country = cleanPlace(geo && geo.country);
  if (!country) return '';
  const city = cleanPlace(geo && geo.city);
  return '\nLOCATION: the founder is in ' + (city ? city + ', ' : '') + country
    + '. Every place name, price, supplier and rule in the plan must fit that location.';
}

/**
 * Currency note, from the IP lookup's own `currency` field.
 *
 * Fixes the mixed "$80 saved … R$30 tune-up" output seen in testing:
 * the teen types "$80" meaning their local currency, and without an
 * explicit instruction the model keeps both symbols in one plan.
 *
 * Untrusted input, so the code is validated strictly — an ISO 4217
 * code is exactly three letters, which makes this easy to be strict
 * about. Anything else is dropped rather than passed into the prompt.
 */
export function currencyNote(geo) {
  const raw = String((geo && geo.currency) || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(raw)) return '';
  return '\nCURRENCY: use ' + raw + ' for EVERY money amount, with its normal local symbol. '
    + 'If the teen writes an amount with a different symbol (e.g. "$80"), treat it as ' + raw
    + ' and restate it in ' + raw + '. Never mix two currencies in one reply or one plan.';
}

/**
 * Server-side lookup: purpose -> prompt + output ceiling.
 * The ceiling is set HERE, not by the caller, so a client cannot ask
 * for an expensive generation. Adding a purpose? Give it both ceilings.
 *
 * ⚠️ WHY THERE ARE TWO CEILINGS
 * On a reasoning model the "thinking" tokens are drawn from the SAME
 * max_tokens budget as the answer. With reasoning_effort=high and the
 * old flat 800, live testing produced:
 *   - a turn that spent all 800 tokens thinking and returned an EMPTY
 *     reply (the user saw a blank chat bubble), and
 *   - a turn truncated mid-word.
 * So when reasoning is on, the budget has to cover the thinking AND
 * leave the original allowance for the visible answer.
 *
 * If you raise reasoning_effort to xhigh/max, raise these too.
 */
export const PURPOSES = {
  chat: { system: SYS, maxTokens: 800, reasoningMaxTokens: 2400 },
  plan: { system: PLAN_SYS, maxTokens: 3000, reasoningMaxTokens: 5000 },
};

/**
 * PLAN_SYS expects the whole coaching conversation as one user message.
 * Flattening happens on the SERVER so the browser only ever sends the
 * plain message list — one less shape a caller can play games with.
 */
export function buildPlanMessages(messages) {
  const convo = messages
    .map((m) => (m.role === 'user' ? 'TEEN: ' : 'SCOUT: ') + m.content)
    .join('\n\n');
  return [{ role: 'user', content: 'Here is the full coaching conversation. Write the plan.\n\n' + convo }];
}
