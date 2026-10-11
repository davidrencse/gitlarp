// Express handler type.
import type { RequestHandler } from 'express';

// Create per-IP rate-limit middleware: `limit` requests per `windowMs`.
export function rateLimit(limit: number, windowMs: number, now = Date.now): RequestHandler {
  // Counters by client IP with their reset time.
  const buckets = new Map<string, { count: number; reset: number }>();
  // Next time expired buckets are purged.
  let nextSweep = 0;
  // The middleware itself.
  return (req, res, next) => {
    // Current time (injectable for tests).
    const time = now();
    // Periodically sweep expired buckets so memory stays bounded.
    if (time >= nextSweep) {
      // Delete buckets whose window has ended.
      for (const [key, bucket] of buckets) if (bucket.reset <= time) buckets.delete(key);
      // Schedule the next sweep one window later.
      nextSweep = time + windowMs;
    }
    // Identify the client by IP.
    const key = req.ip || 'unknown';
    // Fetch this client's bucket.
    let bucket = buckets.get(key);
    // Start a new bucket when none exists or the window ended.
    if (!bucket || bucket.reset <= time) {
      // Refuse new clients when too many are tracked (memory protection).
      if (buckets.size >= 10_000 && !bucket) { res.status(503).json({ error: 'Request capacity reached. Try again shortly.' }); return; }
      // Create a bucket for this window.
      bucket = { count: 0, reset: time + windowMs }; buckets.set(key, bucket);
    }
    // Count this request.
    bucket.count++;
    // Over the limit: reject.
    if (bucket.count > limit) {
      // Seconds until the window resets.
      const retryAfter = Math.max(1, Math.ceil((bucket.reset - time) / 1000));
      // Reply 429 with a Retry-After header.
      res.set('Retry-After', String(retryAfter)).status(429).json({ error: 'Too many requests. Wait before trying again.', retryAfter }); return;
    }
    // Under the limit: continue to the next handler.
    next();
  };
}
