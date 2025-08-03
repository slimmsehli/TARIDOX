// server.js
const express = require('express');
const bodyParser = require('body-parser'); // For parsing form data
const { initializeDb, getDb } = require('./db');
const path = require('path');

const app = express();
const PORT = 3000; // You can choose any available port

// Set EJS as the templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware to parse URL-encoded bodies (form data)
app.use(bodyParser.urlencoded({ extended: true }));
// Middleware to parse JSON bodies (for new API endpoints)
app.use(bodyParser.json());
// Serve static files (like CSS if you had any external ones, though Tailwind is CDN-loaded)
app.use(express.static('public')); // Create a 'public' folder if you need static assets later

let db; // Variable to hold the database connection

// Initialize database and then start the server
initializeDb().then((database) => {
    db = database; // Store the initial connection
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error("Failed to initialize database and start server:", err);
    process.exit(1); // Exit if DB connection fails
});

// Helper to get current timestamp inYYYY-MM-DD HH:MM:SS format
function getCurrentTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}


// function to find lockers in a circle area
const haversineDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180; // φ, λ in radians
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    const distance = R * c; // in metres
    return distance;
};


// Add this route to your server.js
app.get('/locker_selection', (req, res) => {
    res.render('locker_selection');
});


app.get('/api/lockers_slim', (req, res) => {
    const { lat, lon, radius } = req.query;
    const currentDb = getDb();
    console.log(`[API] Received request for lockers. Lat: ${lat}, Lon: ${lon}, Radius: ${radius}`);

    currentDb.all('SELECT * FROM lockers', (err, rows) => {
        if (err) {
            console.error('[API] ERROR fetching all lockers:', err.message);
            currentDb.close();
            return res.status(500).json({ error: 'Error retrieving all lockers' });
        }
        
        console.log(`[API] Successfully retrieved ${rows.length} total lockers from the database.`);
        
        let filteredLockers = rows;

        if (lat && lon && radius) {
            const centerLat = parseFloat(lat);
            const centerLon = parseFloat(lon);
            const searchRadius = parseFloat(radius);

            if (isNaN(centerLat) || isNaN(centerLon) || isNaN(searchRadius)) {
                console.error('[API] ERROR: Invalid geographic parameters. Lat, Lon, Radius must be numbers.');
                currentDb.close();
                return res.status(400).json({ error: 'Invalid geographic parameters.' });
            }

            filteredLockers = rows.filter(locker => {
                if (locker.latitude && locker.longitude) {
                    const lockerLat = parseFloat(locker.latitude);
                    const lockerLon = parseFloat(locker.longitude);

                    if (isNaN(lockerLat) || isNaN(lockerLon)) {
                        console.warn(`[API] WARNING: Locker ${locker.locker_id} has invalid coordinates. Skipping.`);
                        return false;
                    }
                    const distance = haversineDistance(centerLat, centerLon, lockerLat, lockerLon);
                    console.log(`[API] Locker ${locker.locker_id} is ${distance}m away. Radius is ${searchRadius}m.`);
                    return distance <= searchRadius;
                }
                console.warn(`[API] WARNING: Locker ${locker.locker_id} has no coordinates. Skipping.`);
                return false;
            });
        }
        
        console.log(`[API] Filtered down to ${filteredLockers.length} lockers for the client.`);
        
        if (filteredLockers.length > 0) {
            console.log('[API] Sample locker data:', filteredLockers[0]);
        }
        
        currentDb.close();
        res.json({ lockers: filteredLockers });
    });
});

/**
 * Recalculates and updates a locker's aggregate box counts and fullness status.
 * This function should be called after any operation that modifies locker_boxes (add, edit, delete, pickup).
 * @param {number} lockerId - The ID of the locker to update.
 * @param {sqlite3.Database} db - The database connection.
 * @param {function} callback - Callback function (err) to indicate completion or error.
 */
function updateLockerAggregates(lockerId, db, callback) {
    db.get('SELECT COUNT(*) as total, SUM(CASE WHEN status = "full" THEN 1 ELSE 0 END) as full, SUM(CASE WHEN status = "reserved" THEN 1 ELSE 0 END) as reserved, SUM(CASE WHEN status = "in use" THEN 1 ELSE 0 END) as in_use, SUM(CASE WHEN status = "empty" THEN 1 ELSE 0 END) as empty FROM locker_boxes WHERE locker_id = ?', [lockerId], (err, counts) => {
        if (err) {
            console.error(`Error recalculating box counts for locker ${lockerId}:`, err.message);
            return callback(err);
        }

        const actualTotal = counts.total || 0;
        const actualFull = counts.full || 0;
        const actualReserved = counts.reserved || 0;
        const actualInUse = counts.in_use || 0;
        const actualEmpty = counts.empty || 0;

        // Calculate total occupied boxes (full, reserved, in use)
        const totalOccupied = actualFull + actualReserved + actualInUse;
        const calculatedEmptyBoxesLeft = actualTotal - totalOccupied;

        let fullnessStatus = 'empty';
        if (actualTotal > 0) {
            if (totalOccupied === actualTotal) {
                fullnessStatus = 'full';
            } else if (totalOccupied > 0) {
                fullnessStatus = 'has some space';
            }
        }

        const updateLockerSql = `
            UPDATE lockers
            SET
                total_boxes = ?,
                full_boxes = ?,
                empty_boxes_left = ?,
                fullness = ?
            WHERE
                locker_id = ?
        `;
        db.run(updateLockerSql, [actualTotal, actualFull, calculatedEmptyBoxesLeft, fullnessStatus, lockerId], function(updateErr) {
            if (updateErr) {
                console.error(`Error updating locker ${lockerId} aggregates:`, updateErr.message);
                return callback(updateErr);
            }
            console.log(`Locker ${lockerId} aggregates updated: Total=${actualTotal}, Full=${actualFull}, Empty=${calculatedEmptyBoxesLeft}, Fullness=${fullnessStatus}`);
            callback(null);
        });
    });
}


