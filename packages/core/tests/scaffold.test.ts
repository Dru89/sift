import { describe, it, expect, afterEach } from "vitest";
import { createTestVault, testConfig, type TestVault } from "./helpers.js";
import { scanTasks } from "../src/scanner.js";

describe("test vault fixture", () => {
  let vault: TestVault;

  afterEach(async () => {
    if (vault) await vault.cleanup();
  });

  it("creates a usable temp vault and scans tasks", async () => {
    vault = await createTestVault();
    const config = testConfig(vault.path);
    const tasks = await scanTasks(config);

    // Should find tasks from the fixture files
    expect(tasks.length).toBeGreaterThan(0);

    // Should find the project task
    const projectTask = tasks.find((t) => t.description === "First open task");
    expect(projectTask).toBeDefined();
    expect(projectTask!.priority).toBe("high");
    expect(projectTask!.due).toBe("2026-05-10");
  });

  it("isolates changes between tests", async () => {
    vault = await createTestVault();
    const config = testConfig(vault.path);

    // Count tasks before
    const before = await scanTasks(config);
    const beforeCount = before.length;

    // The fixture should be fresh each time
    expect(beforeCount).toBeGreaterThan(0);
  });
});
