import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { requireServiceCaller } from "./requireServiceCaller.js";

const config = { audience: "https://api.example", allowedEmails: ["eventarc@proj.iam.gserviceaccount.com"] };

function app(verify: (t: string, a: string) => Promise<{ email?: string; email_verified?: boolean }>) {
  const a = express();
  a.post("/hook", requireServiceCaller(config, verify), (_req, res) => {
    res.sendStatus(204);
  });
  return a;
}

describe("requireServiceCaller", () => {
  it("accepts a verified token from an allowed service account", async () => {
    const res = await request(app(async (token, audience) => {
      expect([token, audience]).toEqual(["tok", "https://api.example"]);
      return { email: "eventarc@proj.iam.gserviceaccount.com", email_verified: true };
    }))
      .post("/hook")
      .set("Authorization", "Bearer tok");
    expect(res.status).toBe(204);
  });

  it("rejects missing tokens, unknown callers, and unverified emails", async () => {
    const ok = async () => ({ email: "eventarc@proj.iam.gserviceaccount.com", email_verified: true });
    expect((await request(app(ok)).post("/hook")).status).toBe(401);
    const other = async () => ({ email: "attacker@evil.com", email_verified: true });
    expect((await request(app(other)).post("/hook").set("Authorization", "Bearer t")).status).toBe(401);
    const unverified = async () => ({ email: "eventarc@proj.iam.gserviceaccount.com", email_verified: false });
    expect((await request(app(unverified)).post("/hook").set("Authorization", "Bearer t")).status).toBe(401);
    const throws = async () => Promise.reject(new Error("bad signature"));
    expect((await request(app(throws)).post("/hook").set("Authorization", "Bearer t")).status).toBe(401);
  });
});
