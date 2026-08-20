import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();
const SELECTED_TESTS_ENV = "AUTHFAULT_SELECTED_TESTS";
const unattributedOccurrences = new Map();

export function runInTestContext(testId, callback) {
  return storage.run({ testId, decisionOccurrences: new Map() }, callback);
}

export function currentTestId() {
  return storage.getStore()?.testId ?? null;
}

export function nextDecisionOccurrence(pointId) {
  const occurrences =
    storage.getStore()?.decisionOccurrences ?? unattributedOccurrences;
  const occurrence = (occurrences.get(pointId) ?? 0) + 1;
  occurrences.set(pointId, occurrence);
  return occurrence;
}

export function isTestSelected(testId) {
  const encoded = process.env[SELECTED_TESTS_ENV];
  if (!encoded) {
    return true;
  }

  let selected;
  try {
    selected = JSON.parse(encoded);
  } catch (error) {
    throw new Error(`${SELECTED_TESTS_ENV} must contain valid JSON`, {
      cause: error
    });
  }

  if (!Array.isArray(selected) || selected.some((item) => typeof item !== "string")) {
    throw new Error(`${SELECTED_TESTS_ENV} must contain a JSON array of test IDs`);
  }

  return selected.includes(testId);
}

export const selectedTestsEnvironmentVariable = SELECTED_TESTS_ENV;
