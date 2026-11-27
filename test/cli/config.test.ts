import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { configPath, credentialsFrom, maskKey, readConfig, saveConfig } from "../../src/config.ts";

const home = () => mkdtempSync(path.join(tmpdir(), "sc-home-"));

describe("config", () => {
  it("lives in ~/.socialcrawl/config.json, outside any project", () => {
    assert.equal(configPath("/h"), path.join("/h", ".socialcrawl", "config.json"));
  });

  it("saves and reads back, readable by the owner only where the OS allows it", () => {
    const h = home();
    saveConfig(h, { apiKey: "sc_Test_notarealkey6789" });
    assert.equal(readConfig(h).apiKey, "sc_Test_notarealkey6789");
    if (process.platform !== "win32") assert.equal(statSync(configPath(h)).mode & 0o777, 0o600);
  });

  it("keeps fields it was not given", () => {
    const h = home();
    saveConfig(h, { apiKey: "sc_a" });
    saveConfig(h, { installed: ["claude-code"] });
    const c = readConfig(h);
    assert.equal(c.apiKey, "sc_a");
    assert.deepEqual(c.installed, ["claude-code"]);
  });

  it("reads an absent or broken file as empty", () => {
    const h = home();
    assert.deepEqual(readConfig(h), {});
    mkdirSync(path.dirname(configPath(h)), { recursive: true });
    writeFileSync(configPath(h), "{not json");
    assert.deepEqual(readConfig(h), {});
  });

  it("leaves no temporary file behind", () => {
    const h = home();
    saveConfig(h, { apiKey: "sc_a" });
    assert.ok(!existsSync(configPath(h) + ".tmp"));
    assert.ok(readFileSync(configPath(h), "utf8").endsWith("\n"));
  });
});

describe("credentialsFrom", () => {
  it("prefers SOCIALCRAWL_API_KEY", () => {
    const c = credentialsFrom({ SOCIALCRAWL_API_KEY: " sc_env " }, { apiKey: "sc_file" });
    assert.deepEqual(c, { kind: "key", apiKey: "sc_env", source: "SOCIALCRAWL_API_KEY" });
  });
  it("then the saved key", () => {
    assert.deepEqual(credentialsFrom({}, { apiKey: "sc_file" }), { kind: "key", apiKey: "sc_file", source: "~/.socialcrawl/config.json" });
  });
  it("then a saved sign-in", () => {
    const c = credentialsFrom({}, { accessToken: "at", refreshToken: "rt", clientId: "cid" });
    assert.deepEqual(c, { kind: "token", accessToken: "at", refreshToken: "rt", clientId: "cid", source: "~/.socialcrawl/config.json" });
  });
  it("is null with nothing set", () => {
    assert.equal(credentialsFrom({}, {}), null);
  });
});

describe("maskKey", () => {
  it("shows the start and the last four only", () => {
    assert.equal(maskKey("sc_Test_notarealkey6789"), "sc_Test_…6789");
    assert.equal(maskKey("short"), "…");
  });
});
