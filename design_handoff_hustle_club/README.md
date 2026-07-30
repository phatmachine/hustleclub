# Handoff: Hustle Club — Teen Venture Landing Page

## Overview
Production domain: **https://hustleclub.app**

A single-page landing site for 14–18 year olds who want to start a small first business. The page IS the product: a Google-simple hero with one input that opens an on-page AI coaching chat ("Scout", powered by the Anthropic API with a detailed mentoring system prompt), a saved/resumable conversation, and a generated printable "Hustler Business Plan" once the teen has run a real-world trial week.

## About the Design Files
The files in this bundle are **design references created in HTML** — a working prototype showing the intended look and behavior, not production code to ship as-is. The task is to **recreate this design in the target codebase's environment** (React/Next.js, Vue, etc.) using its established patterns — or, if no codebase exists yet, pick an appropriate framework and implement it there. That said, the prototype is fully functional and can be run locally for user testing right away (see below).

## Fidelity
**High-fidelity.** Colors, typography, spacing, copy, interactions and the full chat/plan logic are final-intent. Recreate pixel-perfectly.

## Running the prototype locally (for user testing)

1. Keep all four files in one folder (`Hustle Club Landing.dc.html`, `support.js`, `image-slot.js`, `.image-slots.state.json`).
2. Serve over HTTP — don't open via `file://` (module/fetch restrictions). Either:
   - VS Code: install the **Live Server** extension → right-click the .dc.html → "Open with Live Server", or
   - Terminal: `python3 -m http.server 8000` then open `http://localhost:8000/Hustle%20Club%20Landing.dc.html`
3. **Enable the AI planner**: open the .dc.html, find the `DEPLOYMENT CONFIG` block inside the `<script data-dc-script>` section and paste an Anthropic API key into `API_KEY = ''`. Without it, the page renders fully but chat replies say "Scout's not plugged in yet."
   - ⚠️ A key in page code is visible to anyone who views source. Fine for private user testing. For any public deployment, host a tiny server proxy that holds the key and set `API_URL` to the proxy instead (see below).
4. Requires internet for Google Fonts, the Anthropic API, and the IP-geolocation lookup (`ipapi.co` — falls back to device timezone if blocked).

### Minimal proxy for public deployment (Node/Express)
```js
import express from 'express';
const app = express();
app.use(express.json());
app.post('/api/chat', async (req, res) => {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify(req.body)
  });
  res.status(r.status).json(await r.json());
});
app.listen(3000);
```
Then set `API_URL = '/api/chat'` and leave `API_KEY` empty. Add rate limiting per IP on the proxy for real cost control (the in-page daily quota is localStorage-based and trivially resettable).

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
Auto-fit grid (min 220px), white cards, 3px border, radius 16, 5px 5px 0 shadow. Big Bungee numeral (26px, pink/teal/purple) + Space Grotesk 700 15px label: "Chat it out with Scout" / "Run your trial week for real" / "Come back, grab your PDF plan".

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
- **Chat flow**: user text/option-tap → appended to messages → POST to Anthropic Messages API (system prompt + full history) → reply appended. On reply, the chat scrolls to the **top of the new message** (not the bottom). On user send, scrolls to bottom.
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
