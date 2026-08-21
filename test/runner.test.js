import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("reports killed faults, a survivor, and decision coverage gaps", () => {
  const directory = mkdtempSync(join(tmpdir(), "authfault-runner-test-"));
  const reportFile = join(directory, "report.json");

  try {
    const result = spawnSync(
      process.execPath,
      [
        "./bin/authfault.js",
        "--json",
        reportFile,
        "--",
        process.execPath,
        "--test",
        "examples/multitenant/app.test.js"
      ],
      { encoding: "utf8" }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /project\.secure-delete/);
    assert.match(result.stdout, /PROTECTED \(KILLED\): force allowed decisions to deny/);
    assert.match(result.stdout, /PROTECTED \(KILLED\): force denied decisions to allow/);
    assert.match(result.stdout, /confirmed by 2 failing mutation run\(s\)/);
    assert.match(result.stdout, /project\.ignored-delete/);
    assert.match(result.stdout, /ENFORCEMENT GAP \(SURVIVED\): force allowed decisions to deny/);
    assert.match(result.stdout, /tests did not detect a forced deny/);
    assert.match(
      result.stdout,
      /REVIEW NEEDED \(SURVIVED WITH POSSIBLE COMPENSATING CONTROL\): force denied decisions to allow/
    );
    assert.match(result.stdout, /tests did not detect a forced allow/);
    assert.match(result.stdout, /another denial observed at: project\.layered-service/);
    assert.match(result.stdout, /MISSING COVERAGE: no denied decision was observed/);
    assert.match(result.stdout, /reran 1 attributed test\(s\)/);

    const report = JSON.parse(readFileSync(reportFile, "utf8"));
    const secureDelete = report.points.find(
      (point) => point.id === "project.secure-delete"
    );
    assert.match(
      secureDelete.allowTests[0],
      /^examples\/multitenant\/app\.test\.js::project operations > secure delete allows the owning tenant$/
    );
    const layeredRouteMutation = report.results.find(
      (mutation) =>
        mutation.id === "project.layered-route" && mutation.decision === "allow"
    );
    assert.deepEqual(layeredRouteMutation.possibleCompensatingControls, [
      "project.layered-service"
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("marks a failing isolated control as inconclusive", () => {
  const result = runFixture("test/fixtures/inconclusive.test.js");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /COULD NOT VERIFY \(INCONCLUSIVE\): force allowed decisions to deny/);
  assert.match(result.stdout, /reason: the isolated control run failed/);
});

test("marks inconsistent confirmation runs as flaky", () => {
  const directory = mkdtempSync(join(tmpdir(), "authfault-flaky-test-"));
  const counterFile = join(directory, "counter.txt");

  try {
    const result = runFixture("test/fixtures/flaky.test.js", {
      AUTHFAULT_FLAKY_COUNTER: counterFile
    });

    assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /UNSTABLE RESULT \(FLAKY\): force allowed decisions to deny/);
    assert.match(result.stdout, /0 killed, 0 survived, 0 inconclusive, 1 flaky/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runs npm test by default", () => {
  const directory = mkdtempSync(join(tmpdir(), "authfault-default-test-"));
  const fixture = resolve("test/fixtures/unattributed.test.js");
  const cli = resolve("bin/authfault.js");

  try {
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify({
        type: "module",
        scripts: { test: `node --test ${JSON.stringify(fixture)}` }
      }, null, 2)}\n`
    );
    const result = spawnSync(process.execPath, [cli], {
      cwd: directory,
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /unattributed\.read/);
    assert.match(result.stdout, /PROTECTED \(KILLED\)/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("refuses a recursive default npm test script", () => {
  const directory = mkdtempSync(join(tmpdir(), "authfault-recursion-test-"));
  const cli = resolve("bin/authfault.js");

  try {
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify({ scripts: { test: "npx authfault --fail-on-gap" } })}\n`
    );
    const result = spawnSync(process.execPath, [cli], {
      cwd: directory,
      encoding: "utf8"
    });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /launches authfault recursively/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("prints a runner-aware setup guide", () => {
  const result = spawnSync(process.execPath, ["./bin/authfault.js", "init"], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Detected: Vitest/);
  assert.match(result.stdout, /instrumentAuthorizer/);
  assert.match(result.stdout, /npx authfault/);
});

test("supports the plain-language fail-on-gap alias", () => {
  const result = runWithOptions(
    ["--fail-on-gap"],
    "test/fixtures/survivor.test.js"
  );

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /ENFORCEMENT GAP \(SURVIVED\)/);
});

test("writes a GitHub Actions summary and annotations", () => {
  const directory = mkdtempSync(join(tmpdir(), "authfault-github-report-"));
  const summaryFile = join(directory, "summary.md");

  try {
    const result = runWithOptions(
      ["--reporter", "github"],
      "test/fixtures/survivor.test.js",
      { GITHUB_STEP_SUMMARY: summaryFile }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /GitHub Actions summary written/);
    assert.match(result.stdout, /::warning title=AuthFault enforcement gap::/);
    const summary = readFileSync(summaryFile, "utf8");
    assert.match(summary, /## AuthFault authorization test/);
    assert.match(summary, /1 enforcement gap/);
    assert.match(summary, /`reviewed\.ignored-check`/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runFixture(file, environment = {}) {
  return spawnSync(
    process.execPath,
    ["./bin/authfault.js", "--", process.execPath, "--test", file],
    {
      encoding: "utf8",
      env: { ...process.env, ...environment }
    }
  );
}

test("falls back to the full command for unattributed decisions", () => {
  const result = spawnSync(
    process.execPath,
    [
      "./bin/authfault.js",
      "--",
      process.execPath,
      "--test",
      "test/fixtures/unattributed.test.js"
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /reran the full test command \(unattributed decisions present\)/
  );
});

test("refuses production mode unless explicitly overridden", () => {
  const result = runFixture("test/fixtures/unattributed.test.js", {
    NODE_ENV: "production"
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /refusing to inject authorization faults/);
});

test("propagates an explicit production override to the runtime", () => {
  const result = spawnSync(
    process.execPath,
    [
      "./bin/authfault.js",
      "--allow-production",
      "--",
      process.execPath,
      "--test",
      "test/fixtures/unattributed.test.js"
    ],
    {
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "production" }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /unattributed\.read/);
});

test("runs an argv-safe reset command before every test execution", () => {
  const directory = mkdtempSync(join(tmpdir(), "authfault-reset-test-"));
  const counterFile = join(directory, "counter.txt");

  try {
    const resetCommand = JSON.stringify([
      process.execPath,
      "test/fixtures/reset.js"
    ]);
    const result = spawnSync(
      process.execPath,
      [
        "./bin/authfault.js",
        "--reset-command",
        resetCommand,
        "--",
        process.execPath,
        "--test",
        "test/fixtures/unattributed.test.js"
      ],
      {
        encoding: "utf8",
        env: { ...process.env, AUTHFAULT_RESET_COUNTER: counterFile }
      }
    );

    assert.equal(result.status, 0, result.stderr);
    const resets = readFileSync(counterFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(resets.length, 4);
    assert.deepEqual(resets[0], {
      phase: "baseline",
      pointId: null,
      decision: null
    });
    assert.deepEqual(resets[1], {
      phase: "control",
      pointId: "unattributed.read",
      decision: null
    });
    assert.deepEqual(resets.slice(2), [
      {
        phase: "mutation",
        pointId: "unattributed.read",
        decision: "deny"
      },
      {
        phase: "mutation",
        pointId: "unattributed.read",
        decision: "deny"
      }
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("targets nested Vitest tests through the Vitest adapter", () => {
  const directory = mkdtempSync(join(tmpdir(), "authfault-vitest-test-"));
  const reportFile = join(directory, "report.json");

  try {
    const result = spawnSync(
      process.execPath,
      [
        "./bin/authfault.js",
        "--json",
        reportFile,
        "--",
        "./node_modules/.bin/vitest",
        "run",
        "test/fixtures/vitest-adapter.test.js"
      ],
      { encoding: "utf8" }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /vitest\.document-read/);
    assert.match(result.stdout, /reran 1 attributed test\(s\)/);

    const report = JSON.parse(readFileSync(reportFile, "utf8"));
    assert.deepEqual(report.configuration, { granularity: "point" });
    assert.deepEqual(report.points[0].allowTests, [
      "test/fixtures/vitest-adapter.test.js::document access > allows the owner"
    ]);
    assert.equal(report.results[0].outcome, "killed");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runs both Cedar structured-decision mutations end to end", () => {
  const result = runFixture("test/fixtures/cedar-codec.test.js");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /cedar\.document-read/);
  assert.match(result.stdout, /observed allow: 1/);
  assert.match(result.stdout, /observed deny:  1/);
  assert.match(result.stdout, /PROTECTED \(KILLED\): force allowed decisions to deny/);
  assert.match(result.stdout, /PROTECTED \(KILLED\): force denied decisions to allow/);
});

test("isolates individual calls in occurrence granularity", () => {
  const directory = mkdtempSync(join(tmpdir(), "authfault-occurrence-test-"));
  const baselineFile = join(directory, "survivors.json");

  try {
    const result = runWithOptions(
      ["--granularity", "occurrence", "--write-baseline", baselineFile],
      "test/fixtures/occurrence.test.js"
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /occurrence 1 in .*occurrence\.test\.js/);
    assert.match(result.stdout, /occurrence 2 in .*occurrence\.test\.js/);
    assert.match(result.stdout, /occurrence 3 in .*occurrence\.test\.js/);
    assert.match(
      result.stdout,
      /Summary: 1 points, 3 faults, 1 killed, 2 survived/
    );

    const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
    assert.deepEqual(
      baseline.survivors.map(({ occurrence, testId }) => ({ occurrence, testId })),
      [
        {
          occurrence: 2,
          testId: "test/fixtures/occurrence.test.js::only checks the first decision in a three-item batch"
        },
        {
          occurrence: 3,
          testId: "test/fixtures/occurrence.test.js::only checks the first decision in a three-item batch"
        }
      ]
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("baselines reviewed survivors and still fails for new or stale entries", () => {
  const directory = mkdtempSync(join(tmpdir(), "authfault-baseline-test-"));
  const baselineFile = join(directory, "survivors.json");
  const reportFile = join(directory, "report.json");

  try {
    const generated = runWithOptions(
      ["--write-baseline", baselineFile],
      "test/fixtures/survivor.test.js"
    );
    assert.equal(generated.status, 0, generated.stderr);
    assert.deepEqual(JSON.parse(readFileSync(baselineFile, "utf8")), {
      version: 1,
      survivors: [
        {
          id: "reviewed.ignored-check",
          decision: "deny",
          reason: "",
          owner: "",
          expires: ""
        }
      ]
    });

    const unsafeOverwrite = runWithOptions(
      ["--write-baseline", baselineFile],
      "test/fixtures/survivor.test.js"
    );
    assert.equal(unsafeOverwrite.status, 2);
    assert.match(unsafeOverwrite.stderr, /refusing to overwrite an existing survivor baseline/);

    const incompleteReview = runWithOptions(
      ["--baseline", baselineFile, "--fail-on-survivor"],
      "test/fixtures/survivor.test.js"
    );
    assert.equal(incompleteReview.status, 1, incompleteReview.stderr);
    assert.match(incompleteReview.stdout, /SURVIVED\) — REVIEW INCOMPLETE/);
    assert.match(incompleteReview.stdout, /missing review reason/);
    assert.match(
      incompleteReview.stdout,
      /Survivors: 0 new, 1 invalid review, 0 reviewed/
    );

    const validEntry = {
      id: "reviewed.ignored-check",
      decision: "deny",
      reason: "The downstream service independently enforces ownership",
      owner: "security@example.test",
      expires: "2999-12-31"
    };
    writeFileSync(
      baselineFile,
      `${JSON.stringify({ version: 1, survivors: [validEntry] })}\n`,
      "utf8"
    );
    const reviewed = runWithOptions(
      [
        "--baseline",
        baselineFile,
        "--write-baseline",
        baselineFile,
        "--fail-on-survivor",
        "--json",
        reportFile
      ],
      "test/fixtures/survivor.test.js"
    );
    assert.equal(reviewed.status, 0, reviewed.stderr);
    assert.match(reviewed.stdout, /SURVIVED\) — REVIEWED/);
    assert.match(
      reviewed.stdout,
      /Survivors: 0 new, 0 invalid review, 1 reviewed/
    );
    assert.deepEqual(
      JSON.parse(readFileSync(baselineFile, "utf8")).survivors,
      [validEntry]
    );
    const report = JSON.parse(readFileSync(reportFile, "utf8"));
    assert.equal(report.results[0].reviewed, true);
    assert.deepEqual(report.baseline, {
      path: baselineFile,
      reviewed: 1,
      new: 0,
      invalid: [],
      stale: []
    });

    writeFileSync(
      baselineFile,
      `${JSON.stringify({
        version: 1,
        survivors: [{ ...validEntry, expires: "2000-01-01" }]
      })}\n`,
      "utf8"
    );
    const expired = runWithOptions(
      ["--baseline", baselineFile, "--fail-on-survivor"],
      "test/fixtures/survivor.test.js"
    );
    assert.equal(expired.status, 1, expired.stderr);
    assert.match(expired.stdout, /SURVIVED\) — REVIEW EXPIRED/);
    assert.match(expired.stdout, /review expired on 2000-01-01/);

    writeFileSync(
      baselineFile,
      `${JSON.stringify({
        version: 1,
        survivors: [{
          id: "removed.point",
          decision: "allow",
          reason: "Legacy defense in depth",
          owner: "security@example.test",
          expires: "2999-12-31"
        }]
      })}\n`,
      "utf8"
    );
    const changed = runWithOptions(
      ["--baseline", baselineFile, "--fail-on-survivor"],
      "test/fixtures/survivor.test.js"
    );
    assert.equal(changed.status, 1, changed.stderr);
    assert.match(
      changed.stdout,
      /Survivors: 1 new, 0 invalid review, 0 reviewed/
    );
    assert.match(changed.stdout, /STALE BASELINE: 1 baseline entry/);
    assert.match(changed.stdout, /removed\.point: force allow/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("refuses to write incomplete survivor baselines", () => {
  const directory = mkdtempSync(join(tmpdir(), "authfault-incomplete-baseline-"));
  const baselineFile = join(directory, "survivors.json");

  try {
    const inconclusive = runWithOptions(
      ["--write-baseline", baselineFile],
      "test/fixtures/inconclusive.test.js"
    );
    assert.equal(inconclusive.status, 2);
    assert.match(inconclusive.stderr, /baseline was not written/);
    assert.equal(existsSync(baselineFile), false);

    const limited = runWithOptions(
      ["--write-baseline", baselineFile, "--max-mutants", "1"],
      "test/fixtures/survivor.test.js"
    );
    assert.equal(limited.status, 2);
    assert.match(
      limited.stderr,
      /--max-mutants cannot be combined with survivor baseline options/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runWithOptions(options, file, environment = {}) {
  return spawnSync(
    process.execPath,
    [
      "./bin/authfault.js",
      ...options,
      "--",
      process.execPath,
      "--test",
      file
    ],
    {
      encoding: "utf8",
      env: { ...process.env, ...environment }
    }
  );
}
