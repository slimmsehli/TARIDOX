// main-server.js
const mqtt = require('mqtt');
const path = require('path');

const sqlite3 = require('sqlite3').verbose();


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
    lockers[lockerId] = {
      totalBoxes: payload.totalBoxes,
      emptyBoxes: payload.emptyBoxes,
      isFull: payload.isFull,
      boxes: payload.boxes,
      lastUpdate: new Date()
    };
    
    // Insert into SQLite
    db.run(`
      INSERT INTO locker_status (timestamp, lockerId, totalBoxes, emptyBoxes, isFull)
      VALUES (?, ?, ?, ?, ?)
    `, [timestamp, lockerId, payload.totalBoxes, payload.emptyBoxes, payload.isFull ? 1 : 0]);

    console.log(`Updated ${lockerId} status`, lockers[lockerId]);
  } catch (err) {
    console.error('Error parsing message', err);
  }
});

