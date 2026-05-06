import { type Thread, type ThreadState, type ThreadEntry } from "./types.js";

/**
 * Valid thread states (case-insensitive matching).
 */
const VALID_STATES: ThreadState[] = ["active", "waiting", "paused", "resolved"];

/**
 * Matches the thread sentinel in blockquote content (after > is stripped).
 * Captures everything after the 🧵 emoji for further parsing.
 */
const THREAD_SENTINEL_REGEX = /^🧵\s+(.*)/;

/**
 * Matches a blockquote line (with any leading indentation).
 */
const BLOCKQUOTE_LINE_REGEX = /^\s*>\s?(.*)/;

/**
 * Matches a thread entry line within a blockquote.
 * Entry format: > - YYYY-MM-DD: description  OR  > - description (undated)
 */
const ENTRY_REGEX = /^-\s+(?:(\d{4}-\d{2}-\d{2}):\s+)?(.+)/;

/**
 * Matches the Source: line within a thread block.
 */
const SOURCE_REGEX = /^Source:\s*(.+)/;

/**
 * Separator characters accepted between thread header fields.
 * Canonical is · (U+00B7), but we accept • (U+2022), *, and -.
 */
const SEPARATOR_REGEX = /\s+[·•*\-]\s+/;

/**
 * Matches a wiki link: [[content]]
 */
const WIKI_LINK_REGEX = /\[\[([^\]]+)\]\]/g;

/**
 * Matches follow-up date in various acceptable forms.
 * Accepts: "follow-up:", "followup:", "follow up:"
 */
const FOLLOW_UP_REGEX = /^follow[\s-]?up:\s*(\d{4}-\d{2}-\d{2})?/i;

/**
 * Parse a thread block from the lines following a task.
 *
 * Given an array of lines starting immediately after a task line,
 * detects and parses a thread blockquote block if one exists.
 *
 * @param lines - Lines following the task (0-indexed from the line after the task)
 * @param taskLineNumber - The 1-indexed line number of the parent task
 * @returns Parsed Thread, or null if no thread block found
 */
export function parseThread(
  lines: string[],
  taskLineNumber: number,
): Thread | null {
  // Find the start of the thread block — first blockquote line with 🧵
  let headerIdx = -1;
  let headerContent = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Stop if we hit a new list item at the same or higher level (next task)
    if (/^\s*- \[.\]/.test(line)) break;
    // Stop if we hit a non-indented, non-blockquote, non-empty line
    if (line.trim() !== "" && !BLOCKQUOTE_LINE_REGEX.test(line)) break;

    // Check if this blockquote line contains the thread sentinel
    const bqMatch = line.match(BLOCKQUOTE_LINE_REGEX);
    if (bqMatch) {
      const content = bqMatch[1].trim();
      const sentinelMatch = content.match(THREAD_SENTINEL_REGEX);
      if (sentinelMatch) {
        headerIdx = i;
        headerContent = sentinelMatch[1];
        break;
      }
    }
  }

  if (headerIdx === -1) return null;

  // Parse the header content
  const header = parseThreadHeader(headerContent);

  if (!header) return null;

  // Collect remaining blockquote lines after the header
  let source: string | null = null;
  const entries: ThreadEntry[] = [];
  let endIdx = headerIdx;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const bqMatch = line.match(BLOCKQUOTE_LINE_REGEX);

    // End of blockquote block
    if (!bqMatch) {
      // Allow blank lines within the block if the next non-blank line is still a blockquote
      if (line.trim() === "") {
        // Look ahead for more blockquote lines
        let hasMore = false;
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() === "") continue;
          if (BLOCKQUOTE_LINE_REGEX.test(lines[j])) {
            hasMore = true;
          }
          break;
        }
        if (hasMore) continue;
      }
      break;
    }

    endIdx = i;
    const content = bqMatch[1].trim();

    // Skip empty blockquote lines
    if (content === "") continue;

    // Check for Source: line
    const sourceMatch = content.match(SOURCE_REGEX);
    if (sourceMatch && entries.length === 0) {
      source = sourceMatch[1].trim();
      continue;
    }

    // Check for entry line
    const entryMatch = content.match(ENTRY_REGEX);
    if (entryMatch) {
      entries.push({
        date: entryMatch[1] || null,
        description: entryMatch[2].trim(),
      });
      continue;
    }

    // Non-entry, non-source blockquote line — could be a continuation
    // of a multi-line source or just noise. Skip it.
  }

  return {
    counterparts: header.counterparts,
    state: header.state,
    followUp: header.followUp,
    source,
    entries,
    startLine: taskLineNumber + 1 + headerIdx,
    endLine: taskLineNumber + 1 + endIdx,
  };
}

/**
 * Parsed header fields from the 🧵 line.
 */
interface ParsedHeader {
  counterparts: string[];
  state: ThreadState;
  followUp: string | null;
}

/**
 * Parse the content after 🧵 on the header line.
 *
 * Expected format: "with [[Bob]], [[Alice]] · waiting · follow-up: 2026-05-09"
 * All fields after counterparts are optional.
 */
export function parseThreadHeader(content: string): ParsedHeader | null {
  // Must start with "with "
  const withMatch = content.match(/^with\s+/i);
  if (!withMatch) return null;

  const afterWith = content.slice(withMatch[0].length);

  // Split on separators to get fields
  const fields = afterWith.split(SEPARATOR_REGEX);
  if (fields.length === 0) return null;

  // First field is counterparts
  const counterparts = parseCounterparts(fields[0]);
  if (counterparts.length === 0) return null;

  // Remaining fields: state and/or follow-up (in any order)
  let state: ThreadState = "active"; // default
  let followUp: string | null = null;

  for (let i = 1; i < fields.length; i++) {
    const field = fields[i].trim();

    // Check if it's a state
    const lowerField = field.toLowerCase();
    if (VALID_STATES.includes(lowerField as ThreadState)) {
      state = lowerField as ThreadState;
      continue;
    }

    // Check if it's a follow-up date
    const followUpMatch = field.match(FOLLOW_UP_REGEX);
    if (followUpMatch) {
      followUp = followUpMatch[1] || null; // null if keyword present but no date
      continue;
    }
  }

  return { counterparts, state, followUp };
}

/**
 * Parse the counterparts string into individual names.
 *
 * Handles wiki links ([[Name]]) and plain text names separated by commas.
 */
export function parseCounterparts(raw: string): string[] {
  const counterparts: string[] = [];

  // Extract wiki links first
  let remaining = raw;
  let match: RegExpExecArray | null;
  const wikiLinkPositions: Array<{ start: number; end: number; name: string }> = [];

  const regex = new RegExp(WIKI_LINK_REGEX.source, "g");
  while ((match = regex.exec(raw)) !== null) {
    wikiLinkPositions.push({
      start: match.index,
      end: match.index + match[0].length,
      name: match[1],
    });
  }

  if (wikiLinkPositions.length > 0) {
    // Use wiki link names
    for (const wl of wikiLinkPositions) {
      counterparts.push(wl.name);
    }
  } else {
    // Fall back to comma-separated plain text
    const parts = remaining.split(",");
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed) counterparts.push(trimmed);
    }
  }

  return counterparts;
}

/**
 * Parse a single thread entry line.
 *
 * @param line - The content after `> - ` (the blockquote and list marker stripped)
 */
export function parseThreadEntry(line: string): ThreadEntry | null {
  const match = line.match(ENTRY_REGEX);
  if (!match) return null;

  return {
    date: match[1] || null,
    description: match[2].trim(),
  };
}
