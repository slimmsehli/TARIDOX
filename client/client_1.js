// locker-client.js
const mqtt = require('mqtt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const lockerId = 'locker123';
const boxCount = 4;
const client = mqtt.connect('mqtt://broker.hivemq.com');

// Setup local SQLite DB
const db = new sqlite3.Database(path.join(__dirname, 'locker.db'));
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


// Initialize locker boxes with random occupancy
let boxes = Array.from({ length: boxCount }, (_, i) => ({
  id: i + 1,
  occupied: Math.random() > 0.5
}));

// Simulate boxes being filled/emptied randomly
function shuffleBoxes() {
  boxes = boxes.map(box => {
    // 30% chance to toggle the occupied state
    if (Math.random() < 0.3) {
      return { ...box, occupied: !box.occupied };
    }
    return box;
  });
}

// Send current locker status
function publishStatus() {
  const status = {
    lockerId,
    totalBoxes: boxes.length,
    emptyBoxes: boxes.filter(b => !b.occupied).length,
    isFull: boxes.every(b => b.occupied),
    boxes
  };
  
  // add database stuff 
  const timestamp = new Date().toISOString();

  db.run(`
    INSERT INTO locker_status (timestamp, lockerId, totalBoxes, emptyBoxes, isFull)
    VALUES (?, ?, ?, ?, ?)
  `, [timestamp, status.lockerId, status.totalBoxes, status.emptyBoxes, status.isFull ? 1 : 0]);

  client.publish(`taridox/locker/${lockerId}/status`, JSON.stringify(status));
  console.log(`[${new Date().toLocaleTimeString()}] Published status:`, status);
}

client.on('connect', () => {
  console.log(`Connected to MQTT as locker "${lockerId}"`);

  // Every 5 seconds: shuffle + publish status
  setInterval(() => {
    shuffleBoxes();
    publishStatus();
  }, 2000);
});

