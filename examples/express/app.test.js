import assert from "node:assert/strict";
import { once } from "node:events";
import { authfaultTest as test } from "../../src/node-test.js";
import { createProjectApp } from "./app.js";

const acmeHeaders = {
  "x-user-id": "alice",
  "x-user-role": "member",
  "x-tenant-id": "acme"
};

test("an owner can delete a project through HTTP", async () => {
  const projectApp = createProjectApp();

  await withServer(projectApp.app, async (origin) => {
    const response = await fetch(`${origin}/projects/acme-project`, {
      method: "DELETE",
      headers: acmeHeaders
    });

    assert.equal(response.status, 204);
    assert.equal(projectApp.getProject("acme-project"), undefined);
  });
});

test("another tenant cannot delete a project through HTTP", async () => {
  const projectApp = createProjectApp();

  await withServer(projectApp.app, async (origin) => {
    const response = await fetch(`${origin}/projects/globex-project`, {
      method: "DELETE",
      headers: acmeHeaders
    });

    assert.equal(response.status, 404);
    assert.ok(projectApp.getProject("globex-project"));
  });
});

test("archive appears correct on the allowed path despite ignoring authorization", async () => {
  const projectApp = createProjectApp();

  await withServer(projectApp.app, async (origin) => {
    const response = await fetch(`${origin}/projects/acme-project/archive`, {
      method: "POST",
      headers: acmeHeaders
    });

    assert.equal(response.status, 204);
    assert.equal(projectApp.getProject("acme-project").archived, true);
  });
});

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}
