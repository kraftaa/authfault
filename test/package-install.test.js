import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

test("the packed package installs and runs in a clean consumer project", () => {
  const directory = mkdtempSync(join(tmpdir(), "authfault-consumer-"));
  const packageDirectory = join(directory, "package");
  const consumerDirectory = join(directory, "consumer");
  const cacheDirectory = join(directory, "npm-cache");

  try {
    mkdirSync(packageDirectory);
    mkdirSync(consumerDirectory);
    const pack = spawnSync(
      npm,
      ["pack", "--pack-destination", packageDirectory],
      {
        encoding: "utf8",
        timeout: 30_000,
        env: { ...process.env, npm_config_cache: cacheDirectory }
      }
    );
    assert.equal(pack.status, 0, pack.stderr);
    const archive = join(
      packageDirectory,
      readdirSync(packageDirectory).find((file) => file.endsWith(".tgz"))
    );

    writeFileSync(
      join(consumerDirectory, "package.json"),
      `${JSON.stringify({
        name: "authfault-consumer-test",
        private: true,
        type: "module",
        scripts: { test: "node --test app.test.js" }
      }, null, 2)}\n`,
      "utf8"
    );
    writeFileSync(
      join(consumerDirectory, "authorization.js"),
      `import { instrumentAuthorizer } from "authfault";

const authorize = instrumentAuthorizer({
  id: "document.read",
  authorize: async () => true
});

export async function readDocument() {
  return (await authorize()) ? "document" : "forbidden";
}
`,
      "utf8"
    );
    writeFileSync(
      join(consumerDirectory, "app.test.js"),
      `import assert from "node:assert/strict";
import { authfaultTest as test } from "authfault/node-test";
import { readDocument } from "./authorization.js";

test("an authorized user reads the document", async () => {
  assert.equal(await readDocument(), "document");
});
`,
      "utf8"
    );

    const environment = {
      ...process.env,
      npm_config_cache: cacheDirectory,
      npm_config_offline: "true"
    };
    const install = spawnSync(
      npm,
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", archive],
      {
        cwd: consumerDirectory,
        encoding: "utf8",
        env: environment,
        timeout: 30_000
      }
    );
    assert.equal(install.status, 0, install.stderr);

    const doctor = spawnSync(npx, ["--no-install", "authfault", "doctor"], {
      cwd: consumerDirectory,
      encoding: "utf8",
      env: environment,
      timeout: 30_000
    });
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.match(doctor.stdout, /observed 1 authorization decision/);
    assert.match(doctor.stdout, /Ready: run npx authfault/);

    const run = spawnSync(
      npx,
      ["--no-install", "authfault", "--max-mutants", "1"],
      {
        cwd: consumerDirectory,
        encoding: "utf8",
        env: environment,
        timeout: 30_000
      }
    );
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /document\.read/);
    assert.match(run.stdout, /PROTECTED \(KILLED\)/);

    const installed = JSON.parse(
      readFileSync(join(consumerDirectory, "node_modules/authfault/package.json"), "utf8")
    );
    assert.equal(installed.name, "authfault");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
