import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const bindersTable = pgTable("binders", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  setCode: text("set_code").notNull(),
  setTotal: integer("set_total").notNull(),
  coverImageUrl: text("cover_image_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertBinderSchema = createInsertSchema(bindersTable).omit({ id: true, createdAt: true });
export type InsertBinder = z.infer<typeof insertBinderSchema>;
export type Binder = typeof bindersTable.$inferSelect;
