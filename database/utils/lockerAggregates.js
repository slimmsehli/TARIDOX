// utils/lockerAggregates.js

const { getDb } = require('../db'); // Import the getDb function

/**
 * Recalculates and updates a locker's aggregate box counts and fullness status.
 * This function should be called after any operation that modifies locker_boxes (add, edit, delete, pickup).
 * @param {number} lockerId - The ID of the locker to update.
 * @param {function} callback - Callback function (err) to indicate completion or error.
 */
function updateLockerAggregates(lockerId, callback) {
    const db = getDb(); // Get a new connection for this operation
    db.get('SELECT COUNT(*) as total, SUM(CASE WHEN status = "full" THEN 1 ELSE 0 END) as full, SUM(CASE WHEN status = "reserved" THEN 1 ELSE 0 END) as reserved, SUM(CASE WHEN status = "in use" THEN 1 ELSE 0 END) as in_use, SUM(CASE WHEN status = "empty" THEN 1 ELSE 0 END) as empty FROM locker_boxes WHERE locker_id = ?', [lockerId], (err, counts) => {
        if (err) {
            console.error(`Error recalculating box counts for locker ${lockerId}:`, err.message);
            db.close(); // Close the connection on error
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
            db.close(); // Close the connection after the update
            if (updateErr) {
                console.error(`Error updating locker ${lockerId} aggregates:`, updateErr.message);
                return callback(updateErr);
            }
            console.log(`Locker ${lockerId} aggregates updated: Total=${actualTotal}, Full=${actualFull}, Empty=${calculatedEmptyBoxesLeft}, Fullness=${fullnessStatus}`);
            callback(null);
        });
    });
}

module.exports = {
    updateLockerAggregates
};

