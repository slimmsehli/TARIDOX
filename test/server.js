// server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors'); // Import cors middleware

const app = express();
const port = 3001; // Choose a port for your API server, distinct from React client ports

// Enable CORS for all origins during development. In production, restrict this.
app.use(cors());
// Middleware to parse JSON bodies from requests
app.use(express.json());

// Define the path to your SQLite database file
// Make sure 'locker_management.db' is in the same directory as this script.
const DB_PATH = '../db/locker.db';

let db; // Global variable to hold the database connection

// --- Database Connection Functions ---
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

// --- Database Interaction Helper Functions (Promises) ---
function getAllLockersDB() {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM lockers", [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function getLockerByIdDB(lockerId) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM lockers WHERE id = ?", [lockerId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function getBoxesByLockerIdDB(lockerId) {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM boxes WHERE locker_id = ?", [lockerId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function getBoxByIdDB(boxId) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM boxes WHERE id = ?", [boxId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function updateLockerStatusDB(lockerId, newStatus) {
    return new Promise((resolve, reject) => {
        db.run("UPDATE lockers SET status = ? WHERE id = ?", [newStatus, lockerId], function (err) {
            if (err) reject(err);
            else resolve(this.changes > 0);
        });
    });
}

function updateBoxToEmptyDB(boxId) {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
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
                else resolve(this.changes > 0);
            }
        );
    });
}

function updateLockerFullnessDB(lockerId, fullness) {
    return new Promise((resolve, reject) => {
        db.run("UPDATE lockers SET fullness = ? WHERE id = ?", [fullness, lockerId], function (err) {
            if (err) reject(err);
            else resolve(this.changes > 0);
        });
    });
}

