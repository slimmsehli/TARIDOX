// server.js
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const { initializeDb, getDb } = require('./db');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

app.set('view engine', 'ejs');
app.set('views', [ 
	path.join(__dirname, 'views'),
	path.join(__dirname, 'public')
]);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

app.use(session({
    secret: 'my_secret_key_taridox_locker_app',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

let db;

initializeDb().then((database) => {
    db = database;
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error("Failed to initialize database and start server:", err);
    process.exit(1);
});

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

const haversineDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    const distance = R * c;
    return distance;
};

function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
}

// New default route for the main company page
app.get('/', (req, res) => {
    res.render('index', { pageTitle: 'Taridox Locker Solutions' });
});

app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    const currentDb = getDb();
    currentDb.get("SELECT * FROM ecommerces WHERE email = ? AND password = ?", [email, password], (err, row) => {
        if (err || !row) {
            res.render('login', { error: 'Invalid email or password.' });
        } else {
            req.session.userId = row.id;
            req.session.userName = row.name;
            req.session.isAdmin = row.is_admin;
            res.redirect('/dashboard');
        }
    });
});

app.get('/dashboard', isAuthenticated, (req, res) => {
    const currentDb = getDb();
    
    if (req.session.isAdmin) {
        currentDb.all("SELECT * FROM ecommerces", (err, ecommerces) => {
            if (err) return res.status(500).send("Error fetching e-commerce data.");
            currentDb.all("SELECT * FROM lockers", (err, lockers) => {
                if (err) return res.status(500).send("Error fetching locker data.");
                currentDb.all("SELECT * FROM locker_boxes", (err, lockerBoxes) => {
                    if (err) return res.status(500).send("Error fetching locker box data.");
                    currentDb.all("SELECT * FROM parcels", (err, parcels) => {
                        if (err) return res.status(500).send("Error fetching parcel data.");
                        res.render('dashboard', {
                            isAdmin: true,
                            userName: req.session.userName,
                            ecommerces: ecommerces,
                            lockers: lockers,
                            lockerBoxes: lockerBoxes,
                            parcels: parcels
                        });
                    });
                });
            });
        });
    } else {
        currentDb.get("SELECT * FROM ecommerces WHERE id = ?", [req.session.userId], (err, ecommerce) => {
            if (err || !ecommerce) return res.status(500).send("Error fetching user data.");
            currentDb.all("SELECT * FROM parcels WHERE ecommerce_id = ?", [req.session.userId], (err, parcels) => {
                if (err) return res.status(500).send("Error fetching parcels.");
                res.render('dashboard', {
                    isAdmin: false,
                    ecommerce: ecommerce,
                    parcels: parcels
                });
            });
        });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).send('Could not log out.');
        }
        res.redirect('/login');
    });
});

app.get('/edit_profile', isAuthenticated, (req, res) => {
    const currentDb = getDb();
    currentDb.get("SELECT * FROM ecommerces WHERE id = ?", [req.session.userId], (err, ecommerce) => {
        if (err || !ecommerce) {
            return res.status(500).send("Error fetching profile data.");
        }
        res.render('edit_profile', { ecommerce: ecommerce, error: null });
    });
});

app.post('/edit_profile', isAuthenticated, (req, res) => {
    const { name, email, api_key } = req.body;
    const is_admin = req.session.isAdmin;
    const userId = req.session.userId;
    const currentDb = getDb();

    currentDb.get("SELECT api_key FROM ecommerces WHERE id = ?", [userId], (err, row) => {
        if (err) {
            return res.status(500).send("Error validating API key.");
        }
        
        let updateApiKey = row.api_key;
        if (is_admin && api_key) {
            updateApiKey = api_key;
        } else if (api_key && api_key !== row.api_key) {
            return res.render('edit_profile', { 
                ecommerce: { id: userId, name, email, api_key: row.api_key }, 
                error: 'Only an admin can change the API key.' 
            });
        }
        
        currentDb.run("UPDATE ecommerces SET name = ?, email = ?, api_key = ? WHERE id = ?", [name, email, updateApiKey, userId], function(err) {
            if (err) {
                return res.status(500).send("Error updating profile.");
            }
            res.redirect('/dashboard');
        });
    });
});

app.get('/setup-demo', (req, res) => {
    const testApiKey = crypto.randomBytes(16).toString('hex');
    const currentDb = getDb();
    currentDb.run("INSERT OR IGNORE INTO ecommerces (name, email, password, api_key, is_admin) VALUES (?, ?, ?, ?, ?)",
        ['Taridox Test Ecommerce', 'test@example.com', 'testpass', testApiKey, 1], 
        function(err) {
            if (err) {
                return res.status(500).send("Error setting up demo ecommerce.");
            }
            const ecommerceId = this.lastID;
            currentDb.run("INSERT OR IGNORE INTO parcels (ecommerce_id, tracking_number, status, destination_locker_id, size) VALUES (?, ?, ?, ?, ?)",
                [ecommerceId, 'TRX123456789', 'pending', null, 'medium'], 
                (parcelErr) => {
                    if (parcelErr) {
                         return res.status(500).send("Error setting up demo parcel.");
                    }
                     res.send(`Demo ecommerce created with email 'test@example.com' and password 'testpass'. API Key: ${testApiKey}. A demo parcel was also created. You can now log in at /login.`);
                });
        });
});

app.get('/locker_selection', (req, res) => {
    res.render('locker_selection');
});

// Remove this route as the root URL now handles the main page.
// app.get('/main', (req, res) => {
//     res.render('main/index', { pageTitle: 'Main Page' });
// });

app.get('/api/lockers_slim', (req, res) => {
    const { lat, lon, radius } = req.query;
    const currentDb = getDb();
    console.log(`[API] Received request for lockers. Lat: ${lat}, Lon: ${lon}, Radius: ${radius}`);

    currentDb.all('SELECT * FROM lockers', (err, rows) => {
        if (err) {
            console.error('[API] ERROR fetching all lockers:', err.message);
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
        
        res.json({ lockers: filteredLockers });
    });
});

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
            SET total_boxes = ?,
                empty_boxes_left = ?,
                status = ?
            WHERE locker_id = ?
        `;
        db.run(updateLockerSql, [actualTotal, calculatedEmptyBoxesLeft, fullnessStatus, lockerId], (err) => {
            if (err) {
                console.error(`Error updating locker aggregates for ID ${lockerId}:`, err.message);
                return callback(err);
            }
            console.log(`Locker ${lockerId} aggregates updated. Total boxes: ${actualTotal}, Empty: ${calculatedEmptyBoxesLeft}, Status: ${fullnessStatus}`);
            callback(null);
        });
    });
}

