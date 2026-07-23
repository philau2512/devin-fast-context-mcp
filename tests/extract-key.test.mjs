import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir, platform as osPlatform } from "node:os";
import { dirname, join, sep, win32 } from "node:path";
import initSqlJs from "sql.js";

import {
  getDbPathCandidates,
  getDbPath,
  getCliCredentialPathCandidates,
  getCredentialSources,
  extractApiKeyFromToml,
  extractKey,
} from "../src/extract-key.mjs";

/** Normalize path separators so assertions work on Windows. */
function asPosix(p) {
  return String(p).replaceAll("\\", "/");
}

function assertNoDeviv(paths) {
  for (const p of paths) {
    assert.ok(!asPosix(p).includes("/Deviv/"), `must not probe Deviv: ${p}`);
    assert.ok(!asPosix(p).includes("/deviv/"), `must not probe deviv: ${p}`);
  }
}

async function writeAuthDb(dbPath, apiKey) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
  db.run(
    "INSERT INTO ItemTable (key, value) VALUES (?, ?)",
    ["windsurfAuthStatus", JSON.stringify({ apiKey })],
  );
  writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
}

describe("getDbPathCandidates", () => {
  it("macOS: only Windsurf + Devin (no Deviv)", () => {
    const ps = getDbPathCandidates({ platform: "darwin", home: "/fakehome" }).map(asPosix);
    assert.equal(ps.length, 2);
    assert.equal(ps[0], "/fakehome/Library/Application Support/Windsurf/User/globalStorage/state.vscdb");
    assert.equal(ps[1], "/fakehome/Library/Application Support/Devin/User/globalStorage/state.vscdb");
    assertNoDeviv(ps);
  });

  it("Linux: Windsurf + devin + Devin (no Deviv)", () => {
    const ps = getDbPathCandidates({ platform: "linux", home: "/fakehome" }).map(asPosix);
    assert.equal(ps.length, 3);
    assert.equal(ps[0], "/fakehome/.config/Windsurf/User/globalStorage/state.vscdb");
    assert.equal(ps[1], "/fakehome/.config/devin/User/globalStorage/state.vscdb");
    assert.equal(ps[2], "/fakehome/.config/Devin/User/globalStorage/state.vscdb");
    assertNoDeviv(ps);
  });

  it("Linux: XDG_CONFIG_HOME wins over HOME", () => {
    const ps = getDbPathCandidates({
      platform: "linux",
      home: "/fakehome",
      xdgConfigHome: "/custom/xdg",
    }).map(asPosix);
    assert.ok(ps[0].startsWith("/custom/xdg/"));
    assert.ok(ps[0].includes("Windsurf"));
    assert.ok(ps[1].startsWith("/custom/xdg/"));
    assert.ok(ps[1].includes("devin"));
    assertNoDeviv(ps);
  });

  it("Windows: APPDATA returns only Windsurf + Devin with backslash paths", () => {
    const appdata = "C:\\Users\\fake\\AppData\\Roaming";
    const ps = getDbPathCandidates({ platform: "win32", appdata });
    assert.equal(ps.length, 2);
    assert.equal(ps[0], win32.join(appdata, "Windsurf", "User", "globalStorage", "state.vscdb"));
    assert.equal(ps[1], win32.join(appdata, "Devin", "User", "globalStorage", "state.vscdb"));
    // On win32 runtime, join uses backslash
    if (sep === "\\") {
      assert.ok(ps[0].includes("\\Windsurf\\"));
      assert.ok(ps[1].includes("\\Devin\\"));
    }
    assertNoDeviv(ps);
  });

  it("Windows: empty APPDATA throws", () => {
    assert.throws(
      () => getDbPathCandidates({ platform: "win32", appdata: "" }),
      /Cannot determine APPDATA path/,
    );
  });

  it("fallback to home/.config when Linux has no XDG", () => {
    const ps = getDbPathCandidates({ platform: "linux", home: "/h" }).map(asPosix);
    assert.equal(ps[0], "/h/.config/Windsurf/User/globalStorage/state.vscdb");
    assert.equal(ps[1], "/h/.config/devin/User/globalStorage/state.vscdb");
  });
});

