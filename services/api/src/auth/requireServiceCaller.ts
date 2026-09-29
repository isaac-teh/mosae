import type { RequestHandler } from "express";
import { OAuth2Client } from "google-auth-library";

type Claims = { email?: string; email_verified?: boolean };
type Verify = (token: string, audience: string | string[]) => Promise<Claims>;

const client = new OAuth2Client();

const defaultVerify: Verify = async (token, audience) => {
  const ticket = await client.verifyIdToken({ idToken: token, audience });
  return ticket.getPayload() ?? {};
};

export function requireServiceCaller(
  config: { audience: string | string[]; allowedEmails: string[] },
  verify: Verify = defaultVerify,
): RequestHandler {
  return async (req, res, next) => {
    const match = /^Bearer (.+)$/.exec(req.header("authorization") ?? "");
    if (!match) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    try {
      const claims = await verify(match[1], config.audience);
      if (!claims.email_verified || !claims.email || !config.allowedEmails.includes(claims.email)) {
        res.status(401).json({ error: "unauthenticated" });
        return;
      }
      next();
    } catch {
      res.status(401).json({ error: "unauthenticated" });
    }
  };
}
