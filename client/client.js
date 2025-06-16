// locker-client.js
const mqtt = require('mqtt');

const lockerId = 'locker123';
const boxCount = 4;
const client = mqtt.connect('mqtt://broker.hivemq.com');

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

  client.publish(`taridox/locker/${lockerId}/status`, JSON.stringify(status));
  console.log(`[${new Date().toLocaleTimeString()}] Published status:`, status);
}

client.on('connect', () => {
  console.log(`Connected to MQTT as locker "${lockerId}"`);

  // Every 5 seconds: shuffle + publish status
  setInterval(() => {
    shuffleBoxes();
    publishStatus();
  }, 1000);
});

