import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestVault, testConfig, type TestVault } from "./helpers.js";
import { promoteTask } from "../src/writer.js";
import { createThread } from "../src/thread-writer.js";
import { parseContent } from "../src/parser.js";

describe("promoteTask", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
  });

  afterEach(async () => {
    await vault.cleanup();
  });

  it("creates a project from a task and moves the task into it", async () => {
    const config = testConfig(vault.path);
    const result = await promoteTask(config, {
      file: "Projects/Test Project.md",
      line: 14,
    });

    expect(result.task).toBe("First open task");
    expect(result.projectName).toBe("First open task");
    expect(result.projectFile).toBe("Projects/First open task.md");
    expect(result.hadThread).toBe(false);

    // Verify the new project file exists and has the task
    const projectContent = await readFile(join(vault.path, result.projectFile), "utf-8");
    const projectTasks = parseContent(projectContent, result.projectFile);
    expect(projectTasks.some((t) => t.description === "First open task")).toBe(true);

    // Verify the task was removed from the source
    const sourceContent = await readFile(join(vault.path, "Projects/Test Project.md"), "utf-8");
    const sourceTasks = parseContent(sourceContent, "Projects/Test Project.md");
    expect(sourceTasks.some((t) => t.description === "First open task")).toBe(false);
  });

  it("uses custom name for the project", async () => {
    const config = testConfig(vault.path);
    const result = await promoteTask(config, {
      file: "Projects/Test Project.md",
      line: 14,
      name: "Redesign login page",
    });

    expect(result.projectName).toBe("Redesign login page");
    expect(result.projectFile).toBe("Projects/Redesign login page.md");
  });

  it("preserves thread when promoting", async () => {
    const config = testConfig(vault.path);

    // First create a thread on the task
    await createThread(config, {
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob Martinez"],
      state: "waiting",
      followUp: "2026-05-12",
      content: "Sent initial proposal",
    });

    // Now promote
    const result = await promoteTask(config, {
      file: "Projects/Test Project.md",
      line: 14,
    });

    expect(result.hadThread).toBe(true);

    // Verify the thread is in the new project
    const projectContent = await readFile(join(vault.path, result.projectFile), "utf-8");
    const projectTasks = parseContent(projectContent, result.projectFile);
    const promotedTask = projectTasks.find((t) => t.description === "First open task");
    expect(promotedTask).toBeDefined();
    expect(promotedTask!.thread).not.toBeNull();
    expect(promotedTask!.thread!.counterparts).toEqual(["Bob Martinez"]);
    expect(promotedTask!.thread!.state).toBe("waiting");
    expect(promotedTask!.thread!.entries).toHaveLength(1);

    // Verify thread was removed from source
    const sourceContent = await readFile(join(vault.path, "Projects/Test Project.md"), "utf-8");
    expect(sourceContent).not.toContain("🧵");
  });

  it("sets area on the new project", async () => {
    const config = testConfig(vault.path);
    const result = await promoteTask(config, {
      file: "Projects/Test Project.md",
      line: 14,
      area: "Test Area",
    });

    const projectContent = await readFile(join(vault.path, result.projectFile), "utf-8");
    expect(projectContent).toContain("[[Test Area]]");
  });

  it("fails if project with that name already exists", async () => {
    const config = testConfig(vault.path);
    await expect(
      promoteTask(config, {
        file: "Projects/Test Project.md",
        line: 14,
        name: "Test Project", // already exists
      }),
    ).rejects.toThrow("already exists");
  });

  it("fails if target line is not a task", async () => {
    const config = testConfig(vault.path);
    await expect(
      promoteTask(config, {
        file: "Projects/Test Project.md",
        line: 1,
      }),
    ).rejects.toThrow("not a task");
  });

  it("fails if description safety check doesn't match", async () => {
    const config = testConfig(vault.path);
    await expect(
      promoteTask(config, {
        file: "Projects/Test Project.md",
        line: 14,
        description: "Wrong task name",
      }),
    ).rejects.toThrow();
  });
});