describe("getDbPath (backward-compat)", () => {
  it("returns first candidate (legacy Windsurf) without probing existence", () => {
    const p = asPosix(getDbPath({ platform: "darwin", home: "/fakehome" }));
    assert.equal(p, "/fakehome/Library/Application Support/Windsurf/User/globalStorage/state.vscdb");
    assert.ok(p.includes("Windsurf"));
  });

  it("Linux also returns Windsurf first", () => {
    const p = asPosix(getDbPath({ platform: "linux", home: "/fakehome" }));
    assert.equal(p, "/fakehome/.config/Windsurf/User/globalStorage/state.vscdb");
  });

  it("Windows returns Windsurf under APPDATA first", () => {
    const p = getDbPath({ platform: "win32", appdata: "D:\\Roaming" });
    assert.equal(p, win32.join("D:\\Roaming", "Windsurf", "User", "globalStorage", "state.vscdb"));
  });
});

describe("CLI credentials (WSL/Linux)", () => {
  it("linux returns credentials.toml under .local/share/devin", () => {
    const ps = getCliCredentialPathCandidates({ platform: "linux", home: "/fakehome" }).map(asPosix);
    assert.deepEqual(ps, ["/fakehome/.local/share/devin/credentials.toml"]);
  });

  it("non-linux returns empty CLI candidates", () => {
    assert.deepEqual(getCliCredentialPathCandidates({ platform: "darwin", home: "/h" }), []);
    assert.deepEqual(getCliCredentialPathCandidates({ platform: "win32", home: "C:\\Users\\x" }), []);
  });

  it("getCredentialSources puts toml before sqlite on linux", () => {
    const sources = getCredentialSources({ platform: "linux", home: "/fakehome" });
    assert.equal(sources[0].type, "toml");
    assert.ok(asPosix(sources[0].path).endsWith("/.local/share/devin/credentials.toml"));
    assert.equal(sources[1].type, "sqlite");
  });

  it("Windows credential sources are sqlite-only Windsurf+Devin", () => {
    const sources = getCredentialSources({
      platform: "win32",
      appdata: "C:\\Users\\u\\AppData\\Roaming",
    });
    assert.equal(sources.length, 2);
    assert.ok(sources.every((s) => s.type === "sqlite"));
    assert.ok(sources[0].path.includes("Windsurf"));
    assert.ok(sources[1].path.includes("Devin"));
    assertNoDeviv(sources.map((s) => s.path));
  });

  it("extractApiKeyFromToml reads common field names and sk- fallback", () => {
    assert.equal(extractApiKeyFromToml('api_key = "sk-ws-01-abc"'), "sk-ws-01-abc");
    assert.equal(extractApiKeyFromToml("token = 'devin-session-token$eyJ.x'"), "devin-session-token$eyJ.x");
    assert.equal(extractApiKeyFromToml("noise\nsk-ws-01-from-body\n"), "sk-ws-01-from-body");
    assert.equal(extractApiKeyFromToml("empty = true"), "");
  });
});

