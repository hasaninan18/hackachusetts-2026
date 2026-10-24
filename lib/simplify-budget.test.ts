// Tests for the SDK-FREE budget/timeout constants (spec: simplify, Task 3 + Task 4).
// This module must stay importable by a "use client" component, so it must have NO imports
// of its own — these tests assert the numeric relationships that keep the server bounded
// and the client coordinated.
import { describe, expect, it } from "vitest";
import {
  BEDROCK_TOTAL_BUDGET_MS,
  CLIENT_TIMEOUT_FLOOR_MS,
  MIN_CALL_MS,
  PER_CALL_TIMEOUT_MS,
  SERVER_TOTAL_BUDGET_MS,
  STUDY_LOAD_BUDGET_MS,
} from "./simplify-budget";

describe("simplify-budget constants", () => {
  it("server total budget = study load + bedrock budget", () => {
    expect(SERVER_TOTAL_BUDGET_MS).toBe(STUDY_LOAD_BUDGET_MS + BEDROCK_TOTAL_BUDGET_MS);
  });

  it("client floor >= server total budget, so the client never gives up before the server", () => {
    expect(CLIENT_TIMEOUT_FLOOR_MS).toBeGreaterThanOrEqual(SERVER_TOTAL_BUDGET_MS);
  });

  it("every timeout is a finite, positive, bounded number (server never hangs)", () => {
    for (const v of [
      PER_CALL_TIMEOUT_MS,
      STUDY_LOAD_BUDGET_MS,
      BEDROCK_TOTAL_BUDGET_MS,
      MIN_CALL_MS,
      SERVER_TOTAL_BUDGET_MS,
      CLIENT_TIMEOUT_FLOOR_MS,
    ]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it("per-call ceiling fits inside the total bedrock budget and leaves room for MIN_CALL_MS", () => {
    expect(PER_CALL_TIMEOUT_MS).toBeLessThanOrEqual(BEDROCK_TOTAL_BUDGET_MS);
    expect(MIN_CALL_MS).toBeLessThan(PER_CALL_TIMEOUT_MS);
  });
});
