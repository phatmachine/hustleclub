# Handoff: Hustle Club — Teen Venture Landing Page

## Overview
Production domain: **https://hustleclub.app**

A single-page landing site for 14–18 year olds who want to start a small first business. The page IS the product: a Google-simple hero with one input that opens an on-page AI coaching chat ("Scout", driven by a detailed mentoring system prompt), a saved/resumable conversation, and a generated printable "Hustler Business Plan" once the teen has tested their idea with real customers.

**Scout is provider-agnostic.** Mistral is the default; OpenAI, Groq, OpenRouter, Anthropic, a local Ollama, or any OpenAI-compatible endpoint work by changing one line in `.env` — no code edits. See **[CREDENTIALS.md](CREDENTIALS.md)**.

## About the Design Files
The files in this bundle are **design references created in HTML** — a working prototype showing the intended look and behavior, not production code to ship as-is. The task is to **recreate this design in the target codebase's environment** (React/Next.js, Vue, etc.) using its established patterns — or, if no codebase exists yet, pick an appropriate framework and implement it there. That said, the prototype is fully functional and can be run locally for user testing right away (see below).

## Fidelity
**High-fidelity.** Colors, typography, spacing, copy, interactions and the full chat/plan logic are final-intent. Recreate pixel-perfectly.

## Running it locally

```bash
npm install
cp .env.example .env      # then add MISTRAL_API_KEY (or another provider's)
npm run check             # verifies the key works and lists available models
npm start                 # http://localhost:3000
```

`npm start` serves the page **and** the `/api/chat` proxy together — that is the supported way to run it. A plain static server (Live Server, `python3 -m http.server`) renders the page fine but nothing answers `/api/chat`, so Scout says "Scout's not plugged in yet."

Requires internet for Google Fonts, the AI provider, and the IP-geolocation lookup (`ipapi.co` — falls back to device timezone if blocked).

### AI provider and credentials

**No API key exists anywhere in the front-end.** `index.html` posts to `/api/chat`; `server.js` supplies the key from `.env` or from a secret file on disk. Anyone can view-source the page safely.

| | |
| --- | --- |
| Change provider / model / key | Edit `.env` — see **[CREDENTIALS.md](CREDENTIALS.md)** |
| Verify a change | `npm run check` |
| See what's live | `GET /api/llm/status` (reports a key *fingerprint*, never the key) |
| List usable models | `GET /api/llm/models` |

Supported out of the box: `mistral` (default), `openai`, `groq`, `openrouter`, `anthropic`, `ollama`, plus `custom` for any other OpenAI-compatible endpoint via `LLM_BASE_URL`.

Rotating a key with zero downtime: point `MISTRAL_API_KEY_FILE` at a file outside the repo. That file is re-read on every request, so overwriting it swaps the key with no restart and no redeploy.

Cost control: the browser cannot choose the model, the system prompt, or `max_tokens` — the server decides all three — and `/api/chat` is rate-limited per IP. See [SECURITY.md](SECURITY.md).

### Usage log

Every AI request appends one line to `logs/usage.log`:

```text
2026-07-30T07:57:16.638Z  event=chat  status=ok  region="New Zealand / Wellington"  tz="Pacific/Auckland"  visitor=ad45800f  provider=mistral  model=mistral-medium-latest  tokens=9/5  ms=105
```

```bash
tail -f logs/usage.log                        # watch live
grep -c 'event=plan' logs/usage.log           # plans generated
grep 'region="New Zealand' logs/usage.log     # usage by region
grep -o 'visitor=\w*' logs/usage.log | sort -u | wc -l   # unique visitors
```

`status=` is `ok`, `blocked-input`, `blocked-output`, `rate-limited`, `timeout` or `upstream-error` — so the log doubles as an abuse and reliability view. Rotates at 10 MB. Configure or disable it in `.env`.

