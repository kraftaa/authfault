import express from "express";
import { instrumentAuthorizer } from "../../src/index.js";

function tenantPolicy({ actor, project }) {
  return actor.role === "admin" || actor.tenantId === project.tenantId;
}

const authorizeDelete = instrumentAuthorizer({
  id: "http.project.delete",
  authorize: tenantPolicy
});

const authorizeArchive = instrumentAuthorizer({
  id: "http.project.archive",
  authorize: tenantPolicy
});

export function createProjectApp() {
  const app = express();
  const projects = new Map([
    ["acme-project", { id: "acme-project", tenantId: "acme", archived: false }],
    ["globex-project", { id: "globex-project", tenantId: "globex", archived: false }]
  ]);

  app.delete("/projects/:id", async (request, response) => {
    const project = projects.get(request.params.id);
    if (!project) return response.sendStatus(404);

    const allowed = await authorizeDelete({ actor: actorFrom(request), project });
    if (!allowed) return response.sendStatus(404);

    projects.delete(project.id);
    return response.sendStatus(204);
  });

  app.post("/projects/:id/archive", async (request, response) => {
    const project = projects.get(request.params.id);
    if (!project) return response.sendStatus(404);

    // Deliberate integration bug: the decision is calculated but not enforced.
    await authorizeArchive({ actor: actorFrom(request), project });
    project.archived = true;
    return response.sendStatus(204);
  });

  return {
    app,
    getProject(id) {
      return projects.get(id);
    }
  };
}

function actorFrom(request) {
  return {
    id: request.get("x-user-id") ?? "anonymous",
    role: request.get("x-user-role") ?? "member",
    tenantId: request.get("x-tenant-id") ?? ""
  };
}
