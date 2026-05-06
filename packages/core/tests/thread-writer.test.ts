import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestVault, testConfig, type TestVault } from "./helpers.js";
import { createThread, addThreadEntry, updateThreadState, formatThread } from "../src/thread-writer.js";
import { parseContent } from "../src/parser.js";
import { parseThread } from "../src/thread-parser.js";

describe("formatThread", () => {
  it("formats a complete thread", () => {
    const lines = formatThread({
      counterparts: ["Bob Martinez", "Alice Chen"],
      state: "waiting",
      followUp: "2026-05-09",
      source: "[Teams](https://teams.example.com)",
      entries: [
        { date: "2026-05-03", description: "Sent initial mockup" },
        { date: "2026-05-05", description: "Waiting on feedback" },
      ],
    });

    expect(lines).toEqual([
      "  > 🧵 with [[Bob Martinez]], [[Alice Chen]] · waiting · follow-up: 2026-05-09",
      "  > Source: [Teams](https://teams.example.com)",
      "  > - 2026-05-03: Sent initial mockup",
      "  > - 2026-05-05: Waiting on feedback",
    ]);
  });

  it("formats a minimal thread (no source, no entries)", () => {
    const lines = formatThread({
      counterparts: ["Bob"],
      state: "active",
    });

    expect(lines).toEqual([
      "  > 🧵 with [[Bob]] · active",
    ]);
  });

  it("formats with custom indentation", () => {
    const lines = formatThread(
      { counterparts: ["Bob"], state: "waiting", followUp: "2026-05-10" },
      "    ",
    );

    expect(lines).toEqual([
      "    > 🧵 with [[Bob]] · waiting · follow-up: 2026-05-10",
    ]);
  });

  it("formats entries without dates", () => {
    const lines = formatThread({
      counterparts: ["Bob"],
      state: "active",
      entries: [{ date: null, description: "Quick note" }],
    });

    expect(lines).toEqual([
      "  > 🧵 with [[Bob]] · active",
      "  > - Quick note",
    ]);
  });
});

describe("createThread", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
  });

  afterEach(async () => {
    await vault.cleanup();
  });

  it("creates a thread on a task", async () => {
    const config = testConfig(vault.path);
    const result = await createThread(config, {
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob Martinez"],
      state: "waiting",
      followUp: "2026-05-12",
      content: "Sent initial proposal",
    });

    expect(result.task).toBe("First open task");
    expect(result.counterparts).toEqual(["Bob Martinez"]);
    expect(result.state).toBe("waiting");
    expect(result.followUp).toBe("2026-05-12");
    expect(result.lastEntry).not.toBeNull();
    expect(result.lastEntry!.description).toBe("Sent initial proposal");

    // Verify the file was written correctly
    const content = await readFile(join(vault.path, "Projects/Test Project.md"), "utf-8");
    const tasks = parseContent(content, "Projects/Test Project.md");
    const task = tasks.find((t) => t.description === "First open task");
    expect(task).toBeDefined();
    expect(task!.thread).not.toBeNull();
    expect(task!.thread!.counterparts).toEqual(["Bob Martinez"]);
    expect(task!.thread!.state).toBe("waiting");
    expect(task!.thread!.entries).toHaveLength(1);
  });

  it("creates a thread with no initial entry", async () => {
    const config = testConfig(vault.path);
    const result = await createThread(config, {
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob"],
      state: "active",
    });

    expect(result.lastEntry).toBeNull();

    const content = await readFile(join(vault.path, "Projects/Test Project.md"), "utf-8");
    const tasks = parseContent(content, "Projects/Test Project.md");
    const task = tasks.find((t) => t.description === "First open task");
    expect(task!.thread).not.toBeNull();
    expect(task!.thread!.entries).toHaveLength(0);
  });

  it("creates a thread with a source", async () => {
    const config = testConfig(vault.path);
    await createThread(config, {
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob"],
      state: "waiting",
      source: "[Teams](https://teams.example.com/thread/123)",
    });

    const content = await readFile(join(vault.path, "Projects/Test Project.md"), "utf-8");
    const tasks = parseContent(content, "Projects/Test Project.md");
    const task = tasks.find((t) => t.description === "First open task");
    expect(task!.thread!.source).toBe("[Teams](https://teams.example.com/thread/123)");
  });

  it("fails if the task already has a thread", async () => {
    const config = testConfig(vault.path);

    // Create first thread
    await createThread(config, {
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob"],
    });

    // Try to create another
    await expect(
      createThread(config, {
        file: "Projects/Test Project.md",
        line: 14,
        counterparts: ["Alice"],
      }),
    ).rejects.toThrow("already has a thread");
  });

  it("fails if the target line is not a task", async () => {
    const config = testConfig(vault.path);
    await expect(
      createThread(config, {
        file: "Projects/Test Project.md",
        line: 1, // frontmatter line
        counterparts: ["Bob"],
      }),
    ).rejects.toThrow("not a task");
  });

  it("fails if description safety check doesn't match", async () => {
    const config = testConfig(vault.path);
    await expect(
      createThread(config, {
        file: "Projects/Test Project.md",
        line: 14,
        counterparts: ["Bob"],
        description: "Completely different task",
      }),
    ).rejects.toThrow("does not match");
  });

  it("defaults state to active", async () => {
    const config = testConfig(vault.path);
    const result = await createThread(config, {
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob"],
    });

    expect(result.state).toBe("active");
  });
});

