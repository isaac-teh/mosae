import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { listeningServer } from "../test/listeningServer.js";
import { healthRouter } from "./health.js";

function buildApp(probe: () => Promise<{ ffmpeg: boolean; ffprobe: boolean; exiftool: boolean }>) {
  const app = express();
  app.use("/", healthRouter({ probe }));
  return app;
}

const all = async () => ({ ffmpeg: true, ffprobe: true, exiftool: true });

describe("GET /health", () => {
  it("reports ok when every media tool is present", async () => {
    const res = await request(await listeningServer(buildApp(all))).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", tools: { ffmpeg: true, ffprobe: true, exiftool: true } });
  });

  it("reports degraded with the missing tool named when one is absent", async () => {
    const res = await request(await listeningServer(buildApp(async () => ({ ffmpeg: false, ffprobe: true, exiftool: true })))).get("/health");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "degraded", tools: { ffmpeg: false } });
  });

  it("reports degraded rather than crashing when the probe itself throws", async () => {
    const res = await request(await listeningServer(buildApp(async () => { throw new Error("spawn failed"); }))).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
  });
});
