import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  authfaultOperation,
  environment,
  instrumentAuthorizer
} from "../src/index.js";
import { runInTestContext } from "../src/test-context.js";

test("preserves boolean decisions without a mutation", async () => {
  const authorize = instrumentAuthorizer({
    id: "document.read",
    authorize: async () => true
  });

  assert.equal(await authorize({}), true);
});

test("forces a matching decision and preserves object results", async () => {
  const previous = process.env[environment.mutation];
  process.env[environment.mutation] = JSON.stringify({
    id: "document.read",
    decision: "deny"
  });

  try {
    const authorize = instrumentAuthorizer({
      id: "document.read",
      authorize: async () => ({ allowed: true, reason: "owner" })
    });

    assert.deepEqual(await authorize({}), {
      allowed: false,
      reason: "owner"
    });
  } finally {
    restoreEnvironment(environment.mutation, previous);
  }
});

test("refuses direct runtime mutation in production", async () => {
  const previousMutation = process.env[environment.mutation];
  const previousNodeEnvironment = process.env.NODE_ENV;
  const previousOverride = process.env[environment.allowProduction];
  process.env.NODE_ENV = "production";
  delete process.env[environment.allowProduction];
  process.env[environment.mutation] = JSON.stringify({
    id: "document.read",
    decision: "allow"
  });

  try {
    const authorize = instrumentAuthorizer({
      id: "document.read",
      authorize: async () => false
    });
    await assert.rejects(authorize(), /refuses to apply mutations/);
  } finally {
    restoreEnvironment(environment.mutation, previousMutation);
    restoreEnvironment("NODE_ENV", previousNodeEnvironment);
    restoreEnvironment(environment.allowProduction, previousOverride);
  }
});