describe("addThreadEntry", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
  });

  afterEach(async () => {
    await vault.cleanup();
  });

  it("adds an entry to an existing thread", async () => {
    const config = testConfig(vault.path);

    // Create thread first
    await createThread(config, {
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob"],
      state: "active",
      content: "Started discussion",
    });

    // Add entry
    const result = await addThreadEntry(config, {
      file: "Projects/Test Project.md",
      line: 14,
      content: "Bob replied with concerns",
      state: "active",
    });

    expect(result.lastEntry!.description).toBe("Bob replied with concerns");

    // Verify file
    const content = await readFile(join(vault.path, "Projects/Test Project.md"), "utf-8");
    const tasks = parseContent(content, "Projects/Test Project.md");
    const task = tasks.find((t) => t.description === "First open task");
    expect(task!.thread!.entries).toHaveLength(2);
    expect(task!.thread!.entries[1].description).toBe("Bob replied with concerns");
  });

  it("changes state when adding an entry", async () => {
    const config = testConfig(vault.path);

    await createThread(config, {
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob"],
      state: "active",
    });

    const result = await addThreadEntry(config, {
      file: "Projects/Test Project.md",
      line: 14,
      content: "Sent the mockup",
      state: "waiting",
      followUp: "2026-05-12",
    });

    expect(result.state).toBe("waiting");
    expect(result.followUp).toBe("2026-05-12");

    // Verify the header was rewritten
    const content = await readFile(join(vault.path, "Projects/Test Project.md"), "utf-8");
    const tasks = parseContent(content, "Projects/Test Project.md");
    const task = tasks.find((t) => t.description === "First open task");
    expect(task!.thread!.state).toBe("waiting");
    expect(task!.thread!.followUp).toBe("2026-05-12");
  });

  it("clears follow-up with 'none'", async () => {
    const config = testConfig(vault.path);

    await createThread(config, {
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob"],
      state: "waiting",
      followUp: "2026-05-09",
    });

    const result = await addThreadEntry(config, {
      file: "Projects/Test Project.md",
      line: 14,
      content: "Got a response, no longer waiting",
      state: "active",
      followUp: "none",
    });

    expect(result.state).toBe("active");
    expect(result.followUp).toBeNull();
  });

  it("fails if task has no thread", async () => {
    const config = testConfig(vault.path);
    await expect(
      addThreadEntry(config, {
        file: "Projects/Test Project.md",
        line: 14,
        content: "Some entry",
      }),
    ).rejects.toThrow("has no thread");
  });

  it("fails if thread is resolved", async () => {
    const config = testConfig(vault.path);

    await createThread(config, {
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob"],
      state: "resolved",
    });

    await expect(
      addThreadEntry(config, {
        file: "Projects/Test Project.md",
        line: 14,
        content: "Trying to add after resolved",
      }),
    ).rejects.toThrow("resolved");
  });

  it("uses custom date for entry", async () => {
    const config = testConfig(vault.path);

    await createThread(config, {
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob"],
    });

    const result = await addThreadEntry(config, {
      file: "Projects/Test Project.md",
      line: 14,
      content: "Backdated entry",
      date: "2026-05-01",
    });

    expect(result.lastEntry!.date).toBe("2026-05-01");
  });
});

