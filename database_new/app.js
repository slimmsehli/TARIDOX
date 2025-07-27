const express = require('express');
const app = express();

app.use(express.json());

// Use your route modules
const lockersRoutes = require('./routers');
app.use('/api/lockers', lockersRoutes);

module.exports = app;

