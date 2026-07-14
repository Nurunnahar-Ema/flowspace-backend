// src/index.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export const getDb = (url: string) => {
  const queryClient = postgres(url);
  return drizzle(queryClient);
};