import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

// drizzle-kit only reads .env on its own; local credentials live in .env.local (Next.js convention)
config({ path: ['.env.local', '.env'], quiet: true })

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.POSTGRES_URL!,
  },
})
