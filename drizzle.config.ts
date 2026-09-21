import { defineConfig } from "drizzle-kit";

if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set — refusing to run drizzle-kit in production without it.");
}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/audiobook",
  },
});
