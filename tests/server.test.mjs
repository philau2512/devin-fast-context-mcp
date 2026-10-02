import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import pkg from "../package.json" with { type: "json" };
import {
  SERVER_VERSION,
  buildExtractWindsurfKeyTool,
  buildFastContextSearchTool,
  createServer,
  isDirectRun,
  readRuntimeConfig,
} from "../src/server.mjs";

describe("server metadata", () => {
  it("uses package.json as the MCP server version source", () => {
    assert.equal(SERVER_VERSION, pkg.version);
  });

  it("treats npm bin symlinks as direct execution", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "fc-server-bin-"));
    const realServerPath = resolve("src/server.mjs");
    const binLinkPath = join(tempDir, "fast-context-mcp");
    symlinkSync(realServerPath, binLinkPath);

    assert.equal(isDirectRun(binLinkPath), true);
  });

  it("has a local development bin link for npx self-resolution", () => {
    // postinstall creates this; tolerate missing link on some Windows setups
    const binPath = resolve("node_modules/.bin/fast-context-mcp");
    const binCmd = resolve("node_modules/.bin/fast-context-mcp.cmd");
    assert.equal(existsSync(binPath) || existsSync(binCmd), true);
  });
});

describe("runtime config hide extract tool", () => {
  it("defaults hideExtractWindsurfKeyTool to false", () => {
    assert.equal(readRuntimeConfig({}).hideExtractWindsurfKeyTool, false);
  });

  it("parses FC_HIDE_EXTRACT_WINDSURF_KEY_TOOL", () => {
    assert.equal(
      readRuntimeConfig({ FC_HIDE_EXTRACT_WINDSURF_KEY_TOOL: "1" }).hideExtractWindsurfKeyTool,
      true,
    );
    assert.equal(
      readRuntimeConfig({ FC_HIDE_EXTRACT_WINDSURF_KEY_TOOL: "false" }).hideExtractWindsurfKeyTool,
      false,
    );
  });

  it("registers extract_windsurf_key by default", () => {
    const server = createServer({ config: readRuntimeConfig({}) });
    assert.ok(server._registeredTools.extract_windsurf_key);
    assert.ok(server._registeredTools.fast_context_search);
  });

  it("omits extract_windsurf_key when hide flag is set", () => {
    const server = createServer({
      config: {
        ...readRuntimeConfig({}),
        hideExtractWindsurfKeyTool: true,
      },
    });
    assert.equal(server._registeredTools.extract_windsurf_key, undefined);
    assert.ok(server._registeredTools.fast_context_search);
  });
});

describe("extract_windsurf_key tool", () => {
  it("includes tried_paths on extraction failure", async () => {
    const tool = buildExtractWindsurfKeyTool({
      deps: {
        extractKeyInfo: async () => ({
          error: "not found",
          hint: "login first",
          db_path: "/tmp/a",
          tried_paths: ["/tmp/a", "/tmp/b"],
        }),
      },
    });

    const response = await tool.handler();
    const text = response.content[0].text;
    assert.match(text, /Error: not found/);
    assert.match(text, /Tried paths:/);
    assert.match(text, /\/tmp\/a/);
    assert.match(text, /\/tmp\/b/);
  });
});

describe("fast_context_search tool schema", () => {
  it("exposes only task-level parameters", () => {
    const tool = buildFastContextSearchTool({
      config: readRuntimeConfig({}),
    });

    assert.deepEqual(Object.keys(tool.schema), [
      "query",
      "project_path",
      "tree_depth",
      "max_turns",
      "max_results",
      "exclude_paths",
      "include_code_snippets",
    ]);
  });

  it("uses env-derived defaults for public task-level defaults", () => {
    const tool = buildFastContextSearchTool({
      config: readRuntimeConfig({
        FC_MAX_TURNS: "4",
        FC_INCLUDE_SNIPPETS: "true",
      }),
    });

    assert.equal(tool.schema.max_turns._def.defaultValue(), 4);
    assert.equal(tool.schema.include_code_snippets._def.defaultValue(), true);
    assert.match(tool.description, /Server-configured default is true/);
  });

  it("recommends English queries for semantic search quality", () => {
    const tool = buildFastContextSearchTool({
      config: readRuntimeConfig({}),
    });

    assert.match(tool.description, /primarily in English/);
    assert.match(tool.schema.query.description, /English is recommended/);
  });
});

describe("fast_context_search handler", () => {
  it("passes server strategy config explicitly to searchWithContent", async () => {
    let capturedArgs = null;
    const config = readRuntimeConfig({
      FC_MAX_COMMANDS: "12",
      FC_TIMEOUT_MS: "45000",
      FC_REPO_MAP_MODE: "classic",
      FC_BOOTSTRAP_TREE_DEPTH: "3",
      FC_HOTSPOT_TOP_K: "7",
      FC_HOTSPOT_TREE_DEPTH: "4",
      FC_HOTSPOT_MAX_BYTES: "200000",
      FC_BOOTSTRAP_ENABLED: "false",
      FC_BOOTSTRAP_MAX_TURNS: "3",
      FC_BOOTSTRAP_MAX_COMMANDS: "8",
    });
    const tool = buildFastContextSearchTool({
      config,
      deps: {
        validateProjectPath: () => null,
        searchWithContent: async (args) => {
          capturedArgs = args;
          return "ok";
        },
      },
    });

    const response = await tool.handler({
      query: "where is auth handled",
      project_path: "/tmp/project",
      tree_depth: 2,
      max_turns: 4,
      max_results: 9,
      exclude_paths: ["dist"],
      include_code_snippets: true,
    });

    assert.deepEqual(response, { content: [{ type: "text", text: "ok" }] });
    assert.deepEqual(capturedArgs, {
      query: "where is auth handled",
      projectRoot: "/tmp/project",
      maxTurns: 4,
      maxCommands: 12,
      maxResults: 9,
      treeDepth: 2,
      timeoutMs: 45000,
      excludePaths: ["dist"],
      repoMapMode: "classic",
      bootstrapTreeDepth: 3,
      hotspotTopK: 7,
      hotspotTreeDepth: 4,
      hotspotMaxBytes: 200000,
      bootstrapEnabled: false,
      bootstrapMaxTurns: 3,
      bootstrapMaxCommands: 8,
      includeSnippets: true,
    });
  });

  it("returns validation errors before running search", async () => {
    let searchCalled = false;
    const tool = buildFastContextSearchTool({
      config: readRuntimeConfig({}),
      deps: {
        validateProjectPath: () => "bad project_path",
        searchWithContent: async () => {
          searchCalled = true;
          return "should not run";
        },
      },
    });

    const response = await tool.handler({
      query: "x",
      project_path: "relative",
      tree_depth: 1,
      max_turns: 1,
      max_results: 1,
      exclude_paths: [],
      include_code_snippets: false,
    });

    assert.equal(searchCalled, false);
    assert.deepEqual(response, { content: [{ type: "text", text: "bad project_path" }] });
  });
});