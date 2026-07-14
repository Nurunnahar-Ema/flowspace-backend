import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/Models/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:  "postgresql://postgres:gsjfaAS9*+-_@db.bkcsykkrcingzlhqcgll.supabase.co:5432/postgres",
  },
});