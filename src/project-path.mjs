import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";

export const PROJECT_PATH_REQUIRED_MESSAGE =
  "project_path is optional. Pass the absolute or relative path to the project root directory, or omit to use current working directory.";

export const projectPathSchema = z
  .string()
  .trim()
  .nullish()
  .transform((val) => val ?? "")
  .default("");

/**
 * Resolve project path to an absolute path.
 * If empty, null, or ".", defaults to cwd (process.cwd()).
 * If relative, resolves against cwd.
 *
 * @param {string|null|undefined} projectPath
 * @param {string} [cwd]
 * @returns {string}
 */
export function resolveProjectPath(projectPath, cwd = process.cwd()) {
  const trimmed = typeof projectPath === "string" ? projectPath.trim() : "";
  if (!trimmed || trimmed === "." || trimmed === "./" || trimmed === ".\\") {
    return cwd;
  }
  if (isAbsolute(trimmed)) {
    return trimmed;
  }
  return resolve(cwd, trimmed);
}

/**
 * Validate the project root path provided to fast_context_search.
 * Automatically resolves relative paths or empty/omitted paths against cwd.
 * Returns null when valid, otherwise an MCP-friendly error string.
 *
 * @param {string} projectPath
 * @param {(path: string) => import("node:fs").Stats} [statFn]
 * @param {string} [cwd]
 * @returns {string|null}
 */
export function validateProjectPath(projectPath, statFn = statSync, cwd = process.cwd()) {
  const resolved = resolveProjectPath(projectPath, cwd);

  try {
    const st = statFn(resolved);
    if (!st.isDirectory()) {
      return `Error: project_path is not a directory: ${resolved}`;
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      return `Error: project_path does not exist: ${resolved}`;
    }
    if (error?.code === "EACCES" || error?.code === "EPERM") {
      return `Error: cannot access project_path (${error.code}): ${resolved}`;
    }
    const reason = error?.message ? `${error.code || "UNKNOWN"}: ${error.message}` : String(error);
    return `Error: failed to validate project_path: ${reason}`;
  }

  return null;
}
