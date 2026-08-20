import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mutationKey,
  planMutations,
  summarizePoints
} from "../src/runner/mutation.js";

const events = [
  {
    id: "document.read",
    originalAllowed: true,
    testId: "documents.test.js::owner reads",
    occurrence: 1
  },
  {
    id: "document.read",
    originalAllowed: true,
    testId: "documents.test.js::owner reads",
    occurrence: 2
  },
  {
    id: "document.read",
    originalAllowed: false,
    testId: "documents.test.js::stranger is denied",
    occurrence: 1
  }
];

test("plans point-wide and occurrence mutations from the same trace", () => {
  const points = summarizePoints(events);
  const pointMutations = planMutations(points, events, "point");
  const occurrenceMutations = planMutations(points, events, "occurrence");

  assert.equal(pointMutations.length, 2);
  assert.deepEqual(
    pointMutations.map(({ decision, tests }) => ({ decision, tests })),
    [
      { decision: "deny", tests: ["documents.test.js::owner reads"] },
      { decision: "allow", tests: ["documents.test.js::stranger is denied"] }
    ]
  );
  assert.deepEqual(
    occurrenceMutations.map(({ decision, occurrence, testId }) => ({
      decision,
      occurrence,
      testId
    })),
    [
      {
        decision: "deny",
        occurrence: 1,
        testId: "documents.test.js::owner reads"
      },
      {
        decision: "deny",
        occurrence: 2,
        testId: "documents.test.js::owner reads"
      },
      {
        decision: "allow",
        occurrence: 1,
        testId: "documents.test.js::stranger is denied"
      }
    ]
  );
});

test("mutation identity includes occurrence scope", () => {
  assert.notEqual(
    mutationKey({
      id: "document.read",
      decision: "deny",
      testId: "documents.test.js::owner reads",
      occurrence: 1
    }),
    mutationKey({
      id: "document.read",
      decision: "deny",
      testId: "documents.test.js::owner reads",
      occurrence: 2
    })
  );
});