describe("updateThreadState", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
  });

  afterEach(async () => {
    await vault.cleanup();
  });

  it("changes thread state", async () => {
    const config = testConfig(vault.path);

    await createThread(config, {
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob"],
      state: "active",
    });

    const result = await updateThreadState(config, {
      file: "Projects/Test Project.md",
      line: 14,
      state: "paused",
    });

    expect(result.state).toBe("paused");

    // Verify file
    const content = await readFile(join(vault.path, "Projects/Test Project.md"), "utf-8");
    const tasks = parseContent(content, "Projects/Test Project.md");
    const task = tasks.find((t) => t.description === "First open task");
    expect(task!.thread!.state).toBe("paused");
  });

  it("updates counterparts", async () => {
    const config = testConfig(vault.path);

    await createThread(config, {
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob"],
      state: "active",
    });

    const result = await updateThreadState(config, {
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Identity Team"],
    });

    expect(result.counterparts).toEqual(["Identity Team"]);

    const content = await readFile(join(vault.path, "Projects/Test Project.md"), "utf-8");
    const tasks = parseContent(content, "Projects/Test Project.md");
    const task = tasks.find((t) => t.description === "First open task");
    expect(task!.thread!.counterparts).toEqual(["Identity Team"]);
  });

  it("adds a source", async () => {
    const config = testConfig(vault.path);

    await createThread(config, {
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob"],
      state: "active",
    });

    await updateThreadState(config, {
      file: "Projects/Test Project.md",
      line: 14,
      source: "https://teams.example.com/thread/456",
    });

    const content = await readFile(join(vault.path, "Projects/Test Project.md"), "utf-8");
    const tasks = parseContent(content, "Projects/Test Project.md");
    const task = tasks.find((t) => t.description === "First open task");
    expect(task!.thread!.source).toBe("https://teams.example.com/thread/456");
  });

  it("removes a source with 'none'", async () => {
    const config = testConfig(vault.path);

    await createThread(config, {
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob"],
      source: "https://teams.example.com/thread/123",
    });

    await updateThreadState(config, {
      file: "Projects/Test Project.md",
      line: 14,
      source: "none",
    });

    const content = await readFile(join(vault.path, "Projects/Test Project.md"), "utf-8");
    const tasks = parseContent(content, "Projects/Test Project.md");
    const task = tasks.find((t) => t.description === "First open task");
    expect(task!.thread!.source).toBeNull();
  });

  it("fails if no changes specified", async () => {
    const config = testConfig(vault.path);

    await createThread(config, {
      file: "Projects/Test Project.md",
      line: 14,
      counterparts: ["Bob"],
    });

    await expect(
      updateThreadState(config, {
        file: "Projects/Test Project.md",
        line: 14,
      }),
    ).rejects.toThrow("At least one of");
  });

  it("fails if task has no thread", async () => {
    const config = testConfig(vault.path);
    await expect(
      updateThreadState(config, {
        file: "Projects/Test Project.md",
        line: 14,
        state: "paused",
      }),
    ).rejects.toThrow("has no thread");
  });
});

describe("round trip: format → parse", () => {
  it("formatThread output is correctly parsed back by parseThread", () => {
    const lines = formatThread({
      counterparts: ["Bob Martinez", "Alice Chen"],
      state: "waiting",
      followUp: "2026-05-09",
      source: "[Teams](https://teams.example.com)",
      entries: [
        { date: "2026-05-03", description: "Sent initial mockup" },
        { date: "2026-05-05", description: "Waiting on feedback" },
      ],
    });

    // parseThread expects lines following a task, so task is at line 1
    const thread = parseThread(lines, 1);

    expect(thread).not.toBeNull();
    expect(thread!.counterparts).toEqual(["Bob Martinez", "Alice Chen"]);
    expect(thread!.state).toBe("waiting");
    expect(thread!.followUp).toBe("2026-05-09");
    expect(thread!.source).toBe("[Teams](https://teams.example.com)");
    expect(thread!.entries).toHaveLength(2);
    expect(thread!.entries[0]).toEqual({ date: "2026-05-03", description: "Sent initial mockup" });
    expect(thread!.entries[1]).toEqual({ date: "2026-05-05", description: "Waiting on feedback" });
  });
});
