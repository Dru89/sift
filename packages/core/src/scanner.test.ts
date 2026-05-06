import { describe, it, expect } from "vitest";
import { matchesSearch } from "./scanner.js";

describe("matchesSearch", () => {
  it("matches basic substring tokens", () => {
    expect(matchesSearch("Fix the login page", "login")).toBe(true);
    expect(matchesSearch("Fix the login page", "login page")).toBe(true);
    expect(matchesSearch("Fix the login page", "signup")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(matchesSearch("Fix the Login Page", "login page")).toBe(true);
    expect(matchesSearch("fix the login page", "LOGIN")).toBe(true);
  });

  it("requires all tokens to match", () => {
    expect(matchesSearch("Fix the login page", "fix login")).toBe(true);
    expect(matchesSearch("Fix the login page", "fix signup")).toBe(false);
  });

  it("strips wiki links for matching", () => {
    expect(matchesSearch("Review [[Login Service]] code", "login service")).toBe(true);
    expect(matchesSearch("Update [[Health Tracker/_shortcut-log]]", "shortcut-log")).toBe(true);
  });

  it("strips inline code backticks for matching", () => {
    expect(matchesSearch("Fix the `vault_write` function", "vault_write")).toBe(true);
  });

  it("preserves underscores in identifiers", () => {
    expect(matchesSearch("Implement vault_write and vault_replace tools", "vault_write")).toBe(true);
    expect(matchesSearch("Fix the vault_read function", "vault_read")).toBe(true);
    expect(matchesSearch("Add thread_create CLI command", "thread_create")).toBe(true);
  });

  it("still strips actual italic underscores", () => {
    // _italic text_ at word boundaries should still be stripped
    expect(matchesSearch("This is _important_ work", "important")).toBe(true);
    expect(matchesSearch("Read the __bold__ section", "bold")).toBe(true);
  });

  it("strips bold asterisks for matching", () => {
    expect(matchesSearch("Fix the **critical** bug", "critical")).toBe(true);
  });

  it("strips tags for matching", () => {
    expect(matchesSearch("Work on #sift tasks", "sift")).toBe(true);
  });

  it("handles mixed markdown in descriptions", () => {
    expect(matchesSearch(
      "Implement `vault_write` for [[Sift]] (see #tooling)",
      "vault_write sift",
    )).toBe(true);
  });
});
