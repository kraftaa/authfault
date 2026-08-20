import { readFileSync, writeFileSync } from "node:fs";
import { mutationKey } from "./mutation.js";

export function readSurvivorBaseline(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`survivor baseline not found: ${path}`);
    }
    throw new Error(`could not read survivor baseline ${path}: ${error.message}`);
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.survivors)
  ) {
    throw new Error(`survivor baseline ${path} must have version 1 and a survivors array`);
  }

  const entries = parsed.survivors.map((entry) => {
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof entry.id !== "string" ||
      entry.id.trim() === "" ||
      !["allow", "deny"].includes(entry.decision) ||
      (entry.occurrence !== undefined &&
        (!Number.isInteger(entry.occurrence) || entry.occurrence < 1)) ||
      (entry.testId !== undefined && entry.testId !== null &&
        (typeof entry.testId !== "string" || entry.testId.trim() === ""))
    ) {
      throw new Error(`survivor baseline ${path} contains an invalid survivor entry`);
    }
    return {
      id: entry.id,
      decision: entry.decision,
      reason: entry.reason,
      owner: entry.owner,
      expires: entry.expires,
      ...(entry.occurrence === undefined
        ? {}
        : { occurrence: entry.occurrence, testId: entry.testId ?? null })
    };
  });

  const uniqueEntries = new Map();
  for (const entry of entries) {
    const key = mutationKey(entry);
    if (uniqueEntries.has(key)) {
      throw new Error(
        `survivor baseline ${path} contains a duplicate entry for ${entry.id} (${entry.decision})`
      );
    }
    uniqueEntries.set(key, entry);
  }
  return [...uniqueEntries.values()];
}

export function applySurvivorBaseline(results, baselineEntries, baselinePath) {
  const baselineByKey = new Map(
    baselineEntries.map((entry) => [mutationKey(entry), entry])
  );
  const currentSurvivorKeys = new Set();
  let reviewed = 0;
  let newSurvivors = 0;
  const invalid = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const result of results) {
    if (result.outcome !== "survived") continue;
    const key = mutationKey(result);
    currentSurvivorKeys.add(key);
    const entry = baselineByKey.get(key);
    if (!entry) {
      result.reviewed = false;
      result.reviewStatus = "new";
      result.reviewProblems = [];
      newSurvivors += 1;
      continue;
    }

    const problems = reviewProblems(entry, today);
    result.reviewed = problems.length === 0;
    result.reviewStatus = result.reviewed ? "reviewed" : "invalid";
    result.reviewProblems = problems;
    if (result.reviewed) reviewed += 1;
    else {
      invalid.push({
        id: entry.id,
        decision: entry.decision,
        ...(entry.occurrence
          ? { occurrence: entry.occurrence, testId: entry.testId ?? null }
          : {}),
        problems
      });
    }
  }

  return {
    path: baselinePath,
    reviewed,
    new: newSurvivors,
    invalid,
    stale: baselineEntries.filter(
      (entry) => !currentSurvivorKeys.has(mutationKey(entry))
    )
  };
}

function reviewProblems(entry, today) {
  const problems = [];
  if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
    problems.push("missing review reason");
  }
  if (typeof entry.owner !== "string" || entry.owner.trim() === "") {
    problems.push("missing review owner");
  }
  if (!isDateOnly(entry.expires)) {
    problems.push("missing or invalid expiration date (expected YYYY-MM-DD)");
  } else if (entry.expires < today) {
    problems.push(`review expired on ${entry.expires}`);
  }
  return problems;
}

function isDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function writeSurvivorBaseline(path, results, previousEntries) {
  const previousByKey = new Map(
    previousEntries.map((entry) => [mutationKey(entry), entry])
  );
  const survivors = results
    .filter((result) => result.outcome === "survived")
    .map(({ id, decision, occurrence, testId }) => {
      const identity = { id, decision, occurrence, testId };
      const previous = previousByKey.get(mutationKey(identity));
      return {
        id,
        decision,
        ...(occurrence ? { occurrence, testId: testId ?? null } : {}),
        reason: previous?.reason ?? "",
        owner: previous?.owner ?? "",
        expires: previous?.expires ?? ""
      };
    })
    .sort((left, right) =>
      left.id.localeCompare(right.id) ||
      (left.testId ?? "").localeCompare(right.testId ?? "") ||
      (left.occurrence ?? 0) - (right.occurrence ?? 0) ||
      left.decision.localeCompare(right.decision)
    );
  writeFileSync(path, `${JSON.stringify({ version: 1, survivors }, null, 2)}\n`, "utf8");
}
