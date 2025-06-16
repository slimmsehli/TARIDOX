// main-server.js
const mqtt = require('mqtt');

// In-memory storage of lockers
const lockers = {};

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

    // Store or update locker status
    lockers[lockerId] = {
      totalBoxes: payload.totalBoxes,
      emptyBoxes: payload.emptyBoxes,
      isFull: payload.isFull,
      boxes: payload.boxes,
      lastUpdate: new Date()
    };

    console.log(`Updated ${lockerId} status`, lockers[lockerId]);
  } catch (err) {
    console.error('Error parsing message', err);
  }
});

