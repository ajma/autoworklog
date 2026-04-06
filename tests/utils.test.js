import { describe, test, expect } from "vitest";
import { todayKey, formatDuration, escapeHtml, extractFileInfo, DEFAULT_RULES } from "../utils.js";

describe("todayKey", () => {
  test("returns a string in YYYY-MM-DD format", () => {
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("reflects the current local date", () => {
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(todayKey()).toBe(expected);
  });
});

describe("formatDuration", () => {
  test("formats seconds only", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(0)).toBe("0s");
  });

  test("formats minutes and seconds", () => {
    expect(formatDuration(60)).toBe("1m 0s");
    expect(formatDuration(90)).toBe("1m 30s");
  });

  test("formats hours, minutes, and seconds", () => {
    expect(formatDuration(3600)).toBe("1h 0m 0s");
    expect(formatDuration(3661)).toBe("1h 1m 1s");
    expect(formatDuration(7384)).toBe("2h 3m 4s");
  });
});

describe("escapeHtml", () => {
  test("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  test("escapes angle brackets", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  test("escapes double quotes", () => {
    expect(escapeHtml('"quoted"')).toBe("&quot;quoted&quot;");
  });

  test("escapes single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  test("leaves safe strings unchanged", () => {
    expect(escapeHtml("Hello World 123")).toBe("Hello World 123");
  });

  test("coerces non-strings", () => {
    expect(escapeHtml(42)).toBe("42");
  });
});

describe("extractFileInfo with DEFAULT_RULES", () => {
  test("parses a Google Doc URL", () => {
    expect(extractFileInfo("https://docs.google.com/document/d/abc123XYZ/edit", DEFAULT_RULES)).toEqual({
      id: "abc123XYZ",
      type: "Doc",
    });
  });

  test("parses a Google Sheets URL", () => {
    expect(extractFileInfo("https://docs.google.com/spreadsheets/d/sheet456/edit", DEFAULT_RULES)).toEqual({
      id: "sheet456",
      type: "Sheet",
    });
  });

  test("parses a Google Slides URL", () => {
    expect(extractFileInfo("https://docs.google.com/presentation/d/slide789/edit", DEFAULT_RULES)).toEqual({
      id: "slide789",
      type: "Slide",
    });
  });

  test("parses a Google Forms URL", () => {
    expect(extractFileInfo("https://docs.google.com/forms/d/form000/edit", DEFAULT_RULES)).toEqual({
      id: "form000",
      type: "Form",
    });
  });

  test("parses a Google Drawings URL", () => {
    expect(extractFileInfo("https://docs.google.com/drawings/d/draw111/edit", DEFAULT_RULES)).toEqual({
      id: "draw111",
      type: "Drawing",
    });
  });

  test("parses a Google Sites URL", () => {
    expect(extractFileInfo("https://sites.google.com/company/mysite", DEFAULT_RULES)).toEqual({
      id: "mysite",
      type: "Site",
    });
  });

  test("returns null for a plain Google URL", () => {
    expect(extractFileInfo("https://google.com", DEFAULT_RULES)).toBeNull();
  });

  test("returns null for a Google Docs root (no doc ID)", () => {
    expect(extractFileInfo("https://docs.google.com", DEFAULT_RULES)).toBeNull();
  });

  test("returns null for an empty string", () => {
    expect(extractFileInfo("", DEFAULT_RULES)).toBeNull();
  });

  test("returns null for a non-Google URL that resembles a doc path", () => {
    expect(extractFileInfo("https://example.com/document/d/abc123", DEFAULT_RULES)).toBeNull();
  });
});

describe("extractFileInfo with custom rules", () => {
  test("matches a custom rule", () => {
    const rules = [{ id: "r1", label: "Wiki", pattern: "^https://wiki\\.example\\.com/pages/([a-z0-9]+)", enabled: true }];
    expect(extractFileInfo("https://wiki.example.com/pages/abc123", rules)).toEqual({ id: "abc123", type: "Wiki" });
  });

  test("skips disabled rules", () => {
    const rules = [
      { id: "r1", label: "Doc", pattern: "^https://docs\\.google\\.com/document/d/([a-zA-Z0-9_-]+)", enabled: false },
      { id: "r2", label: "AnyDoc", pattern: "^https://docs\\.google\\.com/(.+)", enabled: true },
    ];
    expect(extractFileInfo("https://docs.google.com/document/d/abc123/edit", rules)).toEqual({ id: "document/d/abc123/edit", type: "AnyDoc" });
  });

  test("returns null with empty rules array", () => {
    expect(extractFileInfo("https://docs.google.com/document/d/abc123/edit", [])).toBeNull();
  });

  test("skips rules with invalid regex", () => {
    const rules = [
      { id: "r1", label: "Bad", pattern: "[invalid(", enabled: true },
      { id: "r2", label: "Doc", pattern: "^https://docs\\.google\\.com/document/d/([a-zA-Z0-9_-]+)", enabled: true },
    ];
    expect(extractFileInfo("https://docs.google.com/document/d/abc123/edit", rules)).toEqual({ id: "abc123", type: "Doc" });
  });

  test("matches first rule when multiple could match", () => {
    const rules = [
      { id: "r1", label: "First", pattern: "^https://(.+)", enabled: true },
      { id: "r2", label: "Second", pattern: "^https://docs\\.google\\.com/document/d/([a-zA-Z0-9_-]+)", enabled: true },
    ];
    expect(extractFileInfo("https://docs.google.com/document/d/abc123/edit", rules)?.type).toBe("First");
  });
});
