import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  projectPathSchema,
  resolveProjectPath,
  validateProjectPath,
} from "../src/project-path.mjs";

describe("project_path schema validation", () => {
  it("accepts empty string and defaults to empty", () => {
    const result = projectPathSchema.safeParse("");
    assert.equal(result.success, true);
    assert.equal(result.data, "");
  });

  it("accepts undefined and defaults to empty", () => {
    const result = projectPathSchema.safeParse(undefined);
    assert.equal(result.success, true);
    assert.equal(result.data, "");
  });

  it("accepts null and defaults to empty", () => {
    const result = projectPathSchema.safeParse(null);
    assert.equal(result.success, true);
    assert.equal(result.data, "");
  });

  it("accepts whitespace-only string and trims to empty", () => {
    const result = projectPathSchema.safeParse("   ");
    assert.equal(result.success, true);
    assert.equal(result.data, "");
  });

  it("accepts non-empty string", () => {
    const result = projectPathSchema.safeParse("/some/path");
    assert.equal(result.success, true);
    assert.equal(result.data, "/some/path");
  });

  it("trims leading/trailing whitespace", () => {
    const result = projectPathSchema.safeParse("  /some/path  ");
    assert.equal(result.success, true);
    assert.equal(result.data, "/some/path", "should trim whitespace");
  });

  it("accepts relative path", () => {
    const result = projectPathSchema.safeParse("./src");
    assert.equal(result.success, true);
    assert.equal(result.data, "./src");
  });
});

describe("resolveProjectPath", () => {
  it("defaults empty, null, undefined, or dot to cwd", () => {
    const cwd = "/fake/workspace/root";
    assert.equal(resolveProjectPath("", cwd), cwd);
    assert.equal(resolveProjectPath(null, cwd), cwd);
    assert.equal(resolveProjectPath(undefined, cwd), cwd);
    assert.equal(resolveProjectPath("  ", cwd), cwd);
    assert.equal(resolveProjectPath(".", cwd), cwd);
    assert.equal(resolveProjectPath("./", cwd), cwd);
  });

  it("returns absolute path as-is", () => {
    const cwd = "/fake/workspace/root";
    const absPath = join(tmpdir(), "fc-abs-path");
    assert.equal(resolveProjectPath(absPath, cwd), absPath);
  });

  it("resolves relative path against cwd", () => {
    const cwd = join(tmpdir(), "fc-workspace");
    const resolved = resolveProjectPath("packages/server", cwd);
    assert.equal(resolved, join(cwd, "packages/server"));
  });
});

describe("project_path runtime validation", () => {
  it("accepts empty project_path by resolving to valid cwd", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "fc-test-cwd-"));
    const err = validateProjectPath("", undefined, tempDir);
    assert.equal(err, null, "empty path resolving to valid cwd directory should pass");
  });

  it("accepts null project_path by resolving to valid cwd", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "fc-test-cwd-"));
    const err = validateProjectPath(null, undefined, tempDir);
    assert.equal(err, null, "null path resolving to valid cwd directory should pass");
  });

  it("accepts relative path that exists under cwd", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "fc-test-cwd-"));
    const subDir = join(tempDir, "src");
    mkdirSync(subDir);

    const err = validateProjectPath("./src", undefined, tempDir);
    assert.equal(err, null, "valid relative directory under cwd should pass validation");
  });

  it("rejects non-existent absolute path", () => {
    const err = validateProjectPath("/nonexistent/path/that/doesnt/exist/xyz123");
    assert.ok(err, "non-existent path should return an error");
    assert.match(err, /does not exist/i);
  });

  it("rejects relative path that does not exist under cwd", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "fc-test-cwd-"));
    const err = validateProjectPath("nonexistent-subdir", undefined, tempDir);
    assert.ok(err, "non-existent relative path should return an error");
    assert.match(err, /does not exist/i);
  });

  it("rejects path to a file (not directory)", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "fc-test-"));
    const tempFile = join(tempDir, "not-a-dir.txt");
    writeFileSync(tempFile, "test");

    const err = validateProjectPath(tempFile);
    assert.ok(err, "file path should return an error");
    assert.match(err, /not a directory/i);
  });

  it("accepts valid absolute directory path", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "fc-test-"));
    const err = validateProjectPath(tempDir);
    assert.equal(err, null, "valid directory should pass validation");
  });

  it("surfaces permission errors instead of reporting missing path", () => {
    const err = validateProjectPath("/restricted/path", () => {
      const error = new Error("permission denied");
      error.code = "EACCES";
      throw error;
    });
    assert.equal(err, "Error: cannot access project_path (EACCES): /restricted/path");
  });

  it("surfaces unexpected fs errors with the real reason", () => {
    const err = validateProjectPath("/broken/path", () => {
      const error = new Error("i/o failure");
      error.code = "EIO";
      throw error;
    });
    assert.equal(err, "Error: failed to validate project_path: EIO: i/o failure");
  });
});
