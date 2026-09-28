import type { RequestHandler } from "express";

export function apiCors(config: { allowedOrigins: string[]; production: boolean }): RequestHandler {
  return (req, res, next) => {
    const origin = req.header("Origin");
    const local = /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin ?? "");
    const allowed = Boolean(origin) && (config.allowedOrigins.includes(origin!) || (!config.production && local));
    if (allowed) {
      res.setHeader("Access-Control-Allow-Origin", origin!);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      // PATCH belongs here: proposal constraints are revised with it, both by
      // the moment screens and the character picker. Leaving it out makes the
      // preflight fail and the browser never sends the request at all.
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  };
}
