import { describe, it, expect } from "vitest";
import { parseThread, parseThreadHeader, parseCounterparts, parseThreadEntry } from "./thread-parser.js";
import { parseContent } from "./parser.js";

describe("parseThreadHeader", () => {
  it("parses a full header with all fields", () => {
    const result = parseThreadHeader("with [[Bob Martinez]], [[Alice Chen]] · waiting · follow-up: 2026-05-09");
    expect(result).not.toBeNull();
    expect(result!.counterparts).toEqual(["Bob Martinez", "Alice Chen"]);
    expect(result!.state).toBe("waiting");
    expect(result!.followUp).toBe("2026-05-09");
  });

  it("defaults state to active when omitted", () => {
    const result = parseThreadHeader("with [[Bob Martinez]]");
    expect(result).not.toBeNull();
    expect(result!.state).toBe("active");
    expect(result!.followUp).toBeNull();
  });

  it("parses state without follow-up", () => {
    const result = parseThreadHeader("with [[Bob Martinez]] · paused");
    expect(result).not.toBeNull();
    expect(result!.state).toBe("paused");
    expect(result!.followUp).toBeNull();
  });

  it("parses follow-up without explicit state", () => {
    const result = parseThreadHeader("with [[Bob Martinez]] · follow-up: 2026-05-12");
    expect(result).not.toBeNull();
    expect(result!.state).toBe("active");
    expect(result!.followUp).toBe("2026-05-12");
  });

  it("handles case-insensitive state", () => {
    expect(parseThreadHeader("with [[Bob]] · Waiting")!.state).toBe("waiting");
    expect(parseThreadHeader("with [[Bob]] · PAUSED")!.state).toBe("paused");
    expect(parseThreadHeader("with [[Bob]] · Resolved")!.state).toBe("resolved");
  });

  it("accepts bullet separator (•)", () => {
    const result = parseThreadHeader("with [[Bob]] • waiting • follow-up: 2026-05-09");
    expect(result).not.toBeNull();
    expect(result!.state).toBe("waiting");
    expect(result!.followUp).toBe("2026-05-09");
  });

  it("accepts dash separator (-)", () => {
    const result = parseThreadHeader("with [[Bob]] - waiting - follow-up: 2026-05-09");
    expect(result).not.toBeNull();
    expect(result!.state).toBe("waiting");
    expect(result!.followUp).toBe("2026-05-09");
  });

  it("accepts asterisk separator (*)", () => {
    const result = parseThreadHeader("with [[Bob]] * waiting * follow-up: 2026-05-09");
    expect(result).not.toBeNull();
    expect(result!.state).toBe("waiting");
    expect(result!.followUp).toBe("2026-05-09");
  });

  it("accepts 'followup:' without hyphen", () => {
    const result = parseThreadHeader("with [[Bob]] · waiting · followup: 2026-05-09");
    expect(result).not.toBeNull();
    expect(result!.followUp).toBe("2026-05-09");
  });

  it("accepts 'follow up:' with space", () => {
    const result = parseThreadHeader("with [[Bob]] · waiting · follow up: 2026-05-09");
    expect(result).not.toBeNull();
    expect(result!.followUp).toBe("2026-05-09");
  });

  it("handles follow-up keyword with no date", () => {
    const result = parseThreadHeader("with [[Bob]] · waiting · follow-up:");
    expect(result).not.toBeNull();
    expect(result!.followUp).toBeNull();
  });

  it("returns null if 'with' keyword is missing", () => {
    expect(parseThreadHeader("[[Bob]] · waiting")).toBeNull();
  });

  it("parses plain text counterparts (no wiki links)", () => {
    const result = parseThreadHeader("with Bob Martinez, Alice Chen · waiting");
    expect(result).not.toBeNull();
    expect(result!.counterparts).toEqual(["Bob Martinez", "Alice Chen"]);
  });

  it("parses a single wiki link counterpart", () => {
    const result = parseThreadHeader("with [[Identity Team]] · waiting");
    expect(result).not.toBeNull();
    expect(result!.counterparts).toEqual(["Identity Team"]);
  });
});

describe("parseCounterparts", () => {
  it("extracts wiki link names", () => {
    expect(parseCounterparts("[[Bob]], [[Alice]]")).toEqual(["Bob", "Alice"]);
  });

  it("handles single wiki link", () => {
    expect(parseCounterparts("[[Bob Martinez]]")).toEqual(["Bob Martinez"]);
  });

  it("falls back to comma-separated plain text", () => {
    expect(parseCounterparts("Bob, Alice, Charlie")).toEqual(["Bob", "Alice", "Charlie"]);
  });

  it("trims whitespace from plain text names", () => {
    expect(parseCounterparts("  Bob ,  Alice  ")).toEqual(["Bob", "Alice"]);
  });

  it("handles wiki links with extra text around them", () => {
    // Wiki links take precedence — the regex finds them regardless of surrounding text
    expect(parseCounterparts("[[Bob]], [[Alice]] and others")).toEqual(["Bob", "Alice"]);
  });
});

