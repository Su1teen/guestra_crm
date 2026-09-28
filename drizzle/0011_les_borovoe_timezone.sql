ALTER TABLE properties ALTER COLUMN timezone SET DEFAULT 'Asia/Almaty';
--> statement-breakpoint

UPDATE properties
SET timezone = 'Asia/Almaty'
WHERE id = 'les_borovoe' AND timezone = 'Asia/Qyzylorda';
