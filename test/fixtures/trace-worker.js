import { instrumentAuthorizer } from "../../src/index.js";

const authorize = instrumentAuthorizer({
  id: process.argv[2],
  authorize: async () => true
});

for (let index = 0; index < 50; index += 1) {
  await authorize();
}
