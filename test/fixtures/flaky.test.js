import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { instrumentAuthorizer } from "../../src/index.js";
import { authfaultTest as test } from "../../src/node-test.js";

const authorize = instrumentAuthorizer({
  id: "flaky.delete",
  authorize: async () => true
});

test("inconsistent mutation result is not credited as killed", async () => {
  const allowed = await authorize();
  const counterFile = process.env.AUTHFAULT_FLAKY_COUNTER;

  if (process.env.AUTHFAULT_MUTATION && counterFile) {
    const count = existsSync(counterFile)
      ? Number.parseInt(readFileSync(counterFile, "utf8"), 10)
      : 0;
    writeFileSync(counterFile, String(count + 1), "utf8");

    if (count === 0) {
      assert.equal(allowed, true);
    } else {
      assert.equal(allowed, false);
    }
    return;
  }

  assert.equal(allowed, true);
});
