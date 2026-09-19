import { z } from "zod";

const productionSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  CRM_INTEGRATION_API_KEY: z.string().min(16),
  SALES_BOOTSTRAP_EMAIL: z.string().email().default("sales@guestra.com"),
  SALES_BOOTSTRAP_PASSWORD: z.string().min(8),
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().default("admin@guestra.com"),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(8),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type AppConfig = z.infer<typeof productionSchema>;

export const readConfig = (source: NodeJS.ProcessEnv = process.env): AppConfig => productionSchema.parse(source);