Two deliberate privacy choices, because the audience is minors: **no conversation content is ever written**, and **IPs are hashed** into a short `visitor=` id rather than stored. See [SECURITY.md](SECURITY.md#privacy).

`region` is what the visitor's browser reported, so treat it as indicative, not authoritative.

### Security

`/api/chat` decides the system prompt, model and token budget server-side; the browser cannot override any of them. Guardrails, rate limits and plan sanitising are all enforced on the server. Read [SECURITY.md](SECURITY.md) before changing that endpoint, and run the regression suite:

```bash
npm test
```

### Where the LLM code lives

- [credentials.js](credentials.js) — key lookup order, `.env` parsing, secret files, hot reload.
- [llm-providers.js](llm-providers.js) — one adapter per provider. Adding a provider is one entry in the `PROVIDERS` map.
- [server.js](server.js) — the proxy, status routes, and `--check`.

Each opens with a comment block explaining its contract. Nothing outside these three files knows which AI vendor is in use.

### User-testing notes
- All state is in `localStorage`: `hustleclub_v1` (conversation), `hustleclub_first` (first-visit timestamp, drives the 24-hour "speed-runner" notice), `hustleclub_quota` (daily caps: 60 chat calls, 4 plan generations per device/day).
- To reset a test device: clear those three keys (or use the in-page "Start over").
- The three polaroid photo slots are drag-and-drop in the original design tool; locally, replace them with plain `<img>` tags or your own uploader (see Assets).

## Screens / Views

One page, one view, with three exclusive states in the hero area.

### 1. Header
- Max-width 1100px, centered, padding 22px 24px, flex space-between.
- Logo: 38px yellow circle (`--y`), 3px ink border, 3px 3px 0 ink hard shadow, containing "✶", slow 14s rotation; wordmark "HUSTLE CLUB" in Bungee 22px.
- Nav: "FAQ" and "The crew" anchor links, Space Grotesk 700 15px, ink color, 3px colored bottom borders (teal / pink).

### 2. Hero (default state)
- Centered column, max-width 900px, padding 40px 24px 30px.
- Floating "doodle" shapes (absolute, pointer-events none): teal circle, pink rotated square, purple ✶, yellow pill — all 3px ink borders, gentle 4–6s `bob` float animation. Toggleable via a `doodles` prop.
- Badge: purple pill (`--v`), white text, 3px ink border, 4px 4px 0 shadow, rotate(-2deg): "for 14–18 year olds with big plans".
- H1: Bungee, `clamp(38px, 7vw, 68px)`, line-height 1.05: "Turn your idea into **cold hard cash**" — the last words in a yellow highlight box (3px border, 5px 5px 0 shadow, rotate(-1.5deg)).
- Sub: Space Grotesk 19px, max-width 560px.
- **Search-style input** (the core CTA): white pill, 3px ink border, 6px 6px 0 shadow; input 18px, placeholder "Type your idea... or just say hi"; attached "GO" button in pink (`--p`), Bungee 18px, hover→purple. Enter key submits.
- Three starter chips below (white pills, 3px border, 3px 3px 0 shadow, hover→yellow + lift): "I've already got an idea", "Blank page, help me hunt", "I want money fast". Clicking sends that text as the first chat message.

### 3. Chat state (replaces the search box once started)
- Card max-width 720px, white, 3px ink border, radius 20px, 8px 8px 0 shadow.
- Header bar: teal (`--t`), 3px bottom border; ✶ avatar + "SCOUT" (Bungee 16px white, 2px 2px 0 ink text-shadow); right side: "Get my plan" (yellow, appears once ≥6 messages) and "Start over" (white, hover→pink) buttons.
- Message area: 440px tall, scrollable, ruled-paper background (`repeating-linear-gradient`, 27px rows, #F4EDE2 lines), 14px gap.
- Bubbles: 3px ink border, 3px 3px 0 shadow, 15px/1.45 text. User: purple bg, white text, right-aligned, radius 16/16/4/16. Scout: white bg, left-aligned, radius 16/16/16/4. Supports **bold** and "- " bullet lists.
- Typing indicator: white bubble with three 8px dots blinking (1.2s staggered).
- **Options panel** (when Scout's reply ends with an `OPTIONS: a | b | c` line): yellow band above the input, "PICK ONE" label (Bungee 12px, 1px letter-spacing), then full-width radio-style rows — white, 3px border, radius 12, 3px 3px 0 shadow, 18px radio circle with pink dot, 15px 700 label; hover→teal bg white text + 1px lift. **When options are shown the free-text input is hidden** — kids can only tap.
- Input row (free-text questions only): pill input + pink "SEND" (Bungee 14px). 50% opacity + pointer-events none while busy.

### 4. Three-step strip
Auto-fit grid (min 220px), white cards, 3px border, radius 16, 5px 5px 0 shadow. Big Bungee numeral (26px, pink/teal/purple) + Space Grotesk 700 15px label: "Chat it out with Scout" / "Go test your idea - sell to 10 people this week!" / "Come back, grab your PDF plan".

### 5. "Real kids. Real hustles." (photos)
H2 Bungee clamp(26–38px); sub 16px. Three polaroid cards (white, 3px border, 6px 6px 0 shadow, padding 12px, rotated -3° / 2° / -1.5°), each holding a 240×240 photo slot and a monospace 13px caption: "the mowing crew", "the ice-cream stall", "car detailing shine".

### 6. Benefits row
Auto-fit grid (min 240px), gap 22px; cards 3px border, radius 18, 6px 6px 0 shadow, padding 26px, alternating ±1° rotation:
- Yellow "$0 / Free to start" (ink text)
- Teal "ZIP / No sign-up needed" (white text, 2px 2px 0 ink text-shadow on headings)
- Pink "PDF / Hustler Business Plan" (white text, same shadow)
Big word: Bungee 30px; title Bungee 18px; body Space Grotesk 14px/1.5.

### 7. FAQ accordion
Max-width 720px. 5 items: white cards, 3px border, radius 16, 4px 4px 0 shadow. Question row: Space Grotesk 700 16px + pink Bungee "+"/"−" marker. One open at a time; answer 15px/1.55. Questions: money to start / parents / actually free / idea sucks / how to get the PDF.

### 8. Footer
3px top border, centered. "HUSTLE CLUB ✶" Bungee 18px + full small-print disclaimer paragraph (12.5px, 75% opacity): learning/inspiration only, not legal/financial advice, talk to an adult, check local regulations.

### 9. Plan modal
Fixed overlay `rgba(38,36,59,.55)`, centered card max-width 760px, max-height 88vh, 3px border, radius 18, 10px 10px 0 shadow. Yellow header: "YOUR HUSTLER BUSINESS PLAN" (Bungee 17px) + "Print / Save PDF" (pink), "Email it" (purple), "Close" (white) buttons. Scrollable body renders the AI-generated plan (h2 Bungee 22px, body 14px/1.55). If generated within 24h of first visit, a yellow "Whoa, speed-runner ⚡" encouragement card sits on top (access never blocked). Print uses a `@media print` visibility swap so only the plan prints.

## Interactions & Behavior
- **Chat flow**: user text/option-tap → appended to messages → POST to `/api/chat` with `{system, messages, max_tokens}` (system prompt + full history) → the server translates that into the configured provider's format → reply appended. On reply, the chat scrolls to the **top of the new message** (not the bottom). On user send, scrolls to bottom.
- **Options protocol**: the system prompt requires Scout to end every question with a final line `OPTIONS: a | b | c`; the client strips it from display and renders the radio rows for the latest message only. Special option labels: "Start over"/"start fresh" → reset flow; "Get my printable plan" → plan generation; "Try again" → retry last failed send.
- **Persistence / resume**: conversation saved to localStorage after every message. On revisit, chat restores and Scout locally appends: "Heads up: someone on this device already has a hustle in motion… Is that you?" with options *That's me — continue / I ran my trial / Get my printable plan / Someone else — start fresh*. Start-fresh confirms with "the business plan and trial already on this device get wiped for good."
- **Geo detection**: on load, guess country from device timezone, refine via `https://ipapi.co/json/` (4s abort). Passed to the model as a *guess to confirm*, used to offer city/suburb options.
- **Quotas**: 60 chat calls + 4 plan generations per device per day (localStorage, resets on date change). Cap hit → friendly "Scout's clocked off" message / alert. Plans are cached and only regenerated if the conversation has grown.
- **Plan generation**: full conversation sent with a dedicated system prompt that returns an HTML fragment (h2/h3/p/ul/li/strong, 7 fixed sections). Client strips script tags/inline handlers before injecting. "Email it" converts to plain text (1800-char cap) and opens `mailto:`.
- **Error state**: failed API call → "Whoops, the line dropped" + Try again option. Missing key → "Scout's not plugged in yet."
- Hover states throughout: background swap + `translate(-1px,-1px)` lift; active: shadow collapse + `translate(2px,2px)`.

## State Management
- `started` (bool) — hero search vs chat card
- `messages` — `[{role: 'user'|'assistant', content}]`, persisted
- `busy` — API in flight (typing dots, input disabled)
- `planHtml`, `planOpen`, `rushNote` (24h speed-runner flag)
- `faqOpen` — index of open FAQ item (-1 = none)
- Props/tweaks: `theme` (bubblegum | slime | sunshine — sets the CSS custom properties), `doodles` (bool)
- The two full system prompts (chat mentor + plan writer) live verbatim in the logic script of the .dc.html — **carry them over unchanged**; they encode the entire coaching methodology.

## Design Tokens
Colors (default "bubblegum" theme, as CSS vars on body):
- `--bg` #FFF7EE (warm cream) · `--ink` #26243B (near-black) · `--p` #FF5CA8 (pink) · `--t` #1FC8B7 (teal) · `--y` #FFD23F (yellow) · `--v` #7B5CFF (purple)
- Alt themes — slime: #F5FBEF / #1F2A24 / #55C85A / #21B8C7 / #C6F23F / #8E5CFF; sunshine: #FFF9E8 / #33261C / #FF7A3D / #2BA7D9 / #FFCF2E / #E0559B
- Chat paper line #F4EDE2; off-white panels #FFFDF8

Typography: **Bungee** (display/headings/buttons) + **Space Grotesk** 400/500/700 (everything else), both Google Fonts.
Borders: 3px solid ink everywhere. Shadows: hard offset, no blur — 2/3/4/5/6/8/10px `0 var(--ink)` by prominence. Radii: pills 999px, cards 16–20px, options 12px, plan buttons 10px. Rotations: ±1–3° on cards/badges. Animations: `bob` (float, 4–6s), `spin` (14s logo), `blink` (typing dots, 1.2s).

## Assets
- No image assets shipped — the three polaroid slots are user-fillable placeholders awaiting real photos of teens working (mowing, ice-cream stall, car detailing). Provide these in the production build.
- ✶ glyphs are plain text characters, not icons.
- Fonts from Google Fonts (Bungee, Space Grotesk).

## Files
- `Hustle Club Landing.dc.html` — the complete design: template markup, all styling (inline), both system prompts, and all logic (chat, geo, quotas, plan, print/email).
- `support.js` — prototype runtime that renders the .dc.html format. Not needed in the production recreation.
- `image-slot.js` — drag-and-drop photo placeholder component used by the prototype only; replace with real images in production.
- `.image-slots.state.json` — prototype sidecar for dropped photos; ignore in production.
