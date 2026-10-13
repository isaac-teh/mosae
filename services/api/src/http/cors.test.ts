import express from "express";
import request from "supertest";
import { listeningServer } from "../test/listeningServer.js";
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
    expect((await request(await listeningServer(app())).get("/api/ping").set("Origin", "https://web.example")).headers["access-control-allow-origin"]).toBe("https://web.example");
    expect((await request(await listeningServer(app())).get("/api/ping").set("Origin", "https://bad.example")).headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("answers allowed preflights", async () => {
    const res = await request(await listeningServer(app())).options("/api/ping").set("Origin", "https://web.example");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toBe("GET, POST, PUT, PATCH, DELETE, OPTIONS");
  });
  /**
   * Proposal constraints are revised with PATCH, by both the moment screens and
   * the character picker. Omitting it from the preflight fails the request in
   * the browser before it is ever sent, with no server-side trace.
   */
  it("permits the PATCH used to revise proposal constraints", async () => {
    const res = await request(await listeningServer(app())).options("/api/ping").set("Origin", "https://web.example");
    expect(res.headers["access-control-allow-methods"]).toContain("PATCH");
  });
  /** The Character Picker confirms the cast with PUT; the same silent failure applies. */
  it("permits the PUT used to confirm the cast", async () => {
    const res = await request(await listeningServer(app())).options("/api/ping").set("Origin", "https://web.example");
    expect(res.headers["access-control-allow-methods"]).toContain("PUT");
  });
  it("permits DELETE preflights used to remove a film", async () => {
    const res = await request(await listeningServer(app())).options("/api/ping").set("Origin", "https://web.example").set("Access-Control-Request-Method", "DELETE");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toContain("DELETE");
  });
  it("allows localhost only outside production and never applies to events", async () => {
    expect((await request(await listeningServer(app())).get("/api/ping").set("Origin", "http://localhost:3100")).headers["access-control-allow-origin"]).toBe("http://localhost:3100");
    expect((await request(await listeningServer(app(true))).get("/api/ping").set("Origin", "http://localhost:3100")).headers["access-control-allow-origin"]).toBeUndefined();
    expect((await request(await listeningServer(app())).get("/events/ping").set("Origin", "https://web.example")).headers["access-control-allow-origin"]).toBeUndefined();
  });
});
