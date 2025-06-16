// main-server.js
const mqtt = require('mqtt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// In-memory storage of lockers
const lockers = {};

// SQLite DB setup
const db = new sqlite3.Database(path.join(__dirname, 'server.db'));

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS locker_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT,
      lockerId TEXT,
      totalBoxes INTEGER,
      emptyBoxes INTEGER,
      isFull INTEGER
    )
  `);
});

// Serve the HTML page
app.use(express.static('public'));

//app.get('/api/lockers', (req, res) => {
//  res.json(lockers);
//});
// Get box details of a specific locker
app.get('/api/lockers/:lockerId/boxes', (req, res) => {
  const lockerId = req.params.lockerId;
  const locker = lockers[lockerId];
  if (!locker) return res.status(404).json({ error: 'Locker not found' });

  res.json({
    lockerId,
    boxes: locker.boxes || [],
    lastUpdate: locker.lastUpdate
  });
});


const client = mqtt.connect('mqtt://broker.hivemq.com');

client.on('connect', () => {
  console.log('Server connected to MQTT broker');

  // Subscribe to all locker status updates
  client.subscribe('taridox/locker/+/status', (err) => {
    if (!err) {
      console.log('Subscribed to locker status updates');
    }
  });
});

client.on('message', (topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    const lockerId = payload.lockerId;
		const timestamp = new Date().toISOString();		
		
    // Store or update locker status
    const lockerStatus = {
      lockerId,
      totalBoxes: payload.totalBoxes,
      emptyBoxes: payload.emptyBoxes,
      isFull: payload.isFull,
      lastUpdate: timestamp
    };
    lockers[lockerId] = lockerStatus;
    
    // Insert into SQLite
    db.run(`
      INSERT INTO locker_status (timestamp, lockerId, totalBoxes, emptyBoxes, isFull)
      VALUES (?, ?, ?, ?, ?)
    `, [timestamp, lockerId, payload.totalBoxes, payload.emptyBoxes, payload.isFull ? 1 : 0]);
		
		io.emit('lockerUpdate', lockerStatus);
    console.log(`Updated ${lockerId} status`, lockers[lockerId]);
  } catch (err) {
    console.error('Error parsing message', err);
  }
});

// Start web server
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Web dashboard running on http://localhost:${PORT}`);
});

