import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { requireServiceCaller } from "./requireServiceCaller.js";

const config = { audience: "https://render.example", allowedEmails: ["tasks@project.iam.gserviceaccount.com"] };

function app(verify: (token: string, audience: string) => Promise<{ email?: string; email_verified?: boolean }>) {
  const server = express();
  server.post("/tasks/render", requireServiceCaller(config, verify), (_req, res) => res.sendStatus(204));
  return server;
}

describe("requireServiceCaller", () => {
  it("rejects a missing header", async () => {
    expect((await request(app(async () => ({ email: config.allowedEmails[0], email_verified: true }))).post("/tasks/render")).status).toBe(401);
  });

  it("rejects a verification failure", async () => {
    expect((await request(app(async () => { throw new Error("bad token"); })).post("/tasks/render").set("Authorization", "Bearer token")).status).toBe(401);
  });

  it("rejects an unverified email", async () => {
    expect((await request(app(async () => ({ email: config.allowedEmails[0], email_verified: false }))).post("/tasks/render").set("Authorization", "Bearer token")).status).toBe(401);
  });

  it("rejects callers outside the allow list", async () => {
    expect((await request(app(async () => ({ email: "other@example.com", email_verified: true }))).post("/tasks/render").set("Authorization", "Bearer token")).status).toBe(401);
  });

  it("allows verified callers on the allow list", async () => {
    expect((await request(app(async () => ({ email: config.allowedEmails[0], email_verified: true }))).post("/tasks/render").set("Authorization", "Bearer token")).status).toBe(204);
  });
});
