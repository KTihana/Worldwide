import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
export const visits=sqliteTable('visits',{
 userId:text('user_id').notNull(),countryId:text('country_id').notNull(),visited:integer('visited').notNull().default(0),coverId:text('cover_id'),note:text('note').notNull().default(''),visitDate:text('visit_date'),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.userId,t.countryId]})]);
export const photos=sqliteTable('photos',{
 id:text('id').primaryKey(),userId:text('user_id').notNull(),countryId:text('country_id').notNull(),objectKey:text('object_key').notNull(),caption:text('caption').notNull().default(''),contentType:text('content_type').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('photos_owner_country').on(t.userId,t.countryId)]);
