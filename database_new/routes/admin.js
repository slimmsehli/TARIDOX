// routes/admin.js

const express = require('express');
const router = express.Router();
const path = require('path'); // Needed for res.render paths
const { getDb } = require('../db');
const { getCurrentTimestamp } = require('../utils/timestamp');
const { updateLockerAggregates } = require('../utils/lockerAggregates');

// Route to display all lockers (initial page load for admin)
router.get('/', (req, res) => {
    const currentDb = getDb();
    currentDb.all('SELECT * FROM lockers', (err, rows) => {
        currentDb.close();
        if (err) {
            console.error('Error fetching lockers for index page:', err.message);
            res.status(500).send('Error retrieving lockers');
            return;
        }
        res.render('index', { lockers: rows });
    });
});

// Route to display the form for adding a new locker
router.get('/add_locker', (req, res) => {
    res.render('add_locker');
});

// Route to handle adding a new locker and its boxes
router.post('/add_locker', (req, res) => {
    const { name, business_name, latitude, longitude, opening_hours, status, fullness, total_boxes, full_boxes, empty_boxes_left } = req.body;

    // Basic validation
    if (!name || !business_name || !latitude || !longitude || !status || !fullness || total_boxes === undefined || full_boxes === undefined || empty_boxes_left === undefined) {
        return res.status(400).send('All required fields must be filled.');
    }

    const numBoxes = parseInt(total_boxes, 10);
    if (isNaN(numBoxes) || numBoxes < 0) {
        return res.status(400).send('Total boxes must be a non-negative number.');
    }

    const currentDb = getDb();

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
                                if (commitErr) {
                                    currentDb.close();
                                    console.error('Commit error after box inserts:', commitErr.message);
                                    return res.status(500).send('Failed to commit add action.');
                                }
                                // After adding new boxes, ensure the locker's aggregate status is correct
                                updateLockerAggregates(newLockerId, (aggErr) => {
                                    currentDb.close(); // Close the connection after aggregates update
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
router.post('/delete_locker/:id', (req, res) => {
    const lockerId = req.params.id;
    const currentDb = getDb();

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
router.get('/locker/:id', (req, res) => {
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

// ROUTE (GET): Display form to edit a specific locker
router.get('/edit_locker/:id', (req, res) => {
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
router.post('/edit_locker/:id', (req, res) => {
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
                                updateLockerAggregates(lockerId, (aggErr) => {
                                    currentDb.close(); // Close the connection after aggregates update
                                    if (aggErr) {
                                        console.error('Error updating locker aggregates after structural changes:', aggErr.message);
                                        res.status(500).send('Error updating locker status after box adjustments.');
                                    }
                                    res.redirect(`/locker/${lockerId}`);
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
                     updateLockerAggregates(lockerId, (aggErr) => {
                         currentDb.close(); // Close the connection after aggregates update
                         if (aggErr) {
                             console.error('Error updating locker aggregates after metadata changes:', aggErr.message);
                             res.status(500).send('Error updating locker status after metadata changes.');
                         }
                         console.log(`Locker with ID ${lockerId} updated (no structural changes, aggregates refreshed).`);
                         res.redirect(`/locker/${lockerId}`);
                     });
                 });
            }
        });
    });
});

module.exports = router;

