import { pgTable, serial, text, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { bindersTable } from "./binders";

export const cardsTable = pgTable("cards", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  setNumber: integer("set_number").notNull(),
  setTotal: integer("set_total").notNull(),
  condition: text("condition").notNull().default("Raw"),
  currentPriceGBP: numeric("current_price_gbp", { precision: 10, scale: 2 }).notNull().default("0"),
  imageUrl: text("image_url"),
  assignedBinderId: integer("assigned_binder_id").notNull().references(() => bindersTable.id, { onDelete: "cascade" }),
  lastPriceRefreshedAt: timestamp("last_price_refreshed_at"),
  psa10GBP: numeric("psa10_gbp", { precision: 10, scale: 2 }),
  bgs10GBP: numeric("bgs10_gbp", { precision: 10, scale: 2 }),
  gradedRefreshedAt: timestamp("graded_refreshed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCardSchema = createInsertSchema(cardsTable).omit({ id: true, createdAt: true, lastPriceRefreshedAt: true });
export type InsertCard = z.infer<typeof insertCardSchema>;
export type Card = typeof cardsTable.$inferSelect;
