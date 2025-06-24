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

// Helper to get current timestamp in YYYY-MM-DD HH:MM:SS format
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

// ROUTE: Display details and boxes for a specific locker
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
        res.render('locker_details', { locker: locker, boxes: boxes });
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
    // Destructure all fields, including the new parcel_name
    const { height, width, length, volume, status, ecommerce_name, occupied_from, occupied_to, code1_open, code2_open, box_health, customer_name, customer_phone, parcel_name } = req.body;

    // Basic validation
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
                currentDb.close();
                if (commitErr) console.error('Commit error after standard update:', commitErr.message);
                console.log(`Box with ID ${box_id} updated.`);
                res.redirect(`/locker/${locker_id}`);
            });
        });
    });
});


// NEW ROUTE (POST): Handle 'Picked' action for a box
app.post('/locker/:locker_id/box/pickup/:box_id', (req, res) => {
    const { locker_id, box_id } = req.params;
    const currentDb = getDb();

    // 1. Get the current state of the box
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

        // Proceed only if the box is not already empty or in maintenance/offline state
        if (currentBoxState.status === 'empty' || currentBoxState.box_health !== 'working') {
             currentDb.close();
             return res.status(400).send('Box cannot be picked up if it is already empty or not in working health.');
        }

        currentDb.serialize(() => {
            currentDb.run('BEGIN TRANSACTION;', (txErr) => {
                if (txErr) {
                    currentDb.close();
                    console.error('Error starting transaction for pickup:', txErr.message);
                    return res.status(500).send('Error processing pickup (transaction failed).');
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
                currentBoxState.occupied_from,  // Occupied from date at pickup
                currentBoxState.occupied_to,    // Occupied to date at pickup
                currentBoxState.code1_open,
                currentBoxState.code2_open,
                currentBoxState.box_health,
                currentBoxState.customer_name,
                currentBoxState.customer_phone,
                currentBoxState.parcel_name,    // parcel_name at pickup
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
                        customer_phone = NULL,
                        parcel_name = NULL,
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
                        currentDb.close();
                        if (commitErr) console.error('Commit error after pickup:', commitErr.message);
                        console.log(`Box ${box_id} picked up and reset.`);
                        res.redirect(`/locker/${locker_id}`); // Redirect back to the locker details page
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
    // Destructure all fields from the form, including box counts
    const { name, business_name, latitude, longitude, opening_hours, status, fullness, total_boxes, full_boxes, empty_boxes_left } = req.body;

    // Basic validation for locker fields
    if (!name || !business_name || !latitude || !longitude || !status || !fullness || total_boxes === undefined || full_boxes === undefined || empty_boxes_left === undefined) {
        return res.status(400).send('All required locker fields must be filled.');
    }

    const newTotalBoxes = parseInt(total_boxes, 10);
    const newFullBoxes = parseInt(full_boxes, 10);
    const newEmptyBoxesLeft = parseInt(empty_boxes_left, 10);

    if (isNaN(newTotalBoxes) || newTotalBoxes < 0 || isNaN(newFullBoxes) || newFullBoxes < 0 || isNaN(newEmptyBoxesLeft) || newEmptyBoxesLeft < 0) {
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

        // First, get the current number of actual boxes and their statuses for this locker
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

            // Prevent reducing total boxes below occupied count
            if (newTotalBoxes < occupiedBoxCount) {
                currentDb.run('ROLLBACK;', () => {
                    currentDb.close();
                    res.status(400).send(`Cannot reduce total boxes to ${newTotalBoxes}. There are currently ${occupiedBoxCount} occupied boxes.`);
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

            // Add new empty boxes if needed
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

            // Delete boxes if needed
            if (boxesToDelete > 0) {
                // Fetch empty boxes to prioritize deletion
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

                    // If we still need to delete boxes after deleting all empty ones (shouldn't happen with the `occupiedBoxCount` check, but as a safeguard)
                    // This scenario implies we'd need to delete occupied boxes, which we are preventing.
                    if (deletedCount < boxesToDelete) {
                        currentDb.run('ROLLBACK;', () => {
                            currentDb.close();
                            res.status(400).send(`Cannot delete enough empty boxes. Some occupied boxes would need to be removed. Please empty boxes first.`);
                        });
                        return;
                    }

                    // Proceed with all pending promises (additions and deletions)
                    Promise.all(promises)
                        .then(() => {
                            // After all box operations, fetch actual counts to update the locker record accurately
                            currentDb.get('SELECT COUNT(*) as total, SUM(CASE WHEN status = "full" THEN 1 ELSE 0 END) as full, SUM(CASE WHEN status = "empty" THEN 1 ELSE 0 END) as empty FROM locker_boxes WHERE locker_id = ?', [lockerId], (countErr, counts) => {
                                if (countErr) {
                                    currentDb.run('ROLLBACK;', () => {
                                        currentDb.close();
                                        console.error('Error recalculating box counts:', countErr.message);
                                        res.status(500).send('Error updating locker: Could not recalculate box counts.');
                                    });
                                    return;
                                }

                                const actualTotal = counts.total || 0;
                                const actualFull = counts.full || 0;
                                const actualEmpty = counts.empty || 0;

                                // Finally, update the locker's aggregate fields
                                const updateLockerSql = `
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
                                currentDb.run(updateLockerSql, [
                                    name, business_name, latitude, longitude, opening_hours, status, fullness,
                                    actualTotal, actualFull, actualEmpty, // Use actual counts
                                    lockerId
                                ], function(updateErr) {
                                    if (updateErr) {
                                        currentDb.run('ROLLBACK;', () => {
                                            currentDb.close();
                                            console.error('Error updating locker aggregate data:', updateErr.message);
                                            res.status(500).send('Error updating locker in database.');
                                        });
                                        return;
                                    }
                                    currentDb.run('COMMIT;', (commitErr) => {
                                        currentDb.close();
                                        if (commitErr) console.error('Commit error after full locker update:', commitErr.message);
                                        console.log(`Locker with ID ${lockerId} and its boxes updated.`);
                                        res.redirect(`/locker/${lockerId}`); // Redirect to locker details page
                                    });
                                });
                            });
                        })
                        .catch(promiseErr => {
                            currentDb.run('ROLLBACK;', () => {
                                currentDb.close();
                                console.error('Error during box creation/deletion:', promiseErr.message);
                                res.status(500).send('Error adjusting individual boxes during locker update.');
                            });
                        });
                }); // End of currentDb.all for empty boxes
            } else {
                 // If no boxes needed to be added or deleted, just update the locker's aggregate fields
                 // (These might have been changed manually, even if total_boxes didn't change)
                 const updateLockerSql = `
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
                 currentDb.run(updateLockerSql, [
                     name, business_name, latitude, longitude, opening_hours, status, fullness,
                     newTotalBoxes, newFullBoxes, newEmptyBoxesLeft, // Use values directly from form if no box structural changes
                     lockerId
                 ], function(updateErr) {
                     if (updateErr) {
                         currentDb.run('ROLLBACK;', () => {
                             currentDb.close();
                             console.error('Error updating locker aggregate data (no box changes):', updateErr.message);
                             res.status(500).send('Error updating locker in database.');
                         });
                         return;
                     }
                     currentDb.run('COMMIT;', (commitErr) => {
                         currentDb.close();
                         if (commitErr) console.error('Commit error after simple locker update:', commitErr.message);
                         console.log(`Locker with ID ${lockerId} updated (no box structural changes).`);
                         res.redirect(`/locker/${lockerId}`);
                     });
                 });
            }
        }); // End of currentDb.all for existing boxes
    }); // End of currentDb.serialize
});


// NEW ROUTE (POST): Handle 'Picked' action for a box
app.post('/locker/:locker_id/box/pickup/:box_id', (req, res) => {
    const { locker_id, box_id } = req.params;
    const currentDb = getDb();

    // 1. Get the current state of the box
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

        // Proceed only if the box is not already empty or in maintenance/offline state
        if (currentBoxState.status === 'empty' || currentBoxState.box_health !== 'working') {
             currentDb.close();
             return res.status(400).send('Box cannot be picked up if it is already empty or not in working health.');
        }

        currentDb.serialize(() => {
            currentDb.run('BEGIN TRANSACTION;', (txErr) => {
                if (txErr) {
                    currentDb.close();
                    console.error('Error starting transaction for pickup:', txErr.message);
                    return res.status(500).send('Error processing pickup (transaction failed).');
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
                currentBoxState.occupied_from,  // Occupied from date at pickup
                currentBoxState.occupied_to,    // Occupied to date at pickup
                currentBoxState.code1_open,
                currentBoxState.code2_open,
                currentBoxState.box_health,
                currentBoxState.customer_name,
                currentBoxState.customer_phone,
                currentBoxState.parcel_name,    // parcel_name at pickup
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
                            console.error('Error resetting box:', resetErr.message);
                            res.status(500).send('Error resetting box status.');
                        });
                        return;
                    }

                    // After box is reset, update the locker's aggregate counts
                    currentDb.get('SELECT COUNT(*) as total, SUM(CASE WHEN status = "full" THEN 1 ELSE 0 END) as full, SUM(CASE WHEN status = "empty" THEN 1 ELSE 0 END) as empty FROM locker_boxes WHERE locker_id = ?', [locker_id], (countErr, counts) => {
                        if (countErr) {
                            currentDb.run('ROLLBACK;', () => {
                                currentDb.close();
                                console.error('Error recalculating locker counts after pickup:', countErr.message);
                                res.status(500).send('Error updating locker counts after pickup.');
                            });
                            return;
                        }

                        const actualTotal = counts.total || 0;
                        const actualFull = counts.full || 0;
                        const actualEmpty = counts.empty || 0;

                        const updateLockerAggregatesSql = `
                            UPDATE lockers
                            SET
                                full_boxes = ?,
                                empty_boxes_left = ?
                            WHERE
                                locker_id = ?
                        `;
                        currentDb.run(updateLockerAggregatesSql, [actualFull, actualEmpty, locker_id], (updateLockerErr) => {
                            if (updateLockerErr) {
                                currentDb.run('ROLLBACK;', () => {
                                    currentDb.close();
                                    console.error('Error updating locker aggregates after pickup:', updateLockerErr.message);
                                    res.status(500).send('Error updating locker aggregates after pickup.');
                                });
                                return;
                            }
                            currentDb.run('COMMIT;', (commitErr) => {
                                currentDb.close();
                                if (commitErr) console.error('Commit error after pickup and locker update:', commitErr.message);
                                console.log(`Box ${box_id} picked up, reset, and locker aggregates updated.`);
                                res.redirect(`/locker/${locker_id}`); // Redirect back to the locker details page
                            });
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

// Error handling for routes not found
app.use((req, res) => {
    res.status(404).send('Page Not Found');
});

