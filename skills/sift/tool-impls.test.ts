import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { SiftConfig } from "@sift/core";
import {
  toolList,
  toolNext,
  toolThreadCreate,
  toolThreadEntry,
  toolThreadState,
  toolThreadList,
  _setConfig,
  _clearConfig,
} from "./tool-impls.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES_DIR = join(__dirname, "../../packages/core/tests/fixtures/vault");

interface TestVault {
  path: string;
  cleanup: () => Promise<void>;
}

async function createTestVault(): Promise<TestVault> {
  const path = await mkdtemp(join(tmpdir(), "sift-mcp-test-"));
  await cp(FIXTURES_DIR, path, { recursive: true });
  return {
    path,
    cleanup: () => rm(path, { recursive: true, force: true }),
  };
}

function testConfig(vaultPath: string): SiftConfig {
  return {
    vaultPath,
    dailyNotesPath: "Daily Notes",
    dailyNotesFormat: "YYYY-MM-DD",
    excludeFolders: ["Templates"],
    projectsPath: "Projects",
    areasPath: "Areas",
    projectTemplatePath: "Templates/Project.md",
    areaTemplatePath: "Templates/Area.md",
  };
}

describe("toolList", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
    _setConfig(testConfig(vault.path));
  });

  afterEach(async () => {
    _clearConfig();
    await vault.cleanup();
  });

  it("returns formatted task list", async () => {
    const result = await toolList({});
    expect(result).toContain("Tasks");
    expect(result).toContain("First open task");
    expect(result).toContain("Second open task");
    // Should not include completed tasks by default
    expect(result).not.toContain("Completed task");
  });

  it("filters by search", async () => {
    const result = await toolList({ search: "First" });
    expect(result).toContain("First open task");
    expect(result).not.toContain("Second open task");
  });

  it("includes all statuses when all=true", async () => {
    const result = await toolList({ all: true });
    expect(result).toContain("Completed task");
    expect(result).toContain("Cancelled task");
  });

  it("includes file paths in output", async () => {
    const result = await toolList({});
    expect(result).toContain("Projects/Test Project.md");
  });
});

describe("toolNext", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
    _setConfig(testConfig(vault.path));
  });

  afterEach(async () => {
    _clearConfig();
    await vault.cleanup();
  });

  it("returns top tasks by urgency", async () => {
    const result = await toolNext({ count: 3 });
    expect(result).toContain("Up Next");
    // Should contain at least one task
    expect(result).toContain("○");
  });
});

describe("toolThreadCreate", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
    _setConfig(testConfig(vault.path));
  });

  afterEach(async () => {
    _clearConfig();
    await vault.cleanup();
  });

  it("creates a thread and returns confirmation", async () => {
    const result = await toolThreadCreate({
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob Martinez"],
      state: "waiting",
      followUp: "2026-05-12",
      content: "Sent initial proposal",
    });

    expect(result).toContain("✓ Created thread");
    expect(result).toContain("First open task");
    expect(result).toContain("[[Bob Martinez]]");
    expect(result).toContain("waiting");
    expect(result).toContain("2026-05-12");
    expect(result).toContain("Sent initial proposal");
  });

  it("returns error text when task already has a thread", async () => {
    await toolThreadCreate({
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob"],
    });

    await expect(
      toolThreadCreate({
        file: "Projects/Test Project.md",
        line: 14,
        counterparts: ["Alice"],
      }),
    ).rejects.toThrow("already has a thread");
  });
});

describe("toolThreadEntry", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
    _setConfig(testConfig(vault.path));
  });

  afterEach(async () => {
    _clearConfig();
    await vault.cleanup();
  });

  it("adds an entry and returns confirmation", async () => {
    await toolThreadCreate({
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob"],
      state: "active",
    });

    const result = await toolThreadEntry({
      file: "Projects/Test Project.md",
      line: 14,
      content: "Bob replied with feedback",
      state: "active",
    });

    expect(result).toContain("✓ Added entry");
    expect(result).toContain("Bob replied with feedback");
  });

  it("updates state when adding entry", async () => {
    await toolThreadCreate({
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob"],
      state: "active",
    });

    const result = await toolThreadEntry({
      file: "Projects/Test Project.md",
      line: 14,
      content: "Sent the mockup",
      state: "waiting",
      followUp: "2026-05-12",
    });

    expect(result).toContain("State: waiting");
    expect(result).toContain("Follow-up: 2026-05-12");
  });
});

describe("toolThreadState", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
    _setConfig(testConfig(vault.path));
  });

  afterEach(async () => {
    _clearConfig();
    await vault.cleanup();
  });

  it("updates state and returns confirmation", async () => {
    await toolThreadCreate({
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob"],
      state: "active",
    });

    const result = await toolThreadState({
      file: "Projects/Test Project.md",
      line: 14,
      state: "paused",
    });

    expect(result).toContain("✓ Updated thread");
    expect(result).toContain("State: paused");
  });

  it("updates counterparts", async () => {
    await toolThreadCreate({
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob"],
    });

    const result = await toolThreadState({
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Identity Team"],
    });

    expect(result).toContain("[[Identity Team]]");
  });
});

describe("toolThreadList", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
    _setConfig(testConfig(vault.path));
  });

  afterEach(async () => {
    _clearConfig();
    await vault.cleanup();
  });

  it("returns 'no threads' when none exist", async () => {
    const result = await toolThreadList({});
    expect(result).toContain("No threads found");
  });

  it("lists active threads after creating one", async () => {
    await toolThreadCreate({
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob"],
      state: "waiting",
      followUp: "2026-05-12",
      content: "Started discussion",
    });

    const result = await toolThreadList({});
    expect(result).toContain("First open task");
    expect(result).toContain("waiting on [[Bob]]");
    expect(result).toContain("follow-up: 2026-05-12");
  });

  it("filters by counterpart", async () => {
    await toolThreadCreate({
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob"],
      state: "active",
    });

    const noMatch = await toolThreadList({ counterpart: "Alice" });
    expect(noMatch).toContain("No threads found");

    const match = await toolThreadList({ counterpart: "Bob" });
    expect(match).toContain("First open task");
  });
});
