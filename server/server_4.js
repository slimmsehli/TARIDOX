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

const fs = require('fs');

// Load locker IDs from file
const lockerIds = fs.readFileSync('lockers.txt', 'utf-8')
  .split('\n')
  .map(id => id.trim())
  .filter(Boolean);
  
  console.log(`found lockers ${lockerIds}`);
// Initialize with offline status
const lockers = {};
lockerIds.forEach(id => {
  lockers[id] = {
    lockerId: id,
    status: 'offline', // Default to offline
    lastUpdate: null,
    totalBoxes: 0,
    emptyBoxes: 0,
    isFull: false
  };
});
// In-memory storage of lockers
//const lockers = {};
  
  
app.set('view engine', 'ejs');
//app.use(express.static('public'));
app.get('/', (req, res) => {
  res.render('index', { lockers });
});

// SQLite DB setup
const db = new sqlite3.Database(path.join(__dirname, 'server.db'));

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS locker_info (
      lockerId TEXT PRIMARY KEY,
      latitude REAL,
      longitude REAL,
      workingHours TEXT,
      status TEXT,
      boxCount INTEGER
    )
  `);

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

// Routes
app.get('/', (req, res) => {
  db.all('SELECT * FROM locker_info', (err, lockers) => {
    if (err) return res.status(500).send('DB error');
    res.render('index', { lockers });
  });
});

app.get('/locker/:lockerId', (req, res) => {
  const lockerId = req.params.lockerId;
  const lockerDbPath = path.join(__dirname, `${lockerId}.db`);
  const lockerDb = new sqlite3.Database(lockerDbPath);

  lockerDb.all('SELECT * FROM locker_boxes', (err, boxes) => {
    if (err) return res.status(500).send('Locker DB error');
    res.render('locker_detail', { lockerId, boxes });
  });
});

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

// MQTT Setup
const client = mqtt.connect('mqtt://broker.hivemq.com');

client.on('connect', () => {
  console.log('Server connected to MQTT broker');
  client.subscribe('taridox/locker/+/status', (err) => {
    if (!err) console.log('Subscribed to locker status updates');
  });
});

client.on('message', (topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    const lockerId = payload.lockerId;
    const timestamp = new Date().toISOString();

    /*const lockerStatus = {
      lockerId,
      totalBoxes: payload.totalBoxes,
      emptyBoxes: payload.emptyBoxes,
      status: payload.status || 'active', // fallback if not in payload
      isFull: payload.isFull,
      lastUpdate: timestamp
    };
    lockers[lockerId] = lockerStatus;*/
		// Update status from payload
		/*lockers[lockerId] = {
			...lockers[lockerId],
			lockerId,
			totalBoxes: payload.totalBoxes,
			emptyBoxes: payload.emptyBoxes,
			isFull: payload.isFull,
			status: payload.status || 'active', // fallback if not in payload
			lastUpdate: timestamp,
			boxes: payload.boxes || []
		};*/
		
		// Update locker main status + boxes data in memory
    lockers[lockerId] = {
      lockerId,
      totalBoxes: payload.totalBoxes,
      emptyBoxes: payload.emptyBoxes,
      isFull: payload.isFull,
      boxes: payload.boxes  ,
      lastUpdate: timestamp,
      // Add other locker info fields if sent
      latitude: payload.latitude,
      longitude: payload.longitude,
      workingHours: payload.workingHours,
      status: payload.status || 'active'
    };
    const lockerStatus = lockers[lockerId];
		
		
    db.run(`
      INSERT INTO locker_status (timestamp, lockerId, totalBoxes, emptyBoxes, isFull)
      VALUES (?, ?, ?, ?, ?)
    `, [timestamp, lockerId, payload.totalBoxes, payload.emptyBoxes, payload.isFull ? 1 : 0]);

    io.emit('lockerUpdate', lockerStatus);
    console.log(`Updated ${lockerId} status`, lockerStatus);
  } catch (err) {
    console.error('Error parsing message', err);
  }
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Web dashboard running on http://localhost:${PORT}`);
});
