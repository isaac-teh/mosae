import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { requireUser } from "./requireUser.js";

function buildApp(verify: (token: string) => Promise<{ uid: string }>) {
  const app = express();
  app.get("/me", requireUser(verify), (_req, res) => {
    res.json({ userId: res.locals.userId });
  });
  return app;
}

describe("requireUser", () => {
  it("rejects requests without a bearer token", async () => {
    const verify = vi.fn();
    const res = await request(buildApp(verify)).get("/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthenticated" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("rejects tokens that fail verification", async () => {
    const res = await request(buildApp(() => Promise.reject(new Error("expired"))))
      .get("/me")
      .set("Authorization", "Bearer bad");
    expect(res.status).toBe(401);
  });

  it("exposes the verified uid", async () => {
    const verify = vi.fn().mockResolvedValue({ uid: "user-7" });
    const res = await request(buildApp(verify)).get("/me").set("Authorization", "Bearer good");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: "user-7" });
    expect(verify).toHaveBeenCalledWith("good");
  });
});
