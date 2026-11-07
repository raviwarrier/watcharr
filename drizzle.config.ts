import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/book-release-tracker.sqlite",
  },
  breakpoints: true,
} satisfies Config;