describe("parseThreadEntry", () => {
  it("parses a dated entry", () => {
    const entry = parseThreadEntry("- 2026-05-03: Sent initial mockup");
    expect(entry).not.toBeNull();
    expect(entry!.date).toBe("2026-05-03");
    expect(entry!.description).toBe("Sent initial mockup");
  });

  it("parses an undated entry", () => {
    const entry = parseThreadEntry("- Sent initial mockup");
    expect(entry).not.toBeNull();
    expect(entry!.date).toBeNull();
    expect(entry!.description).toBe("Sent initial mockup");
  });

  it("preserves inline links in descriptions", () => {
    const entry = parseThreadEntry("- 2026-05-03: Sent mockup ([Teams](https://teams.example.com))");
    expect(entry).not.toBeNull();
    expect(entry!.description).toBe("Sent mockup ([Teams](https://teams.example.com))");
  });

  it("preserves wiki links in descriptions", () => {
    const entry = parseThreadEntry("- 2026-05-03: Sent [[Login Mockup v2]]");
    expect(entry).not.toBeNull();
    expect(entry!.description).toBe("Sent [[Login Mockup v2]]");
  });

  it("returns null for non-entry text", () => {
    expect(parseThreadEntry("Source: https://example.com")).toBeNull();
  });
});

describe("parseThread", () => {
  it("parses a complete thread block", () => {
    const lines = [
      "  > 🧵 with [[Bob Martinez]], [[Alice Chen]] · waiting · follow-up: 2026-05-09",
      "  > Source: [Teams thread](https://teams.microsoft.com/l/message/123)",
      "  > - 2026-05-03: Sent initial mockup",
      "  > - 2026-05-05: Bob said he'd review by EOW",
    ];
    const thread = parseThread(lines, 5);

    expect(thread).not.toBeNull();
    expect(thread!.counterparts).toEqual(["Bob Martinez", "Alice Chen"]);
    expect(thread!.state).toBe("waiting");
    expect(thread!.followUp).toBe("2026-05-09");
    expect(thread!.source).toBe("[Teams thread](https://teams.microsoft.com/l/message/123)");
    expect(thread!.entries).toHaveLength(2);
    expect(thread!.entries[0]).toEqual({ date: "2026-05-03", description: "Sent initial mockup" });
    expect(thread!.entries[1]).toEqual({ date: "2026-05-05", description: "Bob said he'd review by EOW" });
    expect(thread!.startLine).toBe(6); // taskLineNumber (5) + 1 + headerIdx (0)
    expect(thread!.endLine).toBe(9);   // taskLineNumber (5) + 1 + endIdx (3)
  });

  it("parses a minimal thread (header only, no entries)", () => {
    const lines = [
      "  > 🧵 with [[Bob]] · active",
    ];
    const thread = parseThread(lines, 10);

    expect(thread).not.toBeNull();
    expect(thread!.counterparts).toEqual(["Bob"]);
    expect(thread!.state).toBe("active");
    expect(thread!.entries).toHaveLength(0);
    expect(thread!.source).toBeNull();
  });

  it("returns null when no thread block exists", () => {
    const lines = [
      "  Some regular text",
      "  More text",
    ];
    expect(parseThread(lines, 1)).toBeNull();
  });

  it("returns null for empty lines array", () => {
    expect(parseThread([], 1)).toBeNull();
  });

  it("stops at the next task line", () => {
    const lines = [
      "  > 🧵 with [[Bob]] · waiting",
      "  > - 2026-05-03: Sent mockup",
      "- [ ] Next task in the list",
    ];
    const thread = parseThread(lines, 1);

    expect(thread).not.toBeNull();
    expect(thread!.entries).toHaveLength(1);
  });

  it("handles no space after >", () => {
    const lines = [
      "  >🧵 with [[Bob]] · waiting",
      "  >- 2026-05-03: Sent mockup",
    ];
    const thread = parseThread(lines, 1);

    expect(thread).not.toBeNull();
    expect(thread!.state).toBe("waiting");
    expect(thread!.entries).toHaveLength(1);
  });

  it("handles multiple spaces after >", () => {
    const lines = [
      "  >   🧵 with [[Bob]] · active",
      "  >   - 2026-05-03: Did the thing",
    ];
    const thread = parseThread(lines, 1);

    expect(thread).not.toBeNull();
    expect(thread!.entries).toHaveLength(1);
  });

  it("ignores blank blockquote lines between entries", () => {
    const lines = [
      "  > 🧵 with [[Bob]] · waiting",
      "  > - 2026-05-03: First entry",
      "  >",
      "  > - 2026-05-05: Second entry",
    ];
    const thread = parseThread(lines, 1);

    expect(thread).not.toBeNull();
    expect(thread!.entries).toHaveLength(2);
  });

  it("parses resolved thread", () => {
    const lines = [
      "  > 🧵 with [[Bob]] · resolved",
      "  > - 2026-05-03: Sent proposal",
      "  > - 2026-05-07: Bob approved, conversation done",
    ];
    const thread = parseThread(lines, 1);

    expect(thread).not.toBeNull();
    expect(thread!.state).toBe("resolved");
    expect(thread!.entries).toHaveLength(2);
  });

  it("parses source as raw URL", () => {
    const lines = [
      "  > 🧵 with [[Bob]] · waiting",
      "  > Source: https://teams.microsoft.com/l/message/123",
      "  > - 2026-05-03: Sent mockup",
    ];
    const thread = parseThread(lines, 1);

    expect(thread).not.toBeNull();
    expect(thread!.source).toBe("https://teams.microsoft.com/l/message/123");
  });

  it("handles undated entries", () => {
    const lines = [
      "  > 🧵 with [[Bob]] · active",
      "  > - 2026-05-03: Dated entry",
      "  > - Undated entry just logging something",
    ];
    const thread = parseThread(lines, 1);

    expect(thread).not.toBeNull();
    expect(thread!.entries).toHaveLength(2);
    expect(thread!.entries[0].date).toBe("2026-05-03");
    expect(thread!.entries[1].date).toBeNull();
    expect(thread!.entries[1].description).toBe("Undated entry just logging something");
  });
});