describe("extractKey (auto-detect)", () => {
  let tmpRoot;

  before(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "fc-extract-key-test-"));
  });

  after(() => {
    if (tmpRoot && existsSync(tmpRoot)) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("lists all tried paths when nothing exists", async () => {
    const r = await extractKey(undefined, { platform: "darwin", home: tmpRoot });
    assert.ok(!r.api_key);
    assert.ok(r.error, "should return error");
    assert.ok(r.error.includes("Tried:"), "error should include 'Tried:'");
    assert.ok(r.error.includes("Windsurf"));
    assert.ok(r.error.includes("Devin"));
    assert.ok(!r.error.includes("Deviv"));
    assert.ok(Array.isArray(r.tried_paths) && r.tried_paths.length === 2);
    assert.ok(r.hint && /Windsurf|Devin|devin login/i.test(r.hint));
  });

  it("linux lists credentials.toml + .config/Windsurf + .config/devin", async () => {
    const r = await extractKey(undefined, { platform: "linux", home: tmpRoot });
    assert.ok(!r.api_key);
    assert.ok(r.error.includes("Tried:"));
    assert.ok(asPosix(r.error).includes(".local/share/devin/credentials.toml"));
    assert.ok(asPosix(r.error).includes(".config/Windsurf"));
    assert.ok(asPosix(r.error).includes(".config/devin"));
    assert.ok(!r.error.includes("Deviv"));
  });

  it("Windows lists only APPDATA\\Windsurf and APPDATA\\Devin", async () => {
    const appdata = join(tmpRoot, "Roaming-empty");
    mkdirSync(appdata, { recursive: true });
    const r = await extractKey(undefined, { platform: "win32", appdata });
    assert.ok(!r.api_key);
    assert.equal(r.tried_paths.length, 2);
    assert.ok(r.tried_paths[0].includes(`${sep}Windsurf${sep}`) || r.tried_paths[0].includes("/Windsurf/"));
    assert.ok(r.tried_paths[1].includes(`${sep}Devin${sep}`) || r.tried_paths[1].includes("/Devin/"));
    assertNoDeviv(r.tried_paths);
  });

  it("explicit dbPath does not walk auto candidates", async () => {
    const fakePath = join(tmpRoot, "no-such-db.vscdb");
    const r = await extractKey(fakePath);
    assert.ok(!r.api_key);
    assert.ok(r.error.includes("Windsurf / Devin database not found"));
    assert.equal(r.db_path, fakePath);
  });

  it("reads key from credentials.toml on linux", async () => {
    const home = join(tmpRoot, "toml-home");
    const tomlPath = join(home, ".local", "share", "devin", "credentials.toml");
    mkdirSync(dirname(tomlPath), { recursive: true });
    writeFileSync(tomlPath, 'api_key = "sk-ws-01-from-toml"\n', "utf8");

    const r = await extractKey(undefined, { platform: "linux", home });
    assert.equal(r.api_key, "sk-ws-01-from-toml");
    assert.equal(r.db_path, tomlPath);
    assert.equal(r.source_type, "devin_cli_credentials");
  });

  it("prefers devin-session-token over earlier legacy key across sources", async () => {
    const home = join(tmpRoot, "prefer-token-home");
    const tomlPath = join(home, ".local", "share", "devin", "credentials.toml");
    mkdirSync(dirname(tomlPath), { recursive: true });
    writeFileSync(tomlPath, 'api_key = "sk-ws-01-legacy-from-toml"\n', "utf8");

    const sqlitePath = join(home, ".config", "devin", "User", "globalStorage", "state.vscdb");
    await writeAuthDb(sqlitePath, "devin-session-token$eyJ.preferred.payload");

    const r = await extractKey(undefined, { platform: "linux", home });
    assert.equal(r.api_key, "devin-session-token$eyJ.preferred.payload");
    assert.equal(r.db_path, sqlitePath);
  });

  it("Windows: prefers Devin devin-session-token when both DBs exist", async () => {
    const appdata = join(tmpRoot, "win-appdata-current-token");
    const windsurfDb = join(appdata, "Windsurf", "User", "globalStorage", "state.vscdb");
    const devinDb = join(appdata, "Devin", "User", "globalStorage", "state.vscdb");
    await writeAuthDb(windsurfDb, "sk-ws-01-old-token");
    await writeAuthDb(devinDb, "devin-session-token$eyJ.current.payload");

    const r = await extractKey(undefined, { platform: "win32", appdata });

    assert.equal(r.api_key, "devin-session-token$eyJ.current.payload");
    assert.equal(r.db_path, devinDb);
    assert.equal(r.source_type, "sqlite");
  });

  it("Windows: prefers Windsurf preferred-token even when Devin has legacy key", async () => {
    const appdata = join(tmpRoot, "win-appdata-windsurf-preferred");
    const windsurfDb = join(appdata, "Windsurf", "User", "globalStorage", "state.vscdb");
    const devinDb = join(appdata, "Devin", "User", "globalStorage", "state.vscdb");
    await writeAuthDb(windsurfDb, "devin-session-token$eyJ.from.windsurf");
    await writeAuthDb(devinDb, "sk-ws-01-legacy-devin");

    const r = await extractKey(undefined, { platform: "win32", appdata });
    assert.equal(r.api_key, "devin-session-token$eyJ.from.windsurf");
    assert.equal(r.db_path, windsurfDb);
  });

  it("Windows: falls back to first usable key without devin-session-token", async () => {
    const appdata = join(tmpRoot, "win-appdata-legacy-token");
    const windsurfDb = join(appdata, "Windsurf", "User", "globalStorage", "state.vscdb");
    await writeAuthDb(windsurfDb, "sk-ws-01-legacy-token");

    const r = await extractKey(undefined, { platform: "win32", appdata });

    assert.equal(r.api_key, "sk-ws-01-legacy-token");
    assert.equal(r.db_path, windsurfDb);
  });

  it("Windows: only Devin DB present still works", async () => {
    const appdata = join(tmpRoot, "win-appdata-devin-only");
    const devinDb = join(appdata, "Devin", "User", "globalStorage", "state.vscdb");
    await writeAuthDb(devinDb, "devin-session-token$eyJ.devin.only");

    const r = await extractKey(undefined, { platform: "win32", appdata });
    assert.equal(r.api_key, "devin-session-token$eyJ.devin.only");
    assert.equal(r.db_path, devinDb);
  });

  it("Windows: corrupt DB then valid Devin falls back to usable key", async () => {
    const appdata = join(tmpRoot, "win-appdata-corrupt-first");
    const windsurfDb = join(appdata, "Windsurf", "User", "globalStorage", "state.vscdb");
    const devinDb = join(appdata, "Devin", "User", "globalStorage", "state.vscdb");
    mkdirSync(dirname(windsurfDb), { recursive: true });
    writeFileSync(windsurfDb, "not-a-sqlite-file", "utf8");
    await writeAuthDb(devinDb, "sk-ws-01-from-devin-after-corrupt");

    const r = await extractKey(undefined, { platform: "win32", appdata });
    assert.equal(r.api_key, "sk-ws-01-from-devin-after-corrupt");
    assert.equal(r.db_path, devinDb);
  });

  it("Windows: empty apiKey in Windsurf continues to Devin", async () => {
    const appdata = join(tmpRoot, "win-appdata-empty-key");
    const windsurfDb = join(appdata, "Windsurf", "User", "globalStorage", "state.vscdb");
    const devinDb = join(appdata, "Devin", "User", "globalStorage", "state.vscdb");
    await writeAuthDb(windsurfDb, "");
    await writeAuthDb(devinDb, "sk-ws-01-devin-ok");

    const r = await extractKey(undefined, { platform: "win32", appdata });
    assert.equal(r.api_key, "sk-ws-01-devin-ok");
    assert.equal(r.db_path, devinDb);
  });

  it("explicit .toml path on Windows-style path works", async () => {
    const tomlPath = join(tmpRoot, "creds.toml");
    writeFileSync(tomlPath, 'windsurf_api_key = "sk-ws-01-explicit-toml"\n', "utf8");
    const r = await extractKey(tomlPath);
    assert.equal(r.api_key, "sk-ws-01-explicit-toml");
    assert.equal(r.source_type, "devin_cli_credentials");
  });

  it("real env integration: extract from local Devin/Windsurf DB when installed", async (t) => {
    const appdata = process.env.APPDATA || "";
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const candidates = [
      appdata && join(appdata, "Devin", "User", "globalStorage", "state.vscdb"),
      appdata && join(appdata, "Windsurf", "User", "globalStorage", "state.vscdb"),
      join(home, "Library", "Application Support", "Devin", "User", "globalStorage", "state.vscdb"),
      join(home, "Library", "Application Support", "Windsurf", "User", "globalStorage", "state.vscdb"),
    ].filter(Boolean);

    if (!candidates.some((p) => existsSync(p))) {
      t.skip("local Devin/Windsurf DB is not installed");
      return;
    }
    const r = await extractKey();
    if (r.error) {
      assert.fail(`DB exists but api key extraction failed: ${r.error}`);
    }
    assert.ok(r.api_key, "should extract api_key");
    assert.ok(r.api_key.length > 20, "api_key length looks reasonable");
    assert.ok(
      asPosix(r.db_path).includes("/Devin/") || asPosix(r.db_path).includes("/Windsurf/"),
      `db_path should be Devin or Windsurf, got: ${r.db_path}`,
    );
    assert.ok(!asPosix(r.db_path).includes("/Deviv/"));
  });
});

describe("Windows host smoke (runs only on win32)", () => {
  it("native platform win32 candidates use real APPDATA shape", (t) => {
    if (osPlatform() !== "win32") {
      t.skip("not windows host");
      return;
    }
    assert.ok(process.env.APPDATA, "APPDATA should exist on Windows");
    const ps = getDbPathCandidates(); // real platform
    assert.equal(ps.length, 2);
    assert.equal(ps[0], join(process.env.APPDATA, "Windsurf", "User", "globalStorage", "state.vscdb"));
    assert.equal(ps[1], join(process.env.APPDATA, "Devin", "User", "globalStorage", "state.vscdb"));
    assert.ok(ps[0].includes("\\") || ps[0].includes("/"));
    assertNoDeviv(ps);
  });

  it("native createServer-style credential sources exclude Deviv and toml", (t) => {
    if (osPlatform() !== "win32") {
      t.skip("not windows host");
      return;
    }
    const sources = getCredentialSources();
    assert.ok(sources.length >= 2);
    assert.ok(sources.every((s) => s.type === "sqlite"));
    assertNoDeviv(sources.map((s) => s.path));
  });
});