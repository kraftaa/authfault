export function mutationKey({
  id,
  decision,
  occurrence = null,
  testId = null
}) {
  return JSON.stringify([id, decision, testId, occurrence]);
}

export function summarizePoints(events) {
  const byId = new Map();
  for (const event of events) {
    const point = byId.get(event.id) ?? {
      id: event.id,
      allowCount: 0,
      denyCount: 0,
      allowTests: new Set(),
      denyTests: new Set(),
      unattributedAllowCount: 0,
      unattributedDenyCount: 0
    };
    if (event.originalAllowed) {
      point.allowCount += 1;
      if (event.testId) point.allowTests.add(event.testId);
      else point.unattributedAllowCount += 1;
    } else {
      point.denyCount += 1;
      if (event.testId) point.denyTests.add(event.testId);
      else point.unattributedDenyCount += 1;
    }
    byId.set(event.id, point);
  }

  return [...byId.values()]
    .map((point) => ({
      ...point,
      allowTests: [...point.allowTests].sort(),
      denyTests: [...point.denyTests].sort()
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function planMutations(points, events, granularity) {
  if (granularity === "occurrence") return planOccurrenceMutations(events);

  const mutations = [];
  for (const point of points) {
    if (point.allowCount > 0) {
      mutations.push({
        id: point.id,
        decision: "deny",
        fault: "force allowed decisions to deny",
        tests: point.allowTests,
        targeted: point.unattributedAllowCount === 0 && point.allowTests.length > 0
      });
    }
    if (point.denyCount > 0) {
      mutations.push({
        id: point.id,
        decision: "allow",
        fault: "force denied decisions to allow",
        tests: point.denyTests,
        targeted: point.unattributedDenyCount === 0 && point.denyTests.length > 0
      });
    }
  }
  return mutations;
}

function planOccurrenceMutations(events) {
  const mutations = new Map();
  for (const event of events) {
    if (!Number.isInteger(event.occurrence) || event.occurrence < 1) continue;
    const decision = event.originalAllowed ? "deny" : "allow";
    const mutation = {
      id: event.id,
      decision,
      fault: event.originalAllowed
        ? "force allowed decision to deny"
        : "force denied decision to allow",
      tests: event.testId ? [event.testId] : [],
      targeted: Boolean(event.testId),
      occurrence: event.occurrence,
      testId: event.testId ?? null
    };
    mutations.set(mutationKey(mutation), mutation);
  }

  return [...mutations.values()].sort((left, right) =>
    left.id.localeCompare(right.id) ||
    (left.testId ?? "").localeCompare(right.testId ?? "") ||
    left.occurrence - right.occurrence ||
    left.decision.localeCompare(right.decision)
  );
}

export function findPossibleCompensatingControls(events, mutation) {
  if (mutation.decision !== "allow") return [];
  const targetOperations = new Set(
    events
      .filter((event) =>
        event.id === mutation.id && event.mutation === "allow" && event.operationId
      )
      .map((event) => `${event.testId ?? ""}\0${event.operationId}`)
  );

  return [...new Set(
    events
      .filter((event) =>
        event.id !== mutation.id &&
        event.effectiveAllowed === false &&
        event.operationId &&
        targetOperations.has(`${event.testId ?? ""}\0${event.operationId}`)
      )
      .map((event) => event.id)
  )].sort();
}
