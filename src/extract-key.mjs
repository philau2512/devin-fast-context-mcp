/**
 * Windsurf / Devin API Key extraction from local installation.
 *
 * Cross-platform: macOS / Windows / Linux.
 * Uses sql.js (pure JS/WASM) to read state.vscdb — no native compilation needed.
 *
 * Lookup order (auto-detect):
 *   1) Devin CLI credentials.toml on Linux/WSL
 *   2) Windsurf / Devin state.vscdb candidates
 * Prefer keys that start with `devin-session-token$`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import initSqlJs from "sql.js";

const TOML_API_KEY_FIELDS = [
  "api_key",
  "apiKey",
  "devin_api_key",
  "devinApiKey",
  "windsurf_api_key",
  "windsurfApiKey",
  "access_token",
  "accessToken",
  "token",
];

/** Official app folder names only — Windsurf and Devin (never "Deviv"). */
const APP_NAMES_MAC_WIN = ["Windsurf", "Devin"];

/**
 * Resolve APPDATA with injectable override.
 * Explicit `deps.appdata` (including empty string) wins over process.env.
 * @param {Object} [deps]
 * @returns {string}
 */
function resolveAppdata(deps = {}) {
  if (Object.prototype.hasOwnProperty.call(deps, "appdata")) {
    return deps.appdata || "";
  }
  return process.env.APPDATA || "";
}

/**
 * Get all candidate paths to state.vscdb across Windsurf and Devin installs.
 *
 * Windsurf was succeeded by Devin (same team). DB schema is unchanged
 * (`ItemTable`, `windsurfAuthStatus`); only the app directory name differs.
 *
 * @param {Object} [deps]
 * @param {string} [deps.platform]
 * @param {string} [deps.home]
 * @param {string} [deps.xdgConfigHome]
 * @param {string} [deps.appdata]
 * @returns {string[]}
 */
export function getDbPathCandidates(deps = {}) {
  const plat = deps.platform ?? platform();
  const home = deps.home ?? homedir();
  const xdg = deps.xdgConfigHome ?? process.env.XDG_CONFIG_HOME;
  const out = [];

  if (plat === "darwin") {
    const appSupp = join(home, "Library", "Application Support");
    for (const appName of APP_NAMES_MAC_WIN) {
      out.push(join(appSupp, appName, "User", "globalStorage", "state.vscdb"));
    }
  } else if (plat === "win32") {
    const appdata = resolveAppdata(deps);
    if (!appdata) {
      throw new Error("Cannot determine APPDATA path");
    }
    for (const appName of APP_NAMES_MAC_WIN) {
      out.push(join(appdata, appName, "User", "globalStorage", "state.vscdb"));
    }
  } else {
    // Linux: Windsurf (Title Case) + devin (lowercase observed) + Devin (Title)
    const config = xdg || join(home, ".config");
    for (const appName of ["Windsurf", "devin", "Devin"]) {
      out.push(join(config, appName, "User", "globalStorage", "state.vscdb"));
    }
  }
  return out;
}

/**
 * Backward-compatible: return the first candidate (legacy Windsurf path).
 * @param {Object} [deps]
 * @returns {string}
 */
export function getDbPath(deps) {
  return getDbPathCandidates(deps)[0];
}

/**
 * Linux/WSL Devin CLI credential candidates.
 * @param {Object} [deps]
 * @param {string} [deps.platform]
 * @param {string} [deps.home]
 * @returns {string[]}
 */
export function getCliCredentialPathCandidates(deps = {}) {
  const plat = deps.platform ?? platform();
  const home = deps.home ?? homedir();
  if (plat !== "linux") return [];
  return [join(home, ".local", "share", "devin", "credentials.toml")];
}

/**
 * Credential sources in lookup order: CLI toml first, then SQLite DBs.
 * @param {Object} [deps]
 * @returns {{ type: "toml" | "sqlite", path: string }[]}
 */
export function getCredentialSources(deps = {}) {
  const tomlSources = getCliCredentialPathCandidates(deps).map((path) => ({
    type: "toml",
    path,
  }));
  const sqliteSources = getDbPathCandidates(deps).map((path) => ({
    type: "sqlite",
    path,
  }));
  return [...tomlSources, ...sqliteSources];
}

/**
 * Extract an API key from Devin CLI credentials.toml content.
 * @param {string} text
 * @returns {string}
 */
export function extractApiKeyFromToml(text) {
  for (const field of TOML_API_KEY_FIELDS) {
    const match = text.match(
      new RegExp(`^\\s*${field}\\s*=\\s*(?:"([^"]+)"|'([^']+)'|([^\\s#]+))`, "m"),
    );
    const value = (match?.[1] || match?.[2] || match?.[3] || "").trim();
    if (value) return value;
  }

  const fallback = text.match(/\bsk-[A-Za-z0-9_-]+\b/);
  return fallback ? fallback[0] : "";
}

/**
 * @param {string} key
 * @returns {boolean}
 */
function isPreferredApiKey(key) {
  return typeof key === "string" && key.startsWith("devin-session-token$");
}

/**
 * @param {string} credentialsPath
 * @returns {{ api_key?: string, db_path: string, source_type: string, error?: string, hint?: string }}
 */
