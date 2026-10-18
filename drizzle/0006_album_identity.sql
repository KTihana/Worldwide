ALTER TABLE accounts ADD COLUMN album_id TEXT;
UPDATE accounts SET album_id=lower(hex(randomblob(16))) WHERE album_id IS NULL;
CREATE UNIQUE INDEX accounts_album_id_unique ON accounts(album_id);
