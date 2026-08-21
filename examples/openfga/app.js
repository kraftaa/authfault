import { OpenFgaClient } from "@openfga/sdk";
import { instrumentOpenFgaClient } from "../../src/index.js";

export function createOpenFgaClient(options) {
  return instrumentOpenFgaClient({
    client: new OpenFgaClient(options),
    // Prefer an application operation ID over the broader default
    // `openfga.document.viewer` when this client serves several workflows.
    id: "document.view"
  });
}

export async function viewDocument(client, actorId, documentId) {
  const { allowed } = await client.check({
    user: `user:${actorId}`,
    relation: "viewer",
    object: `document:${documentId}`
  });

  return allowed ? 200 : 404;
}