// Route to display all lockers (initial page load for admin)
app.get('/', (req, res) => {
    const currentDb = getDb(); // Get a new connection for this request
    currentDb.all('SELECT * FROM lockers', (err, rows) => {
        currentDb.close(); // Close the connection after query
        if (err) {
            console.error('Error fetching lockers for index page:', err.message);
            res.status(500).send('Error retrieving lockers');
            return;
        }
        res.render('index', { lockers: rows });
    });
});

// NEW API ROUTE: Get all lockers (for client-side polling on admin page)
app.get('/api/lockers', (req, res) => {
    const currentDb = getDb();
    currentDb.all('SELECT * FROM lockers', (err, rows) => {
        currentDb.close();
        if (err) {
            console.error('Error fetching all lockers API:', err.message);
            res.status(500).json({ error: 'Error retrieving all lockers' });
            return;
        }
        res.json({ lockers: rows });
    });
});


// Route to display the form for adding a new locker
app.get('/add_locker', (req, res) => {
    res.render('add_locker');
});

// Route to handle adding a new locker and its boxes
app.post('/add_locker', (req, res) => {
    const { name, business_name, latitude, longitude, opening_hours, status, fullness, total_boxes, full_boxes, empty_boxes_left } = req.body;

    // Basic validation
    if (!name || !business_name || !latitude || !longitude || !status || !fullness || total_boxes === undefined || full_boxes === undefined || empty_boxes_left === undefined) {
        return res.status(400).send('All required fields must be filled.');
    }

    const numBoxes = parseInt(total_boxes, 10);
    if (isNaN(numBoxes) || numBoxes < 0) {
        return res.status(400).send('Total boxes must be a non-negative number.');
    }

    const currentDb = getDb(); // Get a new connection for this request

    // Use a transaction to ensure both locker and boxes are added atomically
    currentDb.serialize(() => {
        currentDb.run('BEGIN TRANSACTION;', (txErr) => {
            if (txErr) {
                currentDb.close();
                console.error('Error starting transaction for add_locker:', txErr.message);
                return res.status(500).send('Error adding locker (transaction failed).');
            }
        });

        // 1. Insert the new locker into the lockers table
        const insertLockerSql = `
            INSERT INTO lockers (name, business_name, latitude, longitude, opening_hours, status, fullness, total_boxes, full_boxes, empty_boxes_left)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        currentDb.run(insertLockerSql, [
            name, business_name, latitude, longitude, opening_hours, status, fullness, numBoxes, full_boxes, empty_boxes_left
        ], function(err) {
            if (err) {
                currentDb.run('ROLLBACK;', (rollbackErr) => {
                    currentDb.close();
                    if (rollbackErr) console.error('Rollback error:', rollbackErr.message);
                    console.error('Error adding locker:', err.message);
                    res.status(500).send('Error adding locker to database');
                });
                return;
            }

            const newLockerId = this.lastID; // Get the ID of the newly inserted locker

            // 2. Insert the specified number of empty boxes into the locker_boxes table
            const insertBoxSql = `
                INSERT INTO locker_boxes (
                    locker_id, height, width, length, volume, status,
                    ecommerce_name, occupied_from, occupied_to, code1_open, code2_open, box_health,
                    customer_name, customer_phone, parcel_name
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const defaultHeight = 20;
            const defaultWidth = 20;
            const defaultLength = 20;
            const defaultVolume = defaultHeight * defaultWidth * defaultLength; // 8000 cm³

            let boxesInsertedCount = 0;
            let hasBoxInsertError = false;

            // If numBoxes is 0, skip the loop and commit immediately
            if (numBoxes === 0) {
                currentDb.run('COMMIT;', (commitErr) => {
                    currentDb.close();
                    if (commitErr) console.error('Commit error for 0 boxes:', commitErr.message);
                    console.log(`Locker with ID ${newLockerId} added (no boxes).`);
                    res.redirect('/');
                });
                return;
            }

            for (let i = 0; i < numBoxes; i++) {
                currentDb.run(insertBoxSql, [
                    newLockerId,
                    defaultHeight,
                    defaultWidth,
                    defaultLength,
                    defaultVolume,
                    'empty', // Default status
                    null,    // ecommerce_name
                    null,    // occupied_from
                    null,    // occupied_to
                    null,    // code1_open
                    null,    // code2_open
                    'working', // Default box_health
                    null,    // customer_name
                    null,    // customer_phone
                    null     // parcel_name
                ], (boxErr) => {
                    if (boxErr) {
                        console.error(`Error inserting box ${i+1} for locker ${newLockerId}:`, boxErr.message);
                        hasBoxInsertError = true;
                    }
                    boxesInsertedCount++;

                    // When all box insertions are attempted
                    if (boxesInsertedCount === numBoxes) {
                        if (hasBoxInsertError) {
                            currentDb.run('ROLLBACK;', (rollbackErr) => {
                                currentDb.close();
                                if (rollbackErr) console.error('Rollback error after box insert failure:', rollbackErr.message);
                                res.status(500).send('Error adding associated boxes. Transaction rolled back.');
                            });
                        } else {
                            currentDb.run('COMMIT;', (commitErr) => {
                                currentDb.close();
                                if (commitErr) console.error('Commit error after box inserts:', commitErr.message);
                                console.log(`Locker with ID ${newLockerId} and ${numBoxes} boxes added.`);
                                // After adding new boxes, ensure the locker's aggregate status is correct
                                const tempDb = getDb(); // Get new connection for the aggregate update
                                updateLockerAggregates(newLockerId, tempDb, (aggErr) => {
                                    tempDb.close();
                                    if (aggErr) {
                                        console.error('Error updating locker aggregates after add locker:', aggErr.message);
                                        // Decide how to handle: rollback more or just log? For now, redirect anyway.
                                    }
                                    res.redirect('/');
                                });
                            });
                        }
                    }
                });
            }
        });
    });
});