async function addParcelToBoxDB(lockerId, newBoxData) {
    return new Promise((resolve, reject) => {
        // For simplicity, we'll try to find an 'empty' box first,
        // if not found, we'll insert a new one with a generated ID.
        // In a real system, the server would have more complex logic
        // for box assignment or creation.

        db.get("SELECT id FROM boxes WHERE locker_id = ? AND status = 'empty' LIMIT 1", [lockerId], async (err, emptyBox) => {
            if (err) return reject(err);

            if (emptyBox) {
                // Update existing empty box
                db.run(
                    `UPDATE boxes SET
                        status = ?,
                        dimensions = ?,
                        availability_start_day = ?,
                        availability_end_day = ?,
                        parcel_customer_name = ?,
                        parcel_verification_code_1 = ?,
                        parcel_verification_code_2 = ?
                     WHERE id = ?`,
                    [
                        newBoxData.status,
                        newBoxData.dimensions,
                        newBoxData.availability.startDate,
                        newBoxData.availability.endDate,
                        newBoxData.parcel.customerName,
                        newBoxData.parcel.verificationCode1,
                        newBoxData.parcel.verificationCode2,
                        emptyBox.id
                    ],
                    function (updateErr) {
                        if (updateErr) reject(updateErr);
                        else resolve({ id: emptyBox.id, message: 'Existing empty box updated.' });
                    }
                );
            } else {
                // No empty box found, insert a new one (generate a simple ID)
                const newBoxId = `${lockerId}-${Date.now().toString().slice(-4)}`; // Simple unique ID
                db.run(
                    `INSERT INTO boxes (id, locker_id, status, dimensions, availability_start_day, availability_end_day, parcel_customer_name, parcel_verification_code_1, parcel_verification_code_2)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        newBoxId,
                        lockerId,
                        newBoxData.status,
                        newBoxData.dimensions,
                        newBoxData.availability.startDate,
                        newBoxData.availability.endDate,
                        newBoxData.parcel.customerName,
                        newBoxData.parcel.verificationCode1,
                        newBoxData.parcel.verificationCode2
                    ],
                    function (insertErr) {
                        if (insertErr) reject(insertErr);
                        else resolve({ id: newBoxId, message: 'New box created.' });
                    }
                );
            }
        });
    });
}

// --- API Endpoints ---

// Create Locker (if not exists) and Get Locker Data
app.post('/api/lockers', async (req, res) => {
    const { id } = req.body;
    if (!id) {
        return res.status(400).json({ error: "Locker ID is required." });
    }
    try {
        let locker = await getLockerByIdDB(id);
        if (!locker) {
            // Create new locker if it doesn't exist
            const newLockerData = {
                id: id,
                status: 'available',
                fullness: 'empty',
                coordinates: 'N/A',
                business: 'Default Business',
                availability: 'Mon-Sat 24h',
                createdAt: new Date().toISOString()
            };
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO lockers (id, status, fullness, coordinates, business, availability)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [newLockerData.id, newLockerData.status, newLockerData.fullness, newLockerData.coordinates, newLockerData.business, newLockerData.availability],
                    function (err) {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
            locker = newLockerData; // Set locker to the newly created data
            res.status(201).json({ message: `Locker ${id} created and loaded.`, locker });
        } else {
            res.json({ message: `Locker ${id} loaded.`, locker });
        }
    } catch (err) {
        console.error("Error fetching/creating locker:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// Get a specific locker's data
app.get('/api/lockers/:id', async (req, res) => {
    const lockerId = req.params.id;
    try {
        const locker = await getLockerByIdDB(lockerId);
        if (locker) {
            res.json(locker);
        } else {
            res.status(404).json({ message: "Locker not found." });
        }
    } catch (err) {
        console.error(`Error fetching locker ${lockerId}:`, err.message);
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

// Update locker status (client-side update)
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
            res.status(404).json({ message: `Locker ${lockerId} not found or status already '${status}'.` });
        }
    } catch (err) {
        console.error(`Error updating locker ${lockerId} status:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// Update box status to empty (customer pickup)
app.post('/api/boxes/:id/pickup', async (req, res) => {
    const boxId = req.params.id;
    const { lockerId } = req.body; // Locker ID needed to re-evaluate fullness
    if (!lockerId) {
        return res.status(400).json({ error: "Locker ID is required for pickup operation." });
    }
    try {
        const success = await updateBoxToEmptyDB(boxId);
        if (success) {
            // After pickup, check if locker is now empty
            const boxesInLocker = await getBoxesByLockerIdDB(lockerId);
            const occupiedBoxes = boxesInLocker.filter(box => box.status === 'occupied');
            if (occupiedBoxes.length === 0) {
                await updateLockerFullnessDB(lockerId, 'empty');
            } else {
                await updateLockerFullnessDB(lockerId, 'has_boxes'); // Ensure it's not 'full' if some boxes are left
            }
            res.json({ message: `Box ${boxId} marked as empty.` });
        } else {
            res.status(404).json({ message: `Box ${boxId} not found or already empty.` });
        }
    } catch (err) {
        console.error(`Error updating box ${boxId} to empty:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// Simulate server adding a new parcel (updates locker's fullness)
app.post('/api/lockers/:id/add-parcel', async (req, res) => {
    const lockerId = req.params.id;
    try {
        const locker = await getLockerByIdDB(lockerId);
        if (!locker) {
            return res.status(404).json({ message: `Locker ${lockerId} not found.` });
        }

        // Simulate new parcel data
        const newParcelData = {
            status: 'occupied',
            dimensions: '20x30x40cm',
            availability: {
                startDate: new Date().toISOString().split('T')[0],
                endDate: `2025-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}` // Random end date
            },
            parcel: {
                customerName: `Customer ${Math.floor(Math.random() * 1000)}`,
                verificationCode1: String(Math.floor(1000 + Math.random() * 9000)),
                verificationCode2: String(Math.floor(1000 + Math.random() * 9000)),
            }
        };

        const { id: boxUpdatedId, message } = await addParcelToBoxDB(lockerId, newParcelData);

        // After adding parcel, update locker fullness to 'has_boxes' or 'full'
        // A more robust check would involve counting actual occupied boxes vs total boxes
        await updateLockerFullnessDB(lockerId, 'has_boxes');

        res.json({ message: `Parcel added to box ${boxUpdatedId}. Locker fullness updated.`, boxId: boxUpdatedId });

    } catch (err) {
        console.error(`Error simulating server adding parcel for locker ${lockerId}:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// Initialize default boxes for a locker
app.post('/api/lockers/:id/initialize-boxes', async (req, res) => {
    const lockerId = req.params.id;
    try {
        const locker = await getLockerByIdDB(lockerId);
        if (!locker) {
            return res.status(404).json({ message: `Locker ${lockerId} not found.` });
        }

        const boxesInLocker = await getBoxesByLockerIdDB(lockerId);
        if (boxesInLocker.length > 0) {
            return res.status(200).json({ message: "Locker already has boxes. No initialization needed." });
        }

        const defaultBoxes = [
            { status: 'empty', dimensions: '20x30x40cm', availability: { startDate: '2023-01-01', endDate: '2023-01-01' }, parcel: null },
            { status: 'empty', dimensions: '30x30x30cm', availability: { startDate: '2023-01-01', endDate: '2023-01-01' }, parcel: null },
            { status: 'empty', dimensions: '25x50x20cm', availability: { startDate: '2023-01-01', endDate: '2023-01-01' }, parcel: null },
            { status: 'empty', dimensions: '35x35x35cm', availability: { startDate: '2023-01-01', endDate: '2023-01-01' }, parcel: null },
            { status: 'empty', dimensions: '18x25x20cm', availability: { startDate: '2023-01-01', endDate: '2023-01-01' }, parcel: null },
        ];

        for (let i = 0; i < defaultBoxes.length; i++) {
            const box = defaultBoxes[i];
            const newBoxId = `${lockerId}-BOX${String.fromCharCode(65 + i)}`; // e.g., LOCKER001-BOXA
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO boxes (id, locker_id, status, dimensions, availability_start_day, availability_end_day, parcel_customer_name, parcel_verification_code_1, parcel_verification_code_2)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        newBoxId,
                        lockerId,
                        box.status,
                        box.dimensions,
                        box.availability.startDate,
                        box.availability.endDate,
                        null, null, null // Empty parcel initially
                    ],
                    function (err) {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }
        await updateLockerFullnessDB(lockerId, 'empty'); // Set to empty after initializing empty boxes

        res.status(200).json({ message: `Default boxes initialized for locker ${lockerId}.` });
    } catch (err) {
        console.error(`Error initializing default boxes for locker ${lockerId}:`, err.message);
        res.status(500).json({ error: err.message });
    }
});


// Start the server after opening the database
async function startServer() {
    try {
        await openDb();
        app.listen(port, () => {
            console.log(`Locker API Server running at http://localhost:${port}`);
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

