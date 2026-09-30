import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const checker = path.join(import.meta.dirname, "check-web-export.mjs");
const apiUrl = "https://mosae-api-648068325262.asia-southeast1.run.app";
const inertDependencyFallbacks = [
  'requestUri:"http://localhost",returnSecureToken:!0',
  'requestUri:"http://localhost",returnSecureToken:!0',
  "continueUri:M()?L():'http://localhost'",
  't=t||"http://localhost",u.scrollbars=\'yes\'',
  "hostname:'localhost',path:n,queryParams:{},scheme:'http'",
  '??"http://localhost:3000").hash',
  '`http://localhost:${window.remotion_proxyPort}/proxy?src=${encodeURIComponent',
  '`http://localhost:${window.remotion_proxyPort}/proxy?src=${encodeURIComponent',
].join("; ");

function checkBundle(js, expectedApiUrl = apiUrl) {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), "mosae-web-export-test-"));
  const exportDir = path.join(projectRoot, "dist");
  mkdirSync(exportDir);
  writeFileSync(path.join(exportDir, "bundle.js"), `${inertDependencyFallbacks}; ${js}`);
  const args = [checker, exportDir, projectRoot];
  if (expectedApiUrl !== undefined) args.push(expectedApiUrl);
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  rmSync(projectRoot, { recursive: true, force: true });
  return result;
}

test("accepts a clean bundle with the expected API and emulators disabled", () => {
  const result = checkBundle(`const api = "${apiUrl}"; const useEmulators = "false" === "true";`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Checked 1 exported files/);
});

test("rejects localhost references in exported JavaScript", () => {
  const result = checkBundle(`const api = "${apiUrl}"; const debug = "http://localhost:8081";`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /local|emulator|localhost/i);
});

test("rejects loopback addresses and emulator ports in exported JavaScript", () => {
  for (const endpoint of [
    "http://127.0.0.1:18080",
    "http://10.0.2.2:19091",
    "http://192.168.1.4:19192",
    "http://127.0.0.1:8085",
    "http://127.0.0.1:9099",
    "http://127.0.0.1:9199",
  ]) {
    const result = checkBundle(`const api = "${apiUrl}"; const bad = "${endpoint}";`);
    assert.notEqual(result.status, 0, `accepted ${endpoint}`);
  }
});

test("requires the expected production API URL in the exported JavaScript", () => {
  const result = checkBundle(`const api = "https://wrong-api.example.com";`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /expected API URL/i);
});

test("rejects an emulator flag inlined as true", () => {
  const result = checkBundle(`const api = "${apiUrl}"; const useEmulators = "true" === "true";`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /emulator/i);

  const minifiedResult = checkBundle(`const api = "${apiUrl}"; configureCore({useEmulators:!0});`);
  assert.notEqual(minifiedResult.status, 0);
  assert.match(minifiedResult.stderr, /emulator/i);
});