// Route to handle deleting a locker
app.post('/delete_locker/:id', (req, res) => {
    const lockerId = req.params.id;
    const currentDb = getDb(); // Get a new connection for this request

    // Use a transaction to ensure both deletions succeed or fail together
    currentDb.serialize(() => {
        currentDb.run('BEGIN TRANSACTION;', (txErr) => {
            if (txErr) {
                currentDb.close();
                console.error('Error starting transaction for delete_locker:', txErr.message);
                return res.status(500).send('Error deleting locker (transaction failed).');
            }
        });
        currentDb.run('DELETE FROM locker_boxes WHERE locker_id = ?', [lockerId], function(err) {
            if (err) {
                currentDb.run('ROLLBACK;', () => {
                    currentDb.close();
                    console.error('Error deleting associated boxes:', err.message);
                    res.status(500).send('Error deleting associated boxes');
                });
                return;
            }
            // Also delete history entries for boxes of this locker
            currentDb.run('DELETE FROM box_history WHERE locker_id = ?', [lockerId], function(err) {
                if (err) {
                    currentDb.run('ROLLBACK;', () => {
                        currentDb.close();
                        console.error('Error deleting associated box history:', err.message);
                        res.status(500).send('Error deleting associated box history');
                    });
                    return;
                }
                currentDb.run('DELETE FROM lockers WHERE locker_id = ?', [lockerId], function(err) {
                    if (err) {
                        currentDb.run('ROLLBACK;', () => {
                            currentDb.close();
                            console.error('Error deleting locker:', err.message);
                            res.status(500).send('Error deleting locker');
                        });
                        return;
                    }
                    currentDb.run('COMMIT;', () => {
                        currentDb.close();
                        console.log(`Locker with ID ${lockerId} and its boxes (and history) deleted.`);
                        res.redirect('/');
                    });
                });
            });
        });
    });
});