describe("parseContent with threads", () => {
  it("attaches a thread to its parent task", () => {
    const content = `## Tasks

- [ ] Work with Bob on login page design 📅 2026-05-15
  > 🧵 with [[Bob Martinez]] · waiting · follow-up: 2026-05-09
  > - 2026-05-03: Sent initial mockup
  > - 2026-05-05: Waiting on his pick

- [ ] Another task without a thread
`;
    const tasks = parseContent(content, "Projects/Test.md");

    expect(tasks).toHaveLength(2);

    // First task should have a thread
    expect(tasks[0].thread).not.toBeNull();
    expect(tasks[0].thread!.counterparts).toEqual(["Bob Martinez"]);
    expect(tasks[0].thread!.state).toBe("waiting");
    expect(tasks[0].thread!.entries).toHaveLength(2);

    // Second task should not have a thread
    expect(tasks[1].thread).toBeNull();
  });

  it("handles multiple tasks with threads in the same file", () => {
    const content = `## Tasks

- [ ] Talk to Bob about auth 📅 2026-05-15
  > 🧵 with [[Bob]] · waiting · follow-up: 2026-05-09
  > - 2026-05-03: Sent design doc

- [ ] Coordinate with Alice on migration
  > 🧵 with [[Alice]] · active
  > - 2026-05-04: She sent timeline
  > - 2026-05-05: Need to reply

- [ ] Write tests
`;
    const tasks = parseContent(content, "Projects/Test.md");

    expect(tasks).toHaveLength(3);
    expect(tasks[0].thread).not.toBeNull();
    expect(tasks[0].thread!.counterparts).toEqual(["Bob"]);
    expect(tasks[1].thread).not.toBeNull();
    expect(tasks[1].thread!.counterparts).toEqual(["Alice"]);
    expect(tasks[2].thread).toBeNull();
  });

  it("does not attach thread to wrong task", () => {
    const content = `## Tasks

- [ ] First task
- [ ] Second task
  > 🧵 with [[Bob]] · active
  > - 2026-05-05: Started discussion
`;
    const tasks = parseContent(content, "test.md");

    expect(tasks).toHaveLength(2);
    expect(tasks[0].thread).toBeNull();
    expect(tasks[1].thread).not.toBeNull();
    expect(tasks[1].thread!.counterparts).toEqual(["Bob"]);
  });

  it("handles a completed task with a resolved thread", () => {
    const content = `- [x] Finalize design with Bob ✅ 2026-05-07
  > 🧵 with [[Bob]] · resolved
  > - 2026-05-03: Sent options
  > - 2026-05-07: Bob picked option B
`;
    const tasks = parseContent(content, "test.md");

    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("done");
    expect(tasks[0].thread).not.toBeNull();
    expect(tasks[0].thread!.state).toBe("resolved");
  });
});
