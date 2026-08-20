import assert from "node:assert/strict";
import { describe } from "node:test";
import { authfaultTest as test } from "../../src/node-test.js";
import { createProjectService } from "./app.js";

const acmeMember = { id: "alice", role: "member", tenantId: "acme" };

describe("project operations", () => {
  test("secure delete allows the owning tenant", async () => {
    const projects = createProjectService();

    assert.equal(await projects.secureDelete(acmeMember, "acme-project"), 204);
    assert.equal(projects.hasProject("acme-project"), false);
  });

  test("secure delete rejects another tenant", async () => {
    const projects = createProjectService();

    assert.equal(await projects.secureDelete(acmeMember, "globex-project"), 404);
    assert.equal(projects.hasProject("globex-project"), true);
  });

  test("ignored delete appears correct on an allowed path", async () => {
    const projects = createProjectService();

    assert.equal(await projects.ignoredDelete(acmeMember, "acme-project"), 204);
    assert.equal(projects.hasProject("acme-project"), false);
  });

  test("rename has a positive test but no negative coverage", async () => {
    const projects = createProjectService();

    assert.equal(await projects.rename(acmeMember, "acme-project", "Renamed"), 204);
    assert.equal(projects.getProject("acme-project").name, "Renamed");
  });

  test("layered delete allows the owning tenant", async () => {
    const projects = createProjectService();

    assert.equal(await projects.layeredDelete(acmeMember, "acme-project"), 204);
    assert.equal(projects.hasProject("acme-project"), false);
  });

  test("layered delete rejects another tenant", async () => {
    const projects = createProjectService();

    assert.equal(await projects.layeredDelete(acmeMember, "globex-project"), 404);
    assert.equal(projects.hasProject("globex-project"), true);
  });
});
