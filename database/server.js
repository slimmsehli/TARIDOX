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

// Route to display all lockers
app.get('/', (req, res) => {
    const currentDb = getDb(); // Get a new connection for this request
    currentDb.all('SELECT * FROM lockers', (err, rows) => {
        currentDb.close(); // Close the connection after query
        if (err) {
            console.error('Error fetching lockers:', err.message);
            res.status(500).send('Error retrieving lockers');
            return;
        }
        res.render('index', { lockers: rows });
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
        currentDb.run('BEGIN TRANSACTION;');

        // 1. Insert the new locker into the lockers table
        const insertLockerSql = `
            INSERT INTO lockers (name, business_name, latitude, longitude, opening_hours, status, fullness, total_boxes, full_boxes, empty_boxes_left)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        currentDb.run(insertLockerSql, [
            name, business_name, latitude, longitude, opening_hours, status, fullness, numBoxes, full_boxes, empty_boxes_left
        ], function(err) {
            if (err) {
                currentDb.run('ROLLBACK;', (rollbackErr) => { // Always attempt rollback on error
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
                    customer_name, customer_phone
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    null,    // customer_name (new)
                    null     // customer_phone (new)
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
                                res.redirect('/');
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
        currentDb.run('BEGIN TRANSACTION;');
        currentDb.run('DELETE FROM locker_boxes WHERE locker_id = ?', [lockerId], function(err) {
            if (err) {
                currentDb.run('ROLLBACK;', () => {
                    currentDb.close();
                    console.error('Error deleting associated boxes:', err.message);
                    res.status(500).send('Error deleting associated boxes');
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
                    console.log(`Locker with ID ${lockerId} and its boxes deleted.`);
                    res.redirect('/');
                });
            });
        });
    });
});

// ROUTE: Display details and boxes for a specific locker
app.get('/locker/:id', (req, res) => {
    const lockerId = req.params.id;
    const currentDb = getDb();

    // Using Promise.all to fetch both locker and box data concurrently
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
        res.render('locker_details', { locker: locker, boxes: boxes });
    })
    .catch(err => {
        currentDb.close(); // Ensure DB connection is closed on error
        console.error('Error fetching locker details or boxes:', err.message);
        if (err.message === 'Locker not found.') {
            res.status(404).send('Locker not found.');
        } else {
            res.status(500).send('Error retrieving locker details or boxes.');
        }
    });
});

// ROUTE (GET): Display form to edit a specific box
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

// ROUTE (POST): Handle submission of edited box data
app.post('/locker/:locker_id/box/edit/:box_id', (req, res) => {
    const { locker_id, box_id } = req.params;
    // Destructure all fields, including the new ones
    const { height, width, length, volume, status, ecommerce_name, occupied_from, occupied_to, code1_open, code2_open, box_health, customer_name, customer_phone } = req.body;

    // Basic validation (add more if needed)
    if (!height || !width || !length || !volume || !status || !box_health) {
        return res.status(400).send('Required box fields must be filled.');
    }

    const currentDb = getDb();
    const sql = `
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
            customer_phone = ?
        WHERE
            box_id = ? AND locker_id = ?
    `;

    currentDb.run(sql, [
        height, width, length, volume, status,
        ecommerce_name || null,
        occupied_from || null,
        occupied_to || null,
        code1_open || null,
        code2_open || null,
        box_health,
        customer_name || null,
        customer_phone || null,
        box_id, locker_id
    ], function(err) {
        currentDb.close();
        if (err) {
            console.error('Error updating box:', err.message);
            res.status(500).send('Error updating box in database.');
            return;
        }
        console.log(`Box with ID ${box_id} updated.`);
        res.redirect(`/locker/${locker_id}`); // Redirect back to the locker details page
    });
});

// NEW ROUTE (GET): Display form to edit a specific locker
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

// NEW ROUTE (POST): Handle submission of edited locker data
app.post('/edit_locker/:id', (req, res) => {
    const lockerId = req.params.id;
    const { name, business_name, latitude, longitude, opening_hours, status, fullness, total_boxes, full_boxes, empty_boxes_left } = req.body;

    // Basic validation
    if (!name || !business_name || !latitude || !longitude || !status || !fullness || total_boxes === undefined || full_boxes === undefined || empty_boxes_left === undefined) {
        return res.status(400).send('All required fields must be filled.');
    }

    const currentDb = getDb();
    const sql = `
        UPDATE lockers
        SET
            name = ?,
            business_name = ?,
            latitude = ?,
            longitude = ?,
            opening_hours = ?,
            status = ?,
            fullness = ?,
            total_boxes = ?,
            full_boxes = ?,
            empty_boxes_left = ?
        WHERE
            locker_id = ?
    `;

    currentDb.run(sql, [
        name, business_name, latitude, longitude, opening_hours, status, fullness, total_boxes, full_boxes, empty_boxes_left,
        lockerId
    ], function(err) {
        currentDb.close();
        if (err) {
            console.error('Error updating locker:', err.message);
            res.status(500).send('Error updating locker in database.');
            return;
        }
        console.log(`Locker with ID ${lockerId} updated.`);
        res.redirect('/'); // Redirect back to the main locker list
    });
});


// Error handling for routes not found
app.use((req, res) => {
    res.status(404).send('Page Not Found');
});

