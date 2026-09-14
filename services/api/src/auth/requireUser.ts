import type { RequestHandler } from "express";
import { getAdminAuth } from "../firebase/admin.js";

type Verify = (token: string) => Promise<{ uid: string }>;

const defaultVerify: Verify = (token) => getAdminAuth().verifyIdToken(token);

export function requireUser(verify: Verify = defaultVerify): RequestHandler {
  return async (req, res, next) => {
    const header = req.header("authorization") ?? "";
    const match = /^Bearer (.+)$/.exec(header);
    if (!match) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    try {
      const { uid } = await verify(match[1]);
      res.locals.userId = uid;
      next();
    } catch {
      res.status(401).json({ error: "unauthenticated" });
    }
  };
}
