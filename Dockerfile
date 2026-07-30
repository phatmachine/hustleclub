# Node 24 = the Active LTS line as of mid-2026. Node 20 (the previous
# base here) left its maintenance window in April 2026 and no longer
# gets security patches, so do not go back. Node 26 is still "Current"
# — it is not an LTS until October 2026, so it does not belong in
# production yet.
#
# Intentionally tracking the MAJOR tag, not a pinned patch: a rebuild
# then picks up base-image security fixes automatically. package-lock
# still pins the app's own dependencies exactly (npm ci below).
#
# Base images always carry some unfixed OS-level CVEs. Re-scan after
# building — `docker scout cves hustleclub` — and rebuild periodically
# so patches actually land.
FROM node:24-alpine

WORKDIR /app

# Dependencies first so a code change doesn't re-run npm install.
COPY package*.json ./
# `npm ci` installs exactly what package-lock.json pins, so a build
# cannot silently pull a newer (or compromised) transitive dependency.
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# The usage log is written at runtime; make sure the unprivileged user
# owns the directory before we drop root.
RUN mkdir -p /app/logs && chown -R node:node /app/logs

# Drop root. Without this the app runs as uid 0 inside the container,
# so any code-execution bug starts with root in that namespace.
USER node

EXPOSE 3000
CMD ["node", "server.js"]
