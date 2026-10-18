ALTER TABLE accounts ADD COLUMN username TEXT;
CREATE UNIQUE INDEX accounts_username_unique ON accounts(username COLLATE NOCASE);
