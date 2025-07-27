// server.js
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { initializeDb } = require('./db'); // Only initializeDb is needed here

// Import route modules
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');
const boxRoutes = require('./routes/box');

const app = express();
const PORT = 3000;

// Set EJS as the templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware to parse URL-encoded bodies (form data)
app.use(bodyParser.urlencoded({ extended: true }));
// Middleware to parse JSON bodies (for new API endpoints)
app.use(bodyParser.json());
// Serve static files (like CSS if you had any external ones, though Tailwind is CDN-loaded)
app.use(express.static('public'));

let db; // Variable to hold the database connection (though primarily used in db.js now)

// Initialize database and then start the server
initializeDb().then((database) => {
    db = database; // Store the initial connection (though getDb() is used for per-request connections)
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error("Failed to initialize database and start server:", err);
    process.exit(1); // Exit if DB connection fails
});

// Use the imported route modules
// Note: apiRoutes are prefixed with '/api' for clarity, but the routes
// within api.js are defined relative to that prefix.
app.use('/', adminRoutes); // Handles routes like '/', '/add_locker', '/locker/:id', etc.
app.use('/api', apiRoutes); // Handles routes like '/api/lockers', '/api/locker/:id', etc.
app.use('/', boxRoutes); // Handles routes like '/locker/:locker_id/box/edit/:box_id', '/box_history/:box_id'

// Error handling for routes not found
app.use((req, res) => {
    res.status(404).send('Page Not Found');
});
