-- Run once on existing DBs created from older schema.sql (Feedback had only query, response, rating NOT NULL).
ALTER TABLE "Feedback" ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE "Feedback" ADD COLUMN IF NOT EXISTS comment TEXT;
ALTER TABLE "Feedback" ALTER COLUMN rating DROP NOT NULL;
