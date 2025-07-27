// db.js
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, './db/main.db');
const SQL_SCHEMA_PATH = path.join(__dirname, 'schema.sql');

/**
 * Initializes the SQLite database.
 * If the database file or 'lockers' table doesn't exist, it runs the schema script.
 * @returns {Promise<sqlite3.Database>} A promise that resolves with the database instance.
 */
function initializeDb() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
            if (err) {
                console.error('Error opening database:', err.message);
                reject(err);
                return;
            }
            console.log('Connected to the SQLite database.');

            // Check if tables exist, if not, run the setup script
            db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='lockers'", (err, row) => {
                if (err) {
                    console.error('Error checking for lockers table:', err.message);
                    reject(err);
                    return;
                }
                if (!row) {
                    console.log('Lockers table not found. Running setup script...');
                    fs.readFile(SQL_SCHEMA_PATH, 'utf8', (err, sql) => {
                        if (err) {
                            console.error('Error reading SQL schema file:', err.message);
                            reject(err);
                            return;
                        }
                        db.exec(sql, (err) => {
                            if (err) {
                                console.error('Error executing SQL setup script:', err.message);
                                reject(err);
                                return;
                            }
                            console.log('Database initialized with schema and sample data.');
                            resolve(db);
                        });
                    });
                } else {
                    console.log('Database already initialized.');
                    resolve(db);
                }
            });
        });
    });
}

/**
 * Returns a new database connection for each request.
 * It's generally better for simple apps to get a fresh connection for each operation
 * to avoid issues with concurrent requests, or use a pooling library for larger apps.
 */
function getDb() {
    return new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE);
}

module.exports = {
    initializeDb,
    getDb
};

