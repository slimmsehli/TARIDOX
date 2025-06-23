// server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();
const port = 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Define the path to your SQLite database file
const DB_PATH = '../db/locker.db';

let db; // Global variable to hold the database connection

// Function to open the database connection
function openDb() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE, (err) => {
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

// Function to close the database connection (less frequently used with a persistent server)
function closeDb() {
    return new Promise((resolve, reject) => {
        if (db) {
            db.close((err) => {
                if (err) {
                    console.error(`Error closing database: ${err.message}`);
                    reject(err);
                } else {
                    console.log('Database connection closed.');
                    resolve();
                }
            });
        } else {
            resolve(); // No DB open to close
        }
    });
}

// --- Database Interaction Functions (Promises for async/await) ---

// Get all lockers
function getAllLockersDB() {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM lockers", [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Get boxes for a specific locker
function getBoxesByLockerIdDB(lockerId) {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM boxes WHERE locker_id = ?", [lockerId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Update locker status
function updateLockerStatusDB(lockerId, newStatus) {
    return new Promise((resolve, reject) => {
        db.run("UPDATE lockers SET status = ? WHERE id = ?", [newStatus, lockerId], function (err) {
            if (err) reject(err);
            else resolve(this.changes > 0); // true if updated, false if not found
        });
    });
}

// Update box status to 'empty' after customer pickup
function updateBoxToEmptyDB(boxId) {
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
                if (err) reject(err);
                else resolve(this.changes > 0); // true if updated, false if not found
            }
        );
    });
}

// --- API Endpoints ---

// Get all lockers
app.get('/api/lockers', async (req, res) => {
    try {
        const lockers = await getAllLockersDB();
        res.json(lockers);
    } catch (err) {
        console.error("Error fetching lockers:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// Get boxes for a specific locker
app.get('/api/lockers/:id/boxes', async (req, res) => {
    const lockerId = req.params.id;
    try {
        const boxes = await getBoxesByLockerIdDB(lockerId);
        res.json(boxes);
    } catch (err) {
        console.error(`Error fetching boxes for locker ${lockerId}:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// Update locker status
app.post('/api/lockers/:id/status', async (req, res) => {
    const lockerId = req.params.id;
    const { status } = req.body;
    if (!status) {
        return res.status(400).json({ error: "New status is required." });
    }
    try {
        const success = await updateLockerStatusDB(lockerId, status);
        if (success) {
            res.json({ message: `Locker ${lockerId} status updated to ${status}.` });
        } else {
            res.status(404).json({ message: `Locker ${lockerId} not found or status unchanged.` });
        }
    } catch (err) {
        console.error(`Error updating locker ${lockerId} status:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// Update box status to empty (pickup)
app.post('/api/boxes/:id/pickup', async (req, res) => {
    const boxId = req.params.id;
    try {
        const success = await updateBoxToEmptyDB(boxId);
        if (success) {
            res.json({ message: `Box ${boxId} marked as empty.` });
        } else {
            res.status(404).json({ message: `Box ${boxId} not found or already empty.` });
        }
    } catch (err) {
        console.error(`Error updating box ${boxId} to empty:`, err.message);
        res.status(500).json({ error: err.message });
    }
});


// Start the server after opening the database
async function startServer() {
    try {
        await openDb();
        app.listen(port, () => {
            console.log(`Server running at http://localhost:${port}`);
        });
    } catch (err) {
        console.error("Failed to start server due to database connection error:", err);
        process.exit(1); // Exit if DB connection fails
    }
}

startServer();

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('Server shutting down...');
    await closeDb();
    process.exit(0);
});
