// db_operations.js

// Import the sqlite3 module
const sqlite3 = require('sqlite3').verbose();

// Define the path to your SQLite database file
// Make sure 'locker_management.db' is in the same directory as this script,
// or provide the full path to its location.
const DB_PATH = '../db/locker.db';

// Function to open the database connection
function openDb() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE, (err) => {
            if (err) {
                console.error(`Error connecting to database: ${err.message}`);
                reject(err);
            } else {
                console.log('Connected to the SQLite database.');
                resolve(db);
            }
        });
    });
}

// Function to close the database connection
function closeDb(db) {
    return new Promise((resolve, reject) => {
        db.close((err) => {
            if (err) {
                console.error(`Error closing database: ${err.message}`);
                reject(err);
            } else {
                console.log('Database connection closed.');
                resolve();
            }
        });
    });
}

// --- Read Operations ---

// Get all lockers
async function getAllLockers(db) {
    console.log('\n--- Getting all lockers ---');
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM lockers", [], (err, rows) => {
            if (err) {
                console.error(`Error fetching lockers: ${err.message}`);
                reject(err);
            } else {
                console.log('All Lockers:', rows);
                resolve(rows);
            }
        });
    });
}

// Get boxes for a specific locker
async function getBoxesByLockerId(db, lockerId) {
    console.log(`\n--- Getting boxes for Locker ID: ${lockerId} ---`);
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM boxes WHERE locker_id = ?", [lockerId], (err, rows) => {
            if (err) {
                console.error(`Error fetching boxes for locker ${lockerId}: ${err.message}`);
                reject(err);
            } else {
                console.log(`Boxes for ${lockerId}:`, rows);
                resolve(rows);
            }
        });
    });
}

// Get a specific box by its ID
async function getBoxById(db, boxId) {
    console.log(`\n--- Getting Box ID: ${boxId} ---`);
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM boxes WHERE id = ?", [boxId], (err, row) => {
            if (err) {
                console.error(`Error fetching box ${boxId}: ${err.message}`);
                reject(err);
            } else {
                if (row) {
                    console.log(`Box ${boxId}:`, row);
                    resolve(row);
                } else {
                    console.log(`Box ${boxId} not found.`);
                    resolve(null);
                }
            }
        });
    });
}

// --- Write Operations (Update) ---

// Update locker status
async function updateLockerStatus(db, lockerId, newStatus) {
    console.log(`\n--- Updating Locker ${lockerId} status to '${newStatus}' ---`);
    return new Promise((resolve, reject) => {
        db.run("UPDATE lockers SET status = ? WHERE id = ?", [newStatus, lockerId], function (err) {
            if (err) {
                console.error(`Error updating locker ${lockerId} status: ${err.message}`);
                reject(err);
            } else {
                if (this.changes > 0) {
                    console.log(`Locker ${lockerId} status updated successfully. Rows affected: ${this.changes}`);
                    resolve(true);
                } else {
                    console.log(`Locker ${lockerId} not found or status already '${newStatus}'.`);
                    resolve(false);
                }
            }
        });
    });
}

// Update box status to 'empty' after customer pickup
async function updateBoxToEmpty(db, boxId) {
    console.log(`\n--- Updating Box ${boxId} to 'empty' after pickup ---`);
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE boxes SET
                status = 'empty',
                parcel_customer_name = NULL,
                parcel_verification_code_1 = NULL,
                parcel_verification_code_2 = NULL,
                availability_start_day = ?,
                availability_end_day = ?
             WHERE id = ?`,
            [today, today, boxId],
            function (err) {
                if (err) {
                    console.error(`Error updating box ${boxId} to empty: ${err.message}`);
                    reject(err);
                } else {
                    if (this.changes > 0) {
                        console.log(`Box ${boxId} successfully marked as empty. Rows affected: ${this.changes}`);
                        resolve(true);
                    } else {
                        console.log(`Box ${boxId} not found or already empty.`);
                        resolve(false);
                    }
                }
            }
        );
    });
}


// Main function to run the examples
async function main() {
    let db;
    try {
        db = await openDb();

        // --- Perform Read Operations ---
        await getAllLockers(db);
        await getBoxesByLockerId(db, 'LOCKER001');
        await getBoxesByLockerId(db, 'LOCKER002'); // Should show empty boxes
        await getBoxById(db, 'BOX001-A');
        await getBoxById(db, 'NON_EXISTENT_BOX'); // Test non-existent

        // --- Perform Write Operations ---
        // Update LOCKER001 to maintenance
        await updateLockerStatus(db, 'LOCKER001', 'maintenance');
        await getAllLockers(db); // Verify update

        // Simulate customer pickup for BOX001-A
        await updateBoxToEmpty(db, 'BOX001-A');
        await getBoxesByLockerId(db, 'LOCKER001'); // Verify update

        // Try updating a non-existent locker
        await updateLockerStatus(db, 'NON_EXISTENT_LOCKER', 'active');

    } catch (error) {
        console.error('An error occurred during database operations:', error);
    } finally {
        if (db) {
            await closeDb(db);
        }
    }
}

// Run the main function
main();
