#!/bin/csh -f

sqlite3 locker.db
.read create_client_db.sql

## check some content from the db
.tables
-- Expected output: boxes  lockers
sqlite> SELECT * FROM lockers;
sqlite> SELECT * FROM boxes LIMIT 5;
.quit
