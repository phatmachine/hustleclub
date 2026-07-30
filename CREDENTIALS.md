# Managing API credentials

Everything about which AI provider Hustle Club uses, and which key it uses, lives in **`.env`**. No key ever appears in `index.html`, in the page source, or in the Docker image.

**Verify any change with one command:**

```bash
npm run check
```

That resolves your config, calls the provider, tells you whether the key was accepted, and lists every model that key can reach.

---

## Quick start (Mistral)

1. Get a key at <https://console.mistral.ai/api-keys>.
2. ```bash
   cp .env.example .env
   ```
3. Put two lines in `.env`:
   ```
   LLM_PROVIDER=mistral
   MISTRAL_API_KEY=your-key-here
   ```
4. ```bash
   npm run check     # expect "✔ key accepted"
   npm start
   ```

---

## The two ways to supply a key

### Option A — the key in `.env` (simplest)

```
MISTRAL_API_KEY=abc123...
```

Fine for local work and small deployments. `.env` is in `.gitignore` and `.dockerignore`, so it is never committed and never baked into an image.

Caveat: with `docker compose`, `env_file:` copies `.env` into the container's environment at start-up, so editing it needs

```bash
docker compose up -d --force-recreate
```

### Option B — the key in a separate file (recommended for the VPS)

Point at a file that contains nothing but the key:

```
MISTRAL_API_KEY_FILE=/etc/hustleclub/mistral.key
```

Why this is better:

- The key lives **outside the repo and outside the image** — it cannot be committed or copied into a build by accident.
- It gets real filesystem permissions (`chmod 600`, owned by the app user).
- **It is re-read on every request. Rotating a key is one `echo` — no restart, no redeploy, no dropped conversations.**

Set it up:

```bash
sudo mkdir -p /etc/hustleclub
printf '%s' 'your-key-here' | sudo tee /etc/hustleclub/mistral.key > /dev/null
sudo chmod 600 /etc/hustleclub/mistral.key
```

`printf` rather than `echo` because a trailing newline makes the provider return a confusing 401. (The loader trims whitespace anyway, but the habit is worth keeping.)

With Docker, mount it in — `docker-compose.yml` has this wiring ready to uncomment:

```yaml
services:
  hustleclub:
    environment:
      MISTRAL_API_KEY_FILE: /run/secrets/mistral_api_key
    secrets:
      - mistral_api_key

secrets:
  mistral_api_key:
    file: /etc/hustleclub/mistral.key
```

A `*_API_KEY_FILE` always beats the plain `*_API_KEY` for the same provider, so you can leave both set while migrating.

---

## Rotating a key

**Option B (key file) — no downtime:**

```bash
printf '%s' 'new-key-here' | sudo tee /etc/hustleclub/mistral.key > /dev/null
curl -s localhost:3000/api/llm/status   # fingerprint should show the new key
```

The next chat message uses the new key. Nothing restarts.

**Option A (`.env`):** edit the value, then `npm start` again, or `docker compose up -d --force-recreate`.

---

## Switching provider

Change one line in `.env`, then `npm run check`:

```
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

| `LLM_PROVIDER` | Key variable | Where to get one |
| --- | --- | --- |
| `mistral` | `MISTRAL_API_KEY` | <https://console.mistral.ai/api-keys> |
| `openai` | `OPENAI_API_KEY` | <https://platform.openai.com/api-keys> |
| `groq` | `GROQ_API_KEY` | <https://console.groq.com/keys> |
| `openrouter` | `OPENROUTER_API_KEY` | <https://openrouter.ai/keys> |
| `anthropic` | `ANTHROPIC_API_KEY` | <https://console.anthropic.com/settings/keys> |
| `ollama` | *none* | runs locally |
| `custom` | `LLM_API_KEY` | any OpenAI-compatible endpoint, plus `LLM_BASE_URL` |

Leaving `LLM_PROVIDER` blank auto-detects: whichever provider has a key present wins, preferring Mistral. Handy for upgrades, but set it explicitly in production so a stray variable can't silently switch providers on you.

### A provider that isn't in the table

If it speaks the OpenAI chat-completions dialect (nearly all do), no code change is needed:

```
LLM_PROVIDER=custom
LLM_BASE_URL=https://api.theirservice.com/v1
LLM_API_KEY=your-key
LLM_MODEL=their-model-name
```

To give it a proper name and default model instead, add one entry to `PROVIDERS` in [llm-providers.js](llm-providers.js) — the file has a worked example at the top.

---

## Choosing a model

Leave `LLM_MODEL` blank to get the provider's default (Mistral: `mistral-medium-latest`). To see what your key can actually use:

```bash
npm run check
```

Then pin one:

```
LLM_MODEL=mistral-large-latest
```

For Mistral: `mistral-large-latest` is the sharpest, `mistral-medium-latest` is the balanced default, `mistral-small-latest` is the cheapest that still handles Scout's coaching prompt well.

---

## Checking what's live

| | |
| --- | --- |
| `npm run check` | Full verification from the command line. |
| `GET /api/llm/status` | Live config as JSON: provider, model, endpoint, which variable supplied the key, and a 4-character fingerprint. |
| `GET /api/llm/models` | Models the current key can reach. |

Neither route ever returns the key — only its source and fingerprint. The fingerprint is what confirms a rotation landed.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "Scout's not plugged in yet" | No key resolved | `npm run check` — it names the variables it looked at |
| `npm run check` says *key rejected (401)* | Key wrong, revoked, or has a stray newline | Re-issue it in the provider console; write it with `printf`, not `echo` |
| *Configured model was NOT in this key's model list* | Model name wrong, or your account lacks access | Pick one from the list `npm run check` printed |
| "Whoops, the line dropped" in chat | Provider returned an error | Check the server logs — every upstream failure is logged with the reason |
| Edited `.env` but nothing changed | Docker copied the old values at start-up | `docker compose up -d --force-recreate`, or move to Option B |
| Wrong provider being used | `LLM_PROVIDER` blank, another key present | Set `LLM_PROVIDER` explicitly |

---

## Where this is implemented

- [credentials.js](credentials.js) — the lookup order, the `.env` parser, secret-file reading and hot reload.
- [llm-providers.js](llm-providers.js) — one adapter per provider; add new ones here.
- [server.js](server.js) — the `/api/chat` proxy, the status routes and `--check`.

Each file opens with a comment block explaining its own contract.
