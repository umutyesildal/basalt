import { randomBytes } from "node:crypto";

// Schemas do not isolate database-wide advisory locks. Run SQL files serially;
// each test still exercises its own explicit concurrent transactions.
const postgresTests = Boolean(process.env.BASKET_RETURNS_TEST_DATABASE_URL ||
  process.env.POSITION_EVENTS_TEST_DATABASE_URL || process.env.INDEXER_HISTORY_TEST_DATABASE_URL);

// Test-only configuration. Production secrets must be independently generated.
export default {
  test: {
    fileParallelism: !postgresTests,
    env: {
      SOCIAL_AUTH_SECRET: randomBytes(32).toString("hex"),
    },
  },
};
