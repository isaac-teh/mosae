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
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  };
}
