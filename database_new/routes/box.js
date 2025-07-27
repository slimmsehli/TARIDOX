// routes/box.js

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { getCurrentTimestamp } = require('../utils/timestamp');
const { updateLockerAggregates } = require('../utils/lockerAggregates');

// ROUTE (GET): Display form to edit a specific box (Admin Panel only)
router.get('/locker/:locker_id/box/edit/:box_id', (req, res) => {
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
router.post('/locker/:locker_id/box/edit/:box_id', (req, res) => {
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
                updateLockerAggregates(locker_id, (aggErr) => {
                    currentDb.close(); // Close the connection after aggregates update
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
router.post('/locker/:locker_id/box/pickup/:box_id', (req, res) => {
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
                        updateLockerAggregates(locker_id, (aggErr) => {
                            currentDb.close(); // Close the connection after aggregates update
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
router.get('/box_history/:box_id', (req, res) => {
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

module.exports = router;