test("records minimal decision metadata without request data", async () => {
  const directory = mkdtempSync(join(tmpdir(), "authfault-runtime-test-"));
  const traceFile = join(directory, "trace.jsonl");
  const previous = process.env[environment.traceFile];
  process.env[environment.traceFile] = traceFile;

  try {
    const authorize = instrumentAuthorizer({
      id: "invoice.export",
      authorize: async () => false
    });

    await authorize({ secret: "must-not-be-recorded" });
    const event = JSON.parse(readFileSync(traceFile, "utf8").trim());

    assert.equal(event.id, "invoice.export");
    assert.equal(event.originalAllowed, false);
    assert.equal(event.effectiveAllowed, false);
    assert.equal(event.occurrence, 1);
    assert.equal(event.secret, undefined);
  } finally {
    restoreEnvironment(environment.traceFile, previous);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("targets one decision occurrence without changing adjacent calls", async () => {
  const previous = process.env[environment.mutation];
  process.env[environment.mutation] = JSON.stringify({
    id: "batch.occurrence-runtime",
    decision: "deny",
    occurrence: 2
  });

  try {
    const authorize = instrumentAuthorizer({
      id: "batch.occurrence-runtime",
      authorize: async () => true
    });

    assert.equal(await authorize(), true);
    assert.equal(await authorize(), false);
    assert.equal(await authorize(), true);
  } finally {
    restoreEnvironment(environment.mutation, previous);
  }
});

test("writes per-process traces and correlates decisions in an operation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "authfault-operation-test-"));
  const previous = process.env[environment.traceDirectory];
  process.env[environment.traceDirectory] = directory;

  try {
    const first = instrumentAuthorizer({
      id: "invoice.route",
      authorize: async () => true
    });
    const second = instrumentAuthorizer({
      id: "invoice.service",
      authorize: async () => false
    });

    await authfaultOperation("invoice.refund", async () => {
      await first({ secret: "not traced" });
      await second({ secret: "also not traced" });
    });

    const traceFile = join(directory, `${process.pid}.jsonl`);
    const events = readFileSync(traceFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    assert.equal(events.length, 2);
    assert.equal(events[0].operationName, "invoice.refund");
    assert.equal(events[0].operationId, events[1].operationId);
    assert.equal(events[0].secret, undefined);
  } finally {
    restoreEnvironment(environment.traceDirectory, previous);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("parallel processes write complete independent trace files", async () => {
  const directory = mkdtempSync(join(tmpdir(), "authfault-parallel-test-"));

  try {
    const environment = {
      ...process.env,
      AUTHFAULT_TRACE_FILE: undefined,
      AUTHFAULT_TRACE_DIR: directory
    };
    await Promise.all([
      spawnSuccessful(process.execPath, ["test/fixtures/trace-worker.js", "worker.one"], environment),
      spawnSuccessful(process.execPath, ["test/fixtures/trace-worker.js", "worker.two"], environment)
    ]);

    const files = readdirSync(directory).filter((file) => file.endsWith(".jsonl"));
    assert.equal(files.length, 2);
    const events = files.flatMap((file) =>
      readFileSync(join(directory, file), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    );
    assert.equal(events.length, 100);
    assert.deepEqual(
      [...new Set(events.map((event) => event.id))].sort(),
      ["worker.one", "worker.two"]
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("concurrent test contexts number occurrences independently", async () => {
  const directory = mkdtempSync(join(tmpdir(), "authfault-context-occurrence-"));
  const previous = process.env[environment.traceDirectory];
  process.env[environment.traceDirectory] = directory;

  try {
    const authorize = instrumentAuthorizer({
      id: "concurrent.read",
      authorize: async () => true
    });

    await Promise.all([
      runInTestContext("test-a", () => Promise.all([authorize(), authorize()])),
      runInTestContext("test-b", () => Promise.all([authorize(), authorize()]))
    ]);

    const events = readFileSync(join(directory, `${process.pid}.jsonl`), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const occurrences = {};
    for (const event of events) {
      (occurrences[event.testId] ??= []).push(event);
    }
    assert.deepEqual(
      occurrences["test-a"].map((event) => event.occurrence).sort(),
      [1, 2]
    );
    assert.deepEqual(
      occurrences["test-b"].map((event) => event.occurrence).sort(),
      [1, 2]
    );
  } finally {
    restoreEnvironment(environment.traceDirectory, previous);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("supports explicit throw-on-deny guards", async () => {
  class ForbiddenError extends Error {}
  const previous = process.env[environment.mutation];

  const requirePermission = instrumentAuthorizer({
    id: "invoice.refund",
    authorize: async ({ permitted }) => {
      if (!permitted) throw new ForbiddenError("forbidden");
    },
    denialErrors: {
      isDenied: (error) => error instanceof ForbiddenError,
      createDenied: () => new ForbiddenError("injected denial")
    }
  });

  await requirePermission({ permitted: true });
  await assert.rejects(
    requirePermission({ permitted: false }),
    ForbiddenError
  );

  try {
    process.env[environment.mutation] = JSON.stringify({
      id: "invoice.refund",
      decision: "allow"
    });
    await requirePermission({ permitted: false });

    process.env[environment.mutation] = JSON.stringify({
      id: "invoice.refund",
      decision: "deny"
    });
    await assert.rejects(
      requirePermission({ permitted: true }),
      /injected denial/
    );
  } finally {
    restoreEnvironment(environment.mutation, previous);
  }
});

test("does not classify unrelated authorizer errors as denials", async () => {
  class ForbiddenError extends Error {}
  class DatabaseError extends Error {}

  const requirePermission = instrumentAuthorizer({
    id: "invoice.read",
    authorize: async () => {
      throw new DatabaseError("database unavailable");
    },
    denialErrors: {
      isDenied: (error) => error instanceof ForbiddenError,
      createDenied: () => new ForbiddenError("injected denial")
    }
  });

  await assert.rejects(requirePermission({}), DatabaseError);
});

function restoreEnvironment(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function spawnSuccessful(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: environment });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`child exited with code ${code} and signal ${signal}`));
    });
  });
}
