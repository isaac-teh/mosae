import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { apiCors } from "./cors.js";

function app(production = false) {
  const server = express();
  server.use("/api", apiCors({ allowedOrigins: ["https://web.example"], production }));
  server.get("/api/ping", (_req, res) => res.json({ ok: true }));
  server.get("/events/ping", (_req, res) => res.json({ ok: true }));
  return server;
}

describe("apiCors", () => {
  it("allows configured origins and rejects other origins", async () => {
    expect((await request(app()).get("/api/ping").set("Origin", "https://web.example")).headers["access-control-allow-origin"]).toBe("https://web.example");
    expect((await request(app()).get("/api/ping").set("Origin", "https://bad.example")).headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("answers allowed preflights", async () => {
    const res = await request(app()).options("/api/ping").set("Origin", "https://web.example");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toBe("POST, GET, OPTIONS");
  });
  it("allows localhost only outside production and never applies to events", async () => {
    expect((await request(app()).get("/api/ping").set("Origin", "http://localhost:3100")).headers["access-control-allow-origin"]).toBe("http://localhost:3100");
    expect((await request(app(true)).get("/api/ping").set("Origin", "http://localhost:3100")).headers["access-control-allow-origin"]).toBeUndefined();
    expect((await request(app()).get("/events/ping").set("Origin", "https://web.example")).headers["access-control-allow-origin"]).toBeUndefined();
  });
});
