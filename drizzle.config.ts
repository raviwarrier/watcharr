import type { Config } from "drizzle-kit";

// Honors DB_DIR so the install script and the app point at the same database.
const dbDir = process.env.DB_DIR ?? "./data";

export default {
  schema: "./src/db/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: `${dbDir}/book-release-tracker.sqlite`,
  },
  breakpoints: true,
} satisfies Config;
