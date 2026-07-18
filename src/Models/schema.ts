import { pgSchema, varchar, timestamp, bigint, text, jsonb ,boolean, serial} from "drizzle-orm/pg-core";
export const flowspaceSchema = pgSchema("flowspace");

export const users = flowspaceSchema.table("users", {
  id: varchar("id", { length: 255 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  mobile: varchar("mobile", { length: 255 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
  avatarUrl: text("avatarUrl").notNull(),  
  // 10 MB = 10485760 Bytes (BigInt হিসেবে লকিং)
  storageLimit: bigint("storage_limit", { mode: "bigint" })
    .default(10485760n)
    .notNull(),
    
  usedStorage: bigint("used_storage", { mode: "bigint" })
    .default(0n)
    .notNull(),
    
  // API বা অ্যাকশন রিকোয়েস্ট কাউন্টার
  request: bigint("request", { mode: "bigint" })
    .default(0n)
    .notNull(),
    
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});


export const storage = flowspaceSchema.table("storage", {
  id: varchar("id", { length: 255 }).primaryKey(),

  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id), // FK → users.id

  filename: varchar("filename", { length: 255 }).notNull(),

  filepath: text("filepath").notNull(),

  mimetype: varchar("mimetype", { length: 100 }).notNull(),

  size: bigint("size", { mode: "bigint" }).notNull(),

  isPublic: boolean("is_public"), // ফাইল পাবলিক কিনা

  permissions: jsonb("permissions"), // role/user ভিত্তিক access control

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),

  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});


export const requestLog = flowspaceSchema.table("request_log", {
  id: serial("id").primaryKey(), // auto increment integer
  
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id), // FK → users.id

  fileId: varchar("file_id", { length: 255 })
    .notNull()
    .references(() => storage.id), // FK → storage.id

  ipAddress: varchar("ip_address", { length: 50 }), // ইউজারের IP

  userAgent: text("user_agent"), // ব্রাউজার/ডিভাইস তথ্য

  others: jsonb("others"), // অতিরিক্ত তথ্য (headers, query params ইত্যাদি)

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});