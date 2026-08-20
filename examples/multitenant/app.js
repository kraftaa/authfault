import {
  authfaultOperation,
  instrumentAuthorizer
} from "../../src/index.js";

function policy({ actor, project }) {
  return actor.role === "admin" || actor.tenantId === project.tenantId;
}

const secureDeleteAuthorization = instrumentAuthorizer({
  id: "project.secure-delete",
  authorize: policy
});

const ignoredDeleteAuthorization = instrumentAuthorizer({
  id: "project.ignored-delete",
  authorize: policy
});

const renameAuthorization = instrumentAuthorizer({
  id: "project.rename",
  authorize: policy
});

const layeredRouteAuthorization = instrumentAuthorizer({
  id: "project.layered-route",
  authorize: policy
});

const layeredServiceAuthorization = instrumentAuthorizer({
  id: "project.layered-service",
  authorize: policy
});

export function createProjectService() {
  const projects = new Map([
    ["acme-project", { id: "acme-project", tenantId: "acme", name: "Acme" }],
    ["globex-project", { id: "globex-project", tenantId: "globex", name: "Globex" }]
  ]);

  return {
    hasProject(id) {
      return projects.has(id);
    },

    getProject(id) {
      return projects.get(id);
    },

    async secureDelete(actor, id) {
      const project = projects.get(id);
      if (!project) return 404;

      const allowed = await secureDeleteAuthorization({ actor, project });
      if (!allowed) return 404;

      projects.delete(id);
      return 204;
    },

    async ignoredDelete(actor, id) {
      const project = projects.get(id);
      if (!project) return 404;

      // Deliberate sample bug: the decision is calculated but never enforced.
      await ignoredDeleteAuthorization({ actor, project });
      projects.delete(id);
      return 204;
    },

    async rename(actor, id, name) {
      const project = projects.get(id);
      if (!project) return 404;

      const allowed = await renameAuthorization({ actor, project });
      if (!allowed) return 404;

      project.name = name;
      return 204;
    },

    async layeredDelete(actor, id) {
      return authfaultOperation("project.layered-delete", async () => {
        const project = projects.get(id);
        if (!project) return 404;

        const routeAllowed = await layeredRouteAuthorization({ actor, project });
        if (!routeAllowed) return 404;

        const serviceAllowed = await layeredServiceAuthorization({ actor, project });
        if (!serviceAllowed) return 404;

        projects.delete(id);
        return 204;
      });
    }
  };
}