// Route: Display details and boxes for a specific locker (for admin view)
app.get('/locker/:id', (req, res) => {
    const lockerId = req.params.id;
    const currentDb = getDb();

    Promise.all([
        new Promise((resolve, reject) => {
            currentDb.get('SELECT * FROM lockers WHERE locker_id = ?', [lockerId], (err, row) => {
                if (err) reject(err);
                else if (!row) reject(new Error('Locker not found.'));
                else resolve(row);
            });
        }),
        new Promise((resolve, reject) => {
            currentDb.all('SELECT * FROM locker_boxes WHERE locker_id = ?', [lockerId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        })
    ])
    .then(([locker, boxes]) => {
        currentDb.close();
        // Pass isClientView as false for the admin view
        res.render('locker_details', { locker: locker, boxes: boxes, isClientView: false });
    })
    .catch(err => {
        currentDb.close();
        console.error('Error fetching locker details or boxes:', err.message);
        if (err.message === 'Locker not found.') {
            res.status(404).send('Locker not found.');
        } else {
            res.status(500).send('Error retrieving locker details or boxes.');
        }
    });
});

// API endpoint to get locker and box data (for client-side app)
app.get('/api/locker/:id', (req, res) => {
    const lockerId = req.params.id;
    const currentDb = getDb();

    Promise.all([
        new Promise((resolve, reject) => {
            currentDb.get('SELECT * FROM lockers WHERE locker_id = ?', [lockerId], (err, row) => {
                if (err) reject(err);
                else if (!row) reject(new Error('Locker not found.'));
                else resolve(row);
            });
        }),
        new Promise((resolve, reject) => {
            currentDb.all('SELECT * FROM locker_boxes WHERE locker_id = ?', [lockerId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        })
    ])
    .then(([locker, boxes]) => {
        currentDb.close();
        res.json({ locker: locker, boxes: boxes }); // Send JSON response
    })
    .catch(err => {
        currentDb.close();
        console.error('Error fetching API locker data:', err.message);
        res.status(500).json({ error: 'Error retrieving locker data' });
    });
});

// API ROUTE: Update locker status to 'online'
app.post('/api/locker/:id/connect', (req, res) => {
    const lockerId = req.params.id;
    const currentDb = getDb();
    currentDb.run('UPDATE lockers SET status = "online" WHERE locker_id = ?', [lockerId], function(err) {
        currentDb.close();
        if (err) {
            console.error(`Error connecting locker ${lockerId}:`, err.message);
            return res.status(500).json({ success: false, message: 'Failed to set locker status to online.' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, message: 'Locker not found.' });
        }
        console.log(`Locker ${lockerId} status set to ONLINE.`);
        res.json({ success: true, message: `Locker ${lockerId} connected.` });
    });
});

// API ROUTE: Update locker status to 'offline'
app.post('/api/locker/:id/disconnect', (req, res) => {
    const lockerId = req.params.id;
    const currentDb = getDb();
    currentDb.run('UPDATE lockers SET status = "offline" WHERE locker_id = ?', [lockerId], function(err) {
        currentDb.close();
        if (err) {
            console.error(`Error disconnecting locker ${lockerId}:`, err.message);
            return res.status(500).json({ success: false, message: 'Failed to set locker status to offline.' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, message: 'Locker not found.' });
        }
        console.log(`Locker ${lockerId} status set to OFFLINE.`);
        res.json({ success: true, message: `Locker ${lockerId} disconnected.` });
    });
});


// NEW ROUTE: Client-side locker application view - now renders locker_details.ejs
app.get('/client_locker/:id', (req, res) => {
    const lockerId = req.params.id;
    // When rendering for the client view, pass isClientView as true
    const currentDb = getDb(); // Need to fetch locker and boxes for initial render
    Promise.all([
        new Promise((resolve, reject) => {
            currentDb.get('SELECT * FROM lockers WHERE locker_id = ?', [lockerId], (err, row) => {
                if (err) reject(err);
                else if (!row) reject(new Error('Locker not found.'));
                else resolve(row);
            });
        }),
        new Promise((resolve, reject) => {
            currentDb.all('SELECT * FROM locker_boxes WHERE locker_id = ?', [lockerId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        })
    ])
    .then(([locker, boxes]) => {
        currentDb.close();
        res.render('locker_details', { locker: locker, boxes: boxes, isClientView: true });
    })
    .catch(err => {
        currentDb.close();
        console.error('Error fetching locker details for client view:', err.message);
        if (err.message === 'Locker not found.') {
            res.status(404).send('Locker not found for client view.');
        } else {
            res.status(500).send('Error retrieving locker details for client view.');
        }
    });
});


// API ROUTE: Fill a box (client-initiated)
app.post('/api/locker/:locker_id/box/:box_id/fill_parcel', (req, res) => {
    const { locker_id, box_id } = req.params;
    const { height, width, length, volume, parcel_name, customer_name, customer_phone, occupied_from, occupied_to, code1_open, code2_open, box_health } = req.body;

    // Basic validation for required fields
    if (!height || !width || !length || !volume || !parcel_name || !customer_name) {
        return res.status(400).json({ success: false, message: 'Missing required parcel data (dimensions, parcel name, customer name).' });
    }

    const currentDb = getDb();

    currentDb.serialize(() => {
        currentDb.run('BEGIN TRANSACTION;', (txErr) => {
            if (txErr) {
                currentDb.close();
                console.error('Error starting transaction for fill_parcel:', txErr.message);
                return res.status(500).json({ success: false, message: 'Transaction failed to start.' });
            }
        });

        // Update the box record
        const updateSql = `
            UPDATE locker_boxes
            SET
                status = 'full',
                ecommerce_name = ?,
                occupied_from = ?,
                occupied_to = ?,
                code1_open = ?,
                code2_open = ?,
                box_health = ?,
                customer_name = ?,
                customer_phone = ?,
                parcel_name = ?
            WHERE
                box_id = ? AND locker_id = ? AND status = 'empty'
        `; // Only allow filling if the box is empty

        currentDb.run(updateSql, [
            req.body.ecommerce_name || 'Client App', // Default if not provided
            occupied_from || getCurrentTimestamp(), // Default to current time if not provided
            occupied_to || null,
            code1_open || null,
            code2_open || null,
            box_health || 'working', // Default to working if not provided
            customer_name,
            customer_phone || null,
            parcel_name,
            box_id, locker_id
        ], function(err) {
            if (err) {
                currentDb.run('ROLLBACK;', () => {
                    currentDb.close();
                    console.error('Error filling box:', err.message);
                    res.status(500).json({ success: false, message: `Failed to fill box: ${err.message}` });
                });
                return;
            }
            if (this.changes === 0) {
                currentDb.run('ROLLBACK;', () => {
                    currentDb.close();
                    // This means box was not found or was not empty
                    res.status(400).json({ success: false, message: 'Box not found or not empty. Cannot fill.' });
                });
                return;
            }

            // After successful box update, update parent locker aggregates
            currentDb.run('COMMIT;', (commitErr) => {
                if (commitErr) {
                    currentDb.close();
                    console.error('Commit error after fill_parcel:', commitErr.message);
                    return res.status(500).json({ success: false, message: 'Failed to commit fill action.' });
                }
                const tempDb = getDb();
                updateLockerAggregates(locker_id, tempDb, (aggErr) => {
                    tempDb.close();
                    if (aggErr) {
                        console.error('Error updating locker aggregates after fill_parcel:', aggErr.message);
                        return res.status(500).json({ success: false, message: 'Box filled, but failed to update locker aggregates.' });
                    }
                    console.log(`Box ${box_id} filled and locker aggregates updated.`);
                    res.json({ success: true, message: 'Box filled successfully!' });
                });
            });
        });
    });
});

// API ROUTE: Pick up a parcel (client-initiated)
app.post('/api/locker/:locker_id/box/:box_id/pickup_parcel', (req, res) => {
    const { locker_id, box_id } = req.params;
    const currentDb = getDb();

    // 1. Get the current state of the box
    currentDb.get('SELECT * FROM locker_boxes WHERE box_id = ? AND locker_id = ?', [box_id, locker_id], (err, currentBoxState) => {
        if (err) {
            currentDb.close();
            console.error('Error fetching current box state for pickup_parcel:', err.message);
            return res.status(500).json({ success: false, message: 'Failed to fetch box state for pickup.' });
        }
        if (!currentBoxState) {
            currentDb.close();
            return res.status(404).json({ success: false, message: 'Box not found.' });
        }

        // Prevent pickup if box is already empty or not in working health
        if (currentBoxState.status === 'empty' || currentBoxState.box_health !== 'working') {
             currentDb.close();
             return res.status(400).json({ success: false, message: 'Box cannot be picked up if it is already empty or not in working health.' });
        }

        currentDb.serialize(() => {
            currentDb.run('BEGIN TRANSACTION;', (txErr) => {
                if (txErr) {
                    currentDb.close();
                    console.error('Error starting transaction for pickup_parcel:', txErr.message);
                    return res.status(500).json({ success: false, message: 'Transaction failed to start.' });
                }
            });

            // 2. Log to history (preserving the state BEFORE it becomes empty)
            const historySql = `
                INSERT INTO box_history (
                    box_id, locker_id, height, width, length, volume, status,
                    ecommerce_name, occupied_from, occupied_to, code1_open, code2_open, box_health,
                    customer_name, customer_phone, parcel_name, history_timestamp
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            currentDb.run(historySql, [
                currentBoxState.box_id,
                currentBoxState.locker_id,
                currentBoxState.height,
                currentBoxState.width,
                currentBoxState.length,
                currentBoxState.volume,
                currentBoxState.status, // Log the status BEFORE reset (e.g., 'full', 'reserved', 'in use')
                currentBoxState.ecommerce_name,
                currentBoxState.occupied_from,
                currentBoxState.occupied_to,
                currentBoxState.code1_open,
                currentBoxState.code2_open,
                currentBoxState.box_health,
                currentBoxState.customer_name,
                currentBoxState.customer_phone,
                currentBoxState.parcel_name,
                getCurrentTimestamp()
            ], (historyErr) => {
                if (historyErr) {
                    currentDb.run('ROLLBACK;', () => {
                        currentDb.close();
                        console.error('Error logging pickup_parcel history:', historyErr.message);
                        res.status(500).json({ success: false, message: `Failed to log pickup history: ${historyErr.message}` });
                    });
                    return;
                }

                // 3. Reset the main box record to an empty state
                const resetSql = `
                    UPDATE locker_boxes
                    SET
                        status = 'empty',
                        ecommerce_name = NULL,
                        occupied_from = NULL,
                        occupied_to = NULL,
                        code1_open = NULL,
                        code2_open = NULL,
                        customer_name = NULL,
                        parcel_name = NULL,
                        customer_phone = NULL,
                        box_health = 'working'
                    WHERE
                        box_id = ? AND locker_id = ?
                `;
                currentDb.run(resetSql, [box_id, locker_id], (resetErr) => {
                    if (resetErr) {
                        currentDb.run('ROLLBACK;', () => {
                            currentDb.close();
                            console.error('Error resetting box after pickup_parcel:', resetErr.message);
                            res.status(500).json({ success: false, message: `Failed to reset box status: ${resetErr.message}` });
                        });
                        return;
                    }
                    currentDb.run('COMMIT;', () => {
                        if (commitErr) {
                            currentDb.close();
                            console.error('Commit error after pickup_parcel reset:', commitErr.message);
                            return res.status(500).json({ success: false, message: 'Failed to commit pickup action.' });
                        }
                        const tempDb = getDb();
                        updateLockerAggregates(locker_id, tempDb, (aggErr) => {
                            tempDb.close();
                            if (aggErr) {
                                console.error('Error updating locker aggregates after pickup_parcel:', aggErr.message);
                                return res.status(500).json({ success: false, message: 'Parcel picked up, but failed to update locker aggregates.' });
                            }
                            console.log(`Box ${box_id} picked up, reset, and locker aggregates updated.`);
                            res.json({ success: true, message: 'Parcel picked up successfully!' });
                        });
                    });
                });
            });
        });
    });
});


// ROUTE (GET): Display form to edit a specific box (Admin Panel only)
app.get('/locker/:locker_id/box/edit/:box_id', (req, res) => {
    const { locker_id, box_id } = req.params;
    const currentDb = getDb();

    currentDb.get('SELECT * FROM locker_boxes WHERE box_id = ? AND locker_id = ?', [box_id, locker_id], (err, box) => {
        currentDb.close();
        if (err) {
            console.error('Error fetching box for edit:', err.message);
            return res.status(500).send('Error retrieving box data.');
        }
        if (!box) {
            return res.status(404).send('Box not found for this locker.');
        }
        res.render('edit_box', { box: box, lockerId: locker_id });
    });
});

// ROUTE (POST): Handle submission of edited box data (Admin Panel only)
// This route remains for the traditional admin form submission.
app.post('/locker/:locker_id/box/edit/:box_id', (req, res) => {
    const { locker_id, box_id } = req.params;
    const { height, width, length, volume, status, ecommerce_name, occupied_from, occupied_to, code1_open, code2_open, box_health, customer_name, customer_phone, parcel_name } = req.body;

    if (!height || !width || !length || !volume || !status || !box_health) {
        return res.status(400).send('Required box fields must be filled.');
    }

    const currentDb = getDb();
    currentDb.serialize(() => {
        currentDb.run('BEGIN TRANSACTION;', (txErr) => {
            if (txErr) {
                currentDb.close();
                console.error('Error starting transaction:', txErr.message);
                return res.status(500).send('Error updating box (transaction failed).');
            }
        });

        const updateSql = `
            UPDATE locker_boxes
            SET
                height = ?,
                width = ?,
                length = ?,
                volume = ?,
                status = ?,
                ecommerce_name = ?,
                occupied_from = ?,
                occupied_to = ?,
                code1_open = ?,
                code2_open = ?,
                box_health = ?,
                customer_name = ?,
                customer_phone = ?,
                parcel_name = ?
            WHERE
                box_id = ? AND locker_id = ?
        `;
        currentDb.run(updateSql, [
            height, width, length, volume, status,
            ecommerce_name || null,
            occupied_from || null,
            occupied_to || null,
            code1_open || null,
            code2_open || null,
            box_health,
            customer_name || null,
            customer_phone || null,
            parcel_name || null,
            box_id, locker_id
        ], function(err) {
            if (err) {
                currentDb.run('ROLLBACK;', () => {
                    currentDb.close();
                    console.error('Error updating box:', err.message);
                    res.status(500).send('Error updating box in database.');
                });
                return;
            }
            currentDb.run('COMMIT;', (commitErr) => {
                if (commitErr) {
                    currentDb.close();
                    console.error('Commit error after box update:', commitErr.message);
                    return res.status(500).send('Error committing box update.');
                }
                const tempDb = getDb();
                updateLockerAggregates(locker_id, tempDb, (aggErr) => {
                    tempDb.close();
                    if (aggErr) {
                        console.error('Error updating locker aggregates after box edit:', aggErr.message);
                    }
                    res.redirect(`/locker/${locker_id}`);
                });
            });
        });
    });
});


// ROUTE (POST): Handle 'Picked' action for a box (Admin Panel only)
// This route remains for the traditional admin form submission.
app.post('/locker/:locker_id/box/pickup/:box_id', (req, res) => {
    const { locker_id, box_id } = req.params;
    const currentDb = getDb();

    currentDb.get('SELECT * FROM locker_boxes WHERE box_id = ? AND locker_id = ?', [box_id, locker_id], (err, currentBoxState) => {
        if (err) {
            currentDb.close();
            console.error('Error fetching current box state for pickup:', err.message);
            return res.status(500).send('Error processing pickup action.');
        }
        if (!currentBoxState) {
            currentDb.close();
            return res.status(404).send('Box not found for pickup action.');
        }

        if (currentBoxState.status === 'empty' || currentBoxState.box_health !== 'working') {
             currentDb.close();
             return res.status(400).send('Box cannot be picked up if it is already empty or not in working health.');
        }

        currentDb.serialize(() => {
            currentDb.run('BEGIN TRANSACTION;', (txErr) => {
                if (txErr) {
                    currentDb.close();
                    console.error('Error starting transaction:', txErr.message);
                    return res.status(500).send('Error processing pickup (transaction failed).');
                }
            });

            const historySql = `
                INSERT INTO box_history (
                    box_id, locker_id, height, width, length, volume, status,
                    ecommerce_name, occupied_from, occupied_to, code1_open, code2_open, box_health,
                    customer_name, customer_phone, parcel_name, history_timestamp
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            currentDb.run(historySql, [
                currentBoxState.box_id,
                currentBoxState.locker_id,
                currentBoxState.height,
                currentBoxState.width,
                currentBoxState.length,
                currentBoxState.volume,
                currentBoxState.status,
                currentBoxState.ecommerce_name,
                currentBoxState.occupied_from,
                currentBoxState.occupied_to,
                currentBoxState.code1_open,
                currentBoxState.code2_open,
                currentBoxState.box_health,
                currentBoxState.customer_name,
                currentBoxState.customer_phone,
                currentBoxState.parcel_name,
                getCurrentTimestamp()
            ], (historyErr) => {
                if (historyErr) {
                    currentDb.run('ROLLBACK;', () => {
                        currentDb.close();
                        console.error('Error logging pickup history:', historyErr.message);
                        res.status(500).send('Error logging pickup history.');
                    });
                    return;
                }

                const resetSql = `
                    UPDATE locker_boxes
                    SET
                        status = 'empty',
                        ecommerce_name = NULL,
                        occupied_from = NULL,
                        occupied_to = NULL,
                        code1_open = NULL,
                        code2_open = NULL,
                        customer_name = NULL,
                        parcel_name = NULL,
                        customer_phone = NULL,
                        box_health = 'working'
                    WHERE
                        box_id = ? AND locker_id = ?
                `;
                currentDb.run(resetSql, [box_id, locker_id], (resetErr) => {
                    if (resetErr) {
                        currentDb.run('ROLLBACK;', () => {
                            currentDb.close();
                            console.error('Error resetting box:', resetErr.message);
                            res.status(500).send('Error resetting box status.');
                        });
                        return;
                    }
                    currentDb.run('COMMIT;', (commitErr) => {
                        if (commitErr) {
                            currentDb.close();
                            console.error('Commit error after pickup reset:', commitErr.message);
                            return res.status(500).send('Error committing pickup reset.');
                        }
                        const tempDb = getDb();
                        updateLockerAggregates(locker_id, tempDb, (aggErr) => {
                            tempDb.close();
                            if (aggErr) {
                                console.error('Error updating locker aggregates after pickup:', aggErr.message);
                            }
                            res.redirect(`/locker/${locker_id}`);
                        });
                    });
                });
            });
        });
    });
});


// ROUTE: Display history for a specific box
app.get('/box_history/:box_id', (req, res) => {
    const boxId = req.params.box_id;
    const currentDb = getDb();

    Promise.all([
        new Promise((resolve, reject) => {
            currentDb.all('SELECT * FROM box_history WHERE box_id = ? ORDER BY history_timestamp DESC', [boxId], (err, historyEntries) => {
                if (err) reject(err);
                else resolve(historyEntries);
            });
        }),
        new Promise((resolve, reject) => {
            currentDb.get('SELECT * FROM locker_boxes WHERE box_id = ?', [boxId], (err, currentBox) => {
                if (err) reject(err);
                else resolve(currentBox);
            });
        })
    ])
    .then(([historyEntries, currentBox]) => {
        currentDb.close();
        res.render('box_history', { boxId: boxId, historyEntries: historyEntries, currentBox: currentBox, lockerId: currentBox ? currentBox.locker_id : null });
    })
    .catch(err => {
        currentDb.close();
        console.error('Error fetching box history or current box details:', err.message);
        res.status(500).send('Error retrieving box history or details.');
    });
});


// ROUTE (GET): Display form to edit a specific locker
app.get('/edit_locker/:id', (req, res) => {
    const lockerId = req.params.id;
    const currentDb = getDb();

    currentDb.get('SELECT * FROM lockers WHERE locker_id = ?', [lockerId], (err, locker) => {
        currentDb.close();
        if (err) {
            console.error('Error fetching locker for edit:', err.message);
            return res.status(500).send('Error retrieving locker data.');
        }
        if (!locker) {
            return res.status(404).send('Locker not found.');
        }
        res.render('edit_locker', { locker: locker });
    });
});

// ROUTE (POST): Handle submission of edited locker data
app.post('/edit_locker/:id', (req, res) => {
    const lockerId = req.params.id;
    const { name, business_name, latitude, longitude, opening_hours, status, fullness, total_boxes, full_boxes, empty_boxes_left } = req.body;

    if (!name || !business_name || !latitude || !longitude || !opening_hours || !status || !fullness || total_boxes === undefined || full_boxes === undefined || empty_boxes_left === undefined) {
        return res.status(400).send('All required locker fields must be filled.');
    }

    const newTotalBoxes = parseInt(total_boxes, 10);
    const formFullBoxes = parseInt(full_boxes, 10);
    const formEmptyBoxesLeft = parseInt(empty_boxes_left, 10);


    if (isNaN(newTotalBoxes) || newTotalBoxes < 0 || isNaN(formFullBoxes) || formFullBoxes < 0 || isNaN(formEmptyBoxesLeft) || formEmptyBoxesLeft < 0) {
        return res.status(400).send('Box counts must be non-negative numbers.');
    }

    const currentDb = getDb();

    currentDb.serialize(() => {
        currentDb.run('BEGIN TRANSACTION;', (txErr) => {
            if (txErr) {
                currentDb.close();
                console.error('Error starting transaction for edit_locker:', txErr.message);
                return res.status(500).send('Error updating locker (transaction failed).');
            }
        });

        currentDb.all('SELECT box_id, status FROM locker_boxes WHERE locker_id = ?', [lockerId], (err, existingBoxes) => {
            if (err) {
                currentDb.run('ROLLBACK;', () => {
                    currentDb.close();
                    console.error('Error fetching existing boxes for locker edit:', err.message);
                    res.status(500).send('Error updating locker: Could not fetch current box data.');
                });
                return;
            }

            const currentActualBoxesCount = existingBoxes.length;
            const occupiedBoxCount = existingBoxes.filter(box => box.status !== 'empty').length;

            if (newTotalBoxes < occupiedBoxCount) {
                currentDb.run('ROLLBACK;', () => {
                    currentDb.close();
                    res.status(400).send(`Cannot reduce total boxes to ${newTotalBoxes}. There are currently ${occupiedBoxCount} occupied boxes. Please clear or move parcels first.`);
                });
                return;
            }

            let boxesToCreate = 0;
            let boxesToDelete = 0;

            if (newTotalBoxes > currentActualBoxesCount) {
                boxesToCreate = newTotalBoxes - currentActualBoxesCount;
            } else if (newTotalBoxes < currentActualBoxesCount) {
                boxesToDelete = currentActualBoxesCount - newTotalBoxes;
            }

            const promises = [];

            if (boxesToCreate > 0) {
                const insertBoxSql = `
                    INSERT INTO locker_boxes (
                        locker_id, height, width, length, volume, status,
                        ecommerce_name, occupied_from, occupied_to, code1_open, code2_open, box_health,
                        customer_name, customer_phone, parcel_name
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
                const defaultHeight = 20;
                const defaultWidth = 20;
                const defaultLength = 20;
                const defaultVolume = defaultHeight * defaultWidth * defaultLength;

                for (let i = 0; i < boxesToCreate; i++) {
                    promises.push(new Promise((resolve, reject) => {
                        currentDb.run(insertBoxSql, [
                            lockerId, defaultHeight, defaultWidth, defaultLength, defaultVolume, 'empty',
                            null, null, null, null, null, 'working', null, null, null
                        ], function(insertErr) {
                            if (insertErr) {
                                console.error('Error adding new box during locker edit:', insertErr.message);
                                reject(insertErr);
                            } else {
                                resolve();
                            }
                        });
                    }));
                }
            }

            if (boxesToDelete > 0) {
                currentDb.all('SELECT box_id FROM locker_boxes WHERE locker_id = ? AND status = "empty" ORDER BY box_id DESC', [lockerId], (err, emptyBoxesToDelete) => {
                    if (err) {
                        currentDb.run('ROLLBACK;', () => {
                            currentDb.close();
                            console.error('Error fetching empty boxes for deletion:', err.message);
                            res.status(500).send('Error updating locker: Could not fetch empty boxes for deletion.');
                        });
                        return;
                    }

                    let deletedCount = 0;
                    for (const box of emptyBoxesToDelete) {
                        if (deletedCount < boxesToDelete) {
                            promises.push(new Promise((resolve, reject) => {
                                currentDb.run('DELETE FROM locker_boxes WHERE box_id = ?', [box.box_id], function(deleteErr) {
                                    if (deleteErr) {
                                        console.error('Error deleting box during locker edit:', deleteErr.message);
                                        reject(deleteErr);
                                    } else {
                                        deletedCount++;
                                        resolve();
                                    }
                                });
                            }));
                        } else {
                            break;
                        }
                    }

                    if (deletedCount < boxesToDelete) {
                         currentDb.run('ROLLBACK;', () => {
                             currentDb.close();
                             res.status(400).send(`Could not delete required number of empty boxes. There are still ${boxesToDelete - deletedCount} boxes that need to be cleared or moved before reducing total boxes further.`);
                         });
                         return;
                    }

                    Promise.all(promises)
                        .then(() => {
                            const updateLockerMetaSql = `
                                UPDATE lockers
                                SET
                                    name = ?,
                                    business_name = ?,
                                    latitude = ?,
                                    longitude = ?,
                                    opening_hours = ?,
                                    status = ?
                                WHERE
                                    locker_id = ?
                            `;
                            currentDb.run(updateLockerMetaSql, [
                                name, business_name, latitude, longitude, opening_hours, status, lockerId
                            ], function(metaUpdateErr) {
                                if (metaUpdateErr) {
                                    currentDb.run('ROLLBACK;', () => {
                                        currentDb.close();
                                        console.error('Error updating locker metadata during edit:', metaUpdateErr.message);
                                        res.status(500).send('Error updating locker metadata.');
                                    });
                                    return;
                                }
                                updateLockerAggregates(lockerId, currentDb, (aggErr) => {
                                    if (aggErr) {
                                        currentDb.run('ROLLBACK;', () => {
                                            currentDb.close();
                                            console.error('Error updating locker aggregates after structural changes:', aggErr.message);
                                            res.status(500).send('Error updating locker status after box adjustments.');
                                        });
                                        return;
                                    }
                                    currentDb.run('COMMIT;', (commitErr) => {
                                        currentDb.close();
                                        if (commitErr) console.error('Commit error after full locker structural update:', commitErr.message);
                                        console.log(`Locker with ID ${lockerId} and its boxes structurally updated and aggregates refreshed.`);
                                        res.redirect(`/locker/${lockerId}`);
                                    });
                                });
                            });
                        })
                        .catch(promiseErr => {
                            currentDb.run('ROLLBACK;', () => {
                                currentDb.close();
                                console.error('Error during box creation/deletion in locker edit:', promiseErr.message);
                                res.status(500).send('Error adjusting individual boxes during locker update.');
                            });
                        });
                });
            } else {
                 const updateLockerMetaSql = `
                     UPDATE lockers
                     SET
                         name = ?,
                         business_name = ?,
                         latitude = ?,
                         longitude = ?,
                         opening_hours = ?,
                         status = ?
                     WHERE
                         locker_id = ?
                 `;
                 currentDb.run(updateLockerMetaSql, [
                     name, business_name, latitude, longitude, opening_hours, status, lockerId
                 ], function(metaUpdateErr) {
                     if (metaUpdateErr) {
                         currentDb.run('ROLLBACK;', () => {
                             currentDb.close();
                             console.error('Error updating locker metadata during edit (no structural changes):', metaUpdateErr.message);
                             res.status(500).send('Error updating locker metadata.');
                         });
                         return;
                     }
                     updateLockerAggregates(lockerId, currentDb, (aggErr) => {
                         if (aggErr) {
                             currentDb.run('ROLLBACK;', () => {
                                 currentDb.close();
                                 console.error('Error updating locker aggregates after metadata changes:', aggErr.message);
                                 res.status(500).send('Error updating locker status after metadata changes.');
                             });
                             return;
                         }
                         currentDb.run('COMMIT;', (commitErr) => {
                             currentDb.close();
                             if (commitErr) console.error('Commit error after simple locker update:', commitErr.message);
                             console.log(`Locker with ID ${lockerId} updated (no structural changes, aggregates refreshed).`);
                             res.redirect(`/locker/${lockerId}`);
                         });
                     });
                 });
            }
        });
    });
});


// Error handling for routes not found
app.use((req, res) => {
    res.status(404).send('Page Not Found');
});

