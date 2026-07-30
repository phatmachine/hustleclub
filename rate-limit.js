// ============================================================
// HUSTLE CLUB — RATE LIMITING
// /api/chat spends real money on every call. Before this existed the
// endpoint was open: 30 rapid unauthenticated requests were accepted
// 30/30, each one billed to the owner's API key. The in-page quota
// (60 chats / 4 plans a day) lives in localStorage and is reset by
// clearing site data, so it is a UX guard, not a cost control.
//
// Two independent ceilings per visitor IP:
//   BURST — short window, stops a hammering script dead.
//   DAILY — long window, caps what one visitor can cost in a day.
//
// Deliberately in-memory: no Redis, no new dependency, and the counters
// reset on restart. That is the right trade for a single-container app.
// If you ever run more than one replica, each gets its own allowance —
// move to a shared store at that point.
//
// ⚠️ BEHIND A REVERSE PROXY (nginx, Caddy, Cloudflare, Hostinger's
// front end) every request appears to come from the proxy, so ONE
// bucket would be shared by all visitors. Set TRUST_PROXY=true so
// Express reads X-Forwarded-For. Only enable it when a proxy really is
// in front — otherwise a client can spoof that header and dodge limits.
// ============================================================

/**
 * Fixed-window counter keyed by IP.
 * @param {{windowMs:number, max:number, name:string}} opts
 */
export function createLimiter({ windowMs, max, name }) {
  const hits = new Map(); // ip -> { count, resetAt }

  // Stale entries would otherwise grow without bound — a slow memory
  // leak and, with enough unique IPs, a DoS in its own right.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of hits) if (rec.resetAt <= now) hits.delete(ip);
  }, Math.min(windowMs, 60_000));
  if (sweep.unref) sweep.unref(); // never hold the process open

  return {
    name,
    max,
    /**
     * Count one request.
     * @returns {{allowed:boolean, remaining:number, retryAfterSec:number}}
     */
    take(ip) {
      const now = Date.now();
      let rec = hits.get(ip);
      if (!rec || rec.resetAt <= now) {
        rec = { count: 0, resetAt: now + windowMs };
        hits.set(ip, rec);
      }
      rec.count += 1;
      const allowed = rec.count <= max;
      return {
        allowed,
        remaining: Math.max(0, max - rec.count),
        retryAfterSec: Math.ceil((rec.resetAt - now) / 1000),
      };
    },
    size: () => hits.size,
  };
}

/**
 * Client IP for rate-limiting purposes.
 *
 * With `app.set('trust proxy', …)` configured, Express has already
 * resolved req.ip from X-Forwarded-For. Without it, req.ip is the
 * socket address — which is what we want when no proxy is present.
 */
export function clientIp(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}
