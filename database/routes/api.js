// routes/api.js

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { getCurrentTimestamp } = require('../utils/timestamp');
const { updateLockerAggregates } = require('../utils/lockerAggregates');
const { generate4DigitCode } = require('../utils/codeGenerator');
const { sendEmail } = require('../utils/emailSender');

// Helper function to calculate distance between two points (Haversine formula)
// This is a simplified version and might not be perfectly accurate over long distances
// For production, consider a proper geospatial library or database extension.
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180; // φ, λ in radians
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    const d = R * c; // in metres
    return d;
}

// MODIFIED API ROUTE: Get all lockers, with optional geographic filtering
router.get('/lockers', (req, res) => {
    const { lat, lon, radius } = req.query; // Get lat, lon, radius from query parameters
    const currentDb = getDb();

    currentDb.all('SELECT * FROM lockers', (err, rows) => {
        currentDb.close(); // Close DB connection immediately after query
        if (err) {
            console.error('Error fetching all lockers API:', err.message);
            return res.status(500).json({ error: 'Error retrieving all lockers' });
        }

        let filteredLockers = rows;

        // Apply geographic filtering if lat, lon, and radius are provided
        if (lat && lon && radius) {
            const centerLat = parseFloat(lat);
            const centerLon = parseFloat(lon);
            const searchRadius = parseFloat(radius);

            if (isNaN(centerLat) || isNaN(centerLon) || isNaN(searchRadius)) {
                return res.status(400).json({ error: 'Invalid geographic parameters (lat, lon, radius must be numbers).' });
            }

            filteredLockers = rows.filter(locker => {
                // Ensure locker has valid coordinates
                if (locker.latitude && locker.longitude) {
                    const lockerLat = parseFloat(locker.latitude);
                    const lockerLon = parseFloat(locker.longitude);

                    if (isNaN(lockerLat) || isNaN(lockerLon)) {
                        console.warn(`Locker ${locker.locker_id} has invalid coordinates: lat=${locker.latitude}, lon=${locker.longitude}`);
                        return false; // Exclude lockers with invalid coordinates
                    }
                    const distance = haversineDistance(centerLat, centerLon, lockerLat, lockerLon);
                    return distance <= searchRadius;
                }
                return false; // Exclude lockers without coordinates
            });
        }
        res.json({ lockers: filteredLockers });
    });
});


// API endpoint to get locker and box data (for client-side app)
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
        res.json({ locker: locker, boxes: boxes }); // Send JSON response
    })
    .catch(err => {
        currentDb.close();
        console.error('Error fetching API locker data:', err.message);
        res.status(500).json({ error: 'Error retrieving locker data' });
    });
});

