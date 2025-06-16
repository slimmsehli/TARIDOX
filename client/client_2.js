// locker-client.js
const mqtt = require('mqtt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const lockerId = 'locker1';
const boxCount = 4;
const locker_db_name = `${lockerId}.db`;
const client = mqtt.connect('mqtt://broker.hivemq.com');

// Locker settings
const lockerMeta = {
  lockerId,
  latitude: 36.8065,
  longitude: 10.1815,
  workingHours: '08:00-20:00',
  status: 'active',
  boxCount
};

const db = new sqlite3.Database(path.join(__dirname, locker_db_name));

// Step 1: Setup Tables
db.serialize(() => {
  // Locker metadata
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

  // Box metadata
  db.run(`
    CREATE TABLE IF NOT EXISTS locker_boxes (
      id INTEGER PRIMARY KEY,
      width REAL,
      length REAL,
      height REAL,
      volume REAL,
      occupied INTEGER,
      status TEXT,
      occupiedFrom TEXT,
      occupiedTo TEXT
    )
  `);

  // Status history
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

  // Step 2: Insert locker info if not exists
  db.get(`SELECT COUNT(*) AS count FROM locker_info WHERE lockerId = ?`, [lockerId], (err, row) => {
    if (row.count === 0) {
      db.run(`
        INSERT INTO locker_info (lockerId, latitude, longitude, workingHours, status, boxCount)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [lockerMeta.lockerId, lockerMeta.latitude, lockerMeta.longitude, lockerMeta.workingHours, lockerMeta.status, lockerMeta.boxCount]);
    }
  });

  // Step 3: Insert boxes if not exists
  db.get(`SELECT COUNT(*) AS count FROM locker_boxes`, (err, row) => {
    if (row.count === 0) {
      for (let i = 1; i <= boxCount; i++) {
        const width = 30 + Math.random() * 10; // cm
        const length = 40 + Math.random() * 10;
        const height = 50 + Math.random() * 10;
        const volume = width * length * height;
        const occupied = Math.random() > 0.5 ? 1 : 0;
        const now = new Date().toISOString();
        db.run(`
          INSERT INTO locker_boxes (id, width, length, height, volume, occupied, status, occupiedFrom, occupiedTo)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [i, width, length, height, volume, occupied, 'active', occupied ? now : null, null]);
      }
    }
  });
});

// Step 4: Shuffle boxes and update DB
function shuffleBoxesAndUpdate() {
  db.all(`SELECT * FROM locker_boxes`, (err, boxes) => {
    const updatedBoxes = boxes.map(box => {
      const shouldToggle = Math.random() < 0.3;
      if (!shouldToggle) return box;

      const now = new Date().toISOString();
      const newOccupied = box.occupied ? 0 : 1;
      return {
        ...box,
        occupied: newOccupied,
        occupiedFrom: newOccupied ? now : null,
        occupiedTo: !newOccupied ? now : null
      };
    });

    // Update database for each box
    updatedBoxes.forEach(box => {
      db.run(`
        UPDATE locker_boxes
        SET occupied = ?, occupiedFrom = ?, occupiedTo = ?
        WHERE id = ?
      `, [box.occupied, box.occupiedFrom, box.occupiedTo, box.id]);
    });
  });
}

// Step 5: Publish locker status
function publishStatus() {
  db.all(`SELECT * FROM locker_boxes`, (err, boxes) => {
    const status = {
      lockerId,
      totalBoxes: boxes.length,
      emptyBoxes: boxes.filter(b => !b.occupied).length,
      isFull: boxes.every(b => b.occupied),
      boxes: boxes.map(b => ({
        id: b.id,
        occupied: !!b.occupied
      }))
    };

    const timestamp = new Date().toISOString();

    db.run(`
      INSERT INTO locker_status (timestamp, lockerId, totalBoxes, emptyBoxes, isFull)
      VALUES (?, ?, ?, ?, ?)
    `, [timestamp, status.lockerId, status.totalBoxes, status.emptyBoxes, status.isFull ? 1 : 0]);

    client.publish(`taridox/locker/${lockerId}/status`, JSON.stringify(status));
    console.log(`[${new Date().toLocaleTimeString()}] Published status:`, status);
  });
}

// MQTT Connected
client.on('connect', () => {
  console.log(`🔌 Connected to MQTT as locker "${lockerId}"`);

  setInterval(() => {
    shuffleBoxesAndUpdate();
    setTimeout(publishStatus, 500); // let DB update finish first
  }, 5000);
});
