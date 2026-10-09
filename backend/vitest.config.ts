import { randomBytes } from "node:crypto";

// Test-only configuration. Production secrets must be independently generated.
export default {
  test: {
    env: {
      SOCIAL_AUTH_SECRET: randomBytes(32).toString("hex"),
    },
  },
};