function extractKeyFromToml(credentialsPath) {
  if (!existsSync(credentialsPath)) {
    return {
      error: `Devin CLI credentials not found: ${credentialsPath}`,
      hint: "Run `devin login` inside WSL/Linux, then retry.",
      db_path: credentialsPath,
      source_type: "devin_cli_credentials",
    };
  }

  let text;
  try {
    text = readFileSync(credentialsPath, "utf8");
  } catch (e) {
    return {
      error: `Failed to read Devin CLI credentials: ${e.message}`,
      db_path: credentialsPath,
      source_type: "devin_cli_credentials",
    };
  }

  const apiKey = extractApiKeyFromToml(text);
  if (!apiKey) {
    return {
      error: "Devin CLI credentials did not contain an API key",
      hint: "Run `devin login` inside WSL/Linux, then retry.",
      db_path: credentialsPath,
      source_type: "devin_cli_credentials",
    };
  }

  return {
    api_key: apiKey,
    db_path: credentialsPath,
    source_type: "devin_cli_credentials",
  };
}

/**
 * @param {string} dbPath
 * @returns {Promise<{ api_key?: string, db_path: string, source_type?: string, error?: string, hint?: string }>}
 */
async function readApiKeyFromDb(dbPath) {
  if (!existsSync(dbPath)) {
    return {
      error: `Windsurf / Devin database not found: ${dbPath}`,
      hint: "Ensure Windsurf or Devin is installed and logged in.",
      db_path: dbPath,
      source_type: "sqlite",
    };
  }

  let db;
  try {
    const SQL = await initSqlJs();
    const buf = readFileSync(dbPath);
    db = new SQL.Database(buf);
  } catch (e) {
    return {
      error: `Failed to open database: ${e.message}`,
      db_path: dbPath,
      source_type: "sqlite",
    };
  }

  try {
    const stmt = db.prepare("SELECT value FROM ItemTable WHERE key = 'windsurfAuthStatus'");
    if (!stmt.step()) {
      stmt.free();
      return {
        error: "windsurfAuthStatus record not found",
        hint: "Ensure Windsurf or Devin is logged in.",
        db_path: dbPath,
        source_type: "sqlite",
      };
    }

    const row = stmt.getAsObject();
    stmt.free();

    let data;
    try {
      data = JSON.parse(row.value);
    } catch {
      return {
        error: "windsurfAuthStatus data parse failed",
        db_path: dbPath,
        source_type: "sqlite",
      };
    }

    const apiKey = data.apiKey || "";
    if (!apiKey) {
      return {
        error: "apiKey field is empty",
        db_path: dbPath,
        source_type: "sqlite",
      };
    }

    return {
      api_key: apiKey,
      db_path: dbPath,
      source_type: "sqlite",
    };
  } catch (e) {
    return {
      error: `Extraction failed: ${e.message}`,
      db_path: dbPath,
      source_type: "sqlite",
    };
  } finally {
    db.close();
  }
}

/**
 * Extract API Key from Windsurf / Devin credential sources.
 *
 * Auto-detect scans CLI toml (Linux/WSL) then SQLite candidates and prefers
 * `devin-session-token$` keys. Explicit `dbPath` skips auto order
 * (`.toml` → toml reader, otherwise SQLite).
 *
 * @param {string} [dbPath]
 * @param {Object} [deps]
 * @returns {Promise<{ api_key?: string, db_path: string, source_type?: string, error?: string, hint?: string, tried_paths?: string[] }>}
 */
export async function extractKey(dbPath, deps) {
  // Explicit path: always hit that source (even if missing) for precise errors.
  if (dbPath) {
    const type = dbPath.endsWith(".toml") ? "toml" : "sqlite";
    const result =
      type === "toml" ? extractKeyFromToml(dbPath) : await readApiKeyFromDb(dbPath);
    return { ...result, tried_paths: [dbPath] };
  }

  const sources = getCredentialSources(deps);
  const tried_paths = sources.map((s) => s.path);
  const existing = sources.filter((s) => existsSync(s.path));

  if (!existing.length) {
    return {
      error: `Windsurf / Devin credential source not found. Tried:\n${tried_paths.map((p) => `  - ${p}`).join("\n")}`,
      hint: "Ensure Windsurf/Devin is installed and logged in, or run `devin login` on Linux/WSL.",
      db_path: sources[0]?.path || "",
      tried_paths,
    };
  }

  let firstUsable = null;
  const failures = [];

  for (const source of existing) {
    const result =
      source.type === "toml"
        ? extractKeyFromToml(source.path)
        : await readApiKeyFromDb(source.path);

    if (result.api_key) {
      if (isPreferredApiKey(result.api_key)) {
        return { ...result, tried_paths };
      }
      if (!firstUsable) firstUsable = result;
    } else {
      failures.push(result);
    }
  }

  if (firstUsable) return { ...firstUsable, tried_paths };

  return {
    error: `No usable apiKey found. Tried:\n${failures.map((r) => `  - ${r.db_path}: ${r.error}`).join("\n")}`,
    hint: "Ensure Windsurf/Devin is logged in, or run `devin login` on Linux/WSL.",
    db_path: existing[0]?.path || sources[0]?.path || "",
    tried_paths,
  };
}