// API ROUTE: Update locker status to 'online'
router.post('/locker/:id/connect', (req, res) => {
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
router.post('/locker/:id/disconnect', (req, res) => {
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
router.get('/client_locker/:id', (req, res) => {
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
router.post('/locker/:locker_id/box/:box_id/fill_parcel', (req, res) => {
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
                updateLockerAggregates(locker_id, (aggErr) => {
                    currentDb.close(); // Close the connection after aggregates update
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
router.post('/locker/:locker_id/box/:box_id/pickup_parcel', (req, res) => {
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
                    currentDb.run('COMMIT;', (commitErr) => {
                        if (commitErr) {
                            currentDb.close();
                            console.error('Commit error after pickup_parcel reset:', commitErr.message);
                            return res.status(500).json({ success: false, message: 'Failed to commit pickup action.' });
                        }
                        updateLockerAggregates(locker_id, (aggErr) => {
                            currentDb.close(); // Close the connection after aggregates update
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

// API1 for Reservation
router.post('/reserve_box', async (req, res) => {
    const {
        locker_id,
        package_height,
        package_width,
        package_length,
        package_volume,
        customer_email,
        customer_name,
        customer_phone,
        parcel_name,
        ecommerce_name
    } = req.body;

    // 1. Basic Validation
    if (!locker_id || !package_height || !package_width || !package_length || !package_volume ||
        !customer_email || !customer_name || !parcel_name || !ecommerce_name) {
        return res.status(400).json({ success: false, message: 'Missing required reservation data.' });
    }

    const currentDb = getDb();

    try {
        // 2. Check Locker Availability and Status
        const locker = await new Promise((resolve, reject) => {
            currentDb.get('SELECT * FROM lockers WHERE locker_id = ?', [locker_id], (err, row) => {
                if (err) reject(err);
                else if (!row) reject(new Error('Locker not found.'));
                else resolve(row);
            });
        });

        if (locker.status !== 'online') {
            currentDb.close();
            return res.status(400).json({ success: false, message: `Locker ${locker.name} is not online (status: ${locker.status}).` });
        }
        if (locker.empty_boxes_left === 0) { // Using empty_boxes_left from aggregates
            currentDb.close();
            return res.status(400).json({ success: false, message: `Locker ${locker.name} is currently full or has no empty boxes.` });
        }


        // 3. Find Suitable Empty Box
        const emptyBoxes = await new Promise((resolve, reject) => {
            currentDb.all('SELECT * FROM locker_boxes WHERE locker_id = ? AND status = "empty" AND box_health = "working"', [locker_id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        let suitableBox = null;
        for (const box of emptyBoxes) {
            // Simple dimension check: package must fit within box dimensions
            if (package_height <= box.height &&
                package_width <= box.width &&
                package_length <= box.length &&
                package_volume <= box.volume) {
                suitableBox = box;
                break; // Found a suitable box, take the first one
            }
        }

        if (!suitableBox) {
            currentDb.close();
            return res.status(400).json({ success: false, message: 'No suitable empty box found in this locker for the package size.' });
        }

        // 4. Assign Box & Update Status
        const deliveryCode = generate4DigitCode();
        const occupiedFrom = getCurrentTimestamp();

        await new Promise((resolve, reject) => {
            currentDb.run('BEGIN TRANSACTION;', (txErr) => {
                if (txErr) reject(txErr); else resolve();
            });
        });

        const updateBoxSql = `
            UPDATE locker_boxes
            SET
                status = 'reserved',
                ecommerce_name = ?,
                occupied_from = ?,
                customer_name = ?,
                customer_phone = ?,
                parcel_name = ?,
                code1_open = ? -- Using code1_open for delivery code
            WHERE
                box_id = ? AND locker_id = ? AND status = 'empty'
        `;
        await new Promise((resolve, reject) => {
            currentDb.run(updateBoxSql, [
                ecommerce_name,
                occupiedFrom,
                customer_name,
                customer_phone || null,
                parcel_name,
                deliveryCode,
                suitableBox.box_id,
                locker_id
            ], function(err) {
                if (err) reject(err);
                else if (this.changes === 0) reject(new Error('Box not found or already occupied during reservation.'));
                else resolve();
            });
        });

        await new Promise((resolve, reject) => {
            currentDb.run('COMMIT;', (commitErr) => {
                if (commitErr) reject(commitErr); else resolve();
            });
        });

        // 5. Update Locker Aggregates
        await new Promise((resolve, reject) => {
            updateLockerAggregates(locker_id, (aggErr) => {
                if (aggErr) reject(aggErr); else resolve();
            });
        });

        currentDb.close();
        res.status(200).json({
            success: true,
            message: 'Box reserved successfully!',
            locker_id: locker_id,
            box_id: suitableBox.box_id,
            delivery_code: deliveryCode
        });

    } catch (error) {
        currentDb.run('ROLLBACK;', () => {
            currentDb.close();
            console.error('Error during box reservation:', error.message);
            res.status(500).json({ success: false, message: `Failed to reserve box: ${error.message}` });
        });
    }
});

// API2 for Package Delivery Confirmation
router.post('/confirm_delivery', async (req, res) => {
    const { locker_id, box_id, delivery_code, actual_occupied_from } = req.body;

    // 1. Basic Validation
    if (!locker_id || !box_id || !delivery_code) {
        return res.status(400).json({ success: false, message: 'Missing required delivery confirmation data.' });
    }

    const currentDb = getDb();

    try {
        // 2. Verify Box and Code
        const box = await new Promise((resolve, reject) => {
            currentDb.get('SELECT * FROM locker_boxes WHERE box_id = ? AND locker_id = ?', [box_id, locker_id], (err, row) => {
                if (err) reject(err);
                else if (!row) reject(new Error('Box not found.'));
                else resolve(row);
            });
        });

        if (box.status !== 'reserved') {
            currentDb.close();
            return res.status(400).json({ success: false, message: `Box ${box_id} is not in 'reserved' status (current: ${box.status}).` });
        }
        if (box.code1_open !== delivery_code) { // code1_open holds the delivery code
            currentDb.close();
            return res.status(401).json({ success: false, message: 'Invalid delivery code for this box.' });
        }

        // 3. Update Box Status to 'full'
        const pickupCode1 = generate4DigitCode();
        const pickupCode2 = generate4DigitCode();
        const occupiedTo = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' '); // 3 days from now

        await new Promise((resolve, reject) => {
            currentDb.run('BEGIN TRANSACTION;', (txErr) => {
                if (txErr) reject(txErr); else resolve();
            });
        });

        const updateBoxSql = `
            UPDATE locker_boxes
            SET
                status = 'full',
                occupied_from = ?,
                occupied_to = ?,
                code1_open = ?, -- Now holds pickupCode1
                code2_open = ?  -- Now holds pickupCode2
            WHERE
                box_id = ? AND locker_id = ? AND status = 'reserved'
        `;
        await new Promise((resolve, reject) => {
            currentDb.run(updateBoxSql, [
                actual_occupied_from || getCurrentTimestamp(),
                occupiedTo,
                pickupCode1,
                pickupCode2,
                box_id,
                locker_id
            ], function(err) {
                if (err) reject(err);
                else if (this.changes === 0) reject(new Error('Box not found or status changed during delivery confirmation.'));
                else resolve();
            });
        });

        await new Promise((resolve, reject) => {
            currentDb.run('COMMIT;', (commitErr) => {
                if (commitErr) reject(commitErr); else resolve();
            });
        });

        // 4. Update Locker Aggregates
        await new Promise((resolve, reject) => {
            updateLockerAggregates(locker_id, (aggErr) => {
                if (aggErr) reject(aggErr); else resolve();
            });
        });

        // 5. Send Email to Customer
        const lockerName = await new Promise((resolve, reject) => {
            currentDb.get('SELECT name FROM lockers WHERE locker_id = ?', [locker_id], (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.name : `Locker ${locker_id}`);
            });
        });

        const emailSubject = `Your parcel is ready for pickup at Smart Locker ${lockerName}!`;
        const emailText = `Dear ${box.customer_name},\n\nYour parcel "${box.parcel_name}" is now available for pickup at Smart Locker ${lockerName} (Box ID: ${box_id}).\n\nYour pickup code is: ${pickupCode1} ${pickupCode2}\n\nPlease pick up your parcel by ${occupiedTo}.\n\nThank you for using our Smart Locker service!`;
        const emailHtml = `
            <p>Dear ${box.customer_name},</p>
            <p>Your parcel "<b>${box.parcel_name}</b>" is now available for pickup at Smart Locker <b>${lockerName}</b> (Box ID: ${box_id}).</p>
            <p>Your pickup code is: <strong>${pickupCode1} ${pickupCode2}</strong></p>
            <p>Please pick up your parcel by <strong>${occupiedTo}</strong>.</p>
            <p>Thank you for using our Smart Locker service!</p>
        `;

        await sendEmail(box.customer_email, emailSubject, emailText, emailHtml);

        currentDb.close();
        res.status(200).json({
            success: true,
            message: 'Parcel delivered and box updated. Customer notified.',
            locker_id: locker_id,
            box_id: box_id,
            pickup_code1: pickupCode1,
            pickup_code2: pickupCode2
        });

    } catch (error) {
        currentDb.run('ROLLBACK;', () => {
            currentDb.close();
            console.error('Error during parcel delivery confirmation:', error.message);
            res.status(500).json({ success: false, message: `Failed to confirm delivery: ${error.message}` });
        });
    }
});

module.exports = router;
