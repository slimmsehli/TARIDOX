// server.js (Node.js Express Backend)

const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt'); // MQTT client library for Node.js
const admin = require('firebase-admin'); // Firebase Admin SDK
const { v4: uuidv4 } = require('uuid'); // For generating unique request IDs

// --- Express App Initialization ---
const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for all routes to allow React frontend to connect
app.use(cors());
app.use(express.json()); // Enable JSON body parsing

// --- Firebase Initialization ---
let db;
try {
    const firebaseConfigStr = process.env.__firebase_config || '{}';
    const firebaseConfig = JSON.parse(firebaseConfigStr);

    // If running in Canvas, __firebase_config might contain client config
    // For Admin SDK, we typically need a service account key.
    // For local development, you'd load it from a file:
    // const serviceAccount = require('./path/to/your/serviceAccountKey.json');
    // admin.initializeApp({
    //     credential: admin.credential.cert(serviceAccount)
    // });

    // For simplicity in this Canvas prototype, we'll try initializing without
    // explicit service account if default credentials can be inferred (e.g., on GCP)
    // or if the Canvas environment provides it via other means.
    // If running locally, you MUST provide serviceAccountKey.json
    if (!admin.apps.length) {
        admin.initializeApp();
    }
    
    db = admin.firestore();
    console.log('Firebase Firestore initialized successfully.');
} catch (error) {
    console.error("Firebase Initialization Error:", error);
    // Exit or handle appropriately if Firebase is critical
    process.exit(1); 
}

// Determine app ID dynamically (Canvas environment variable or default)
const APP_ID = process.env.__app_id || 'default-app-id';
const LOCKERS_COLLECTION_PATH = `artifacts/${APP_ID}/public/data/lockers`;

// --- MQTT Configuration ---
// Using a public test broker for simplicity
const MQTT_BROKER_HOST = process.env.MQTT_BROKER_HOST || 'mqtt://broker.hivemq.com';
const MQTT_BROKER_PORT = parseInt(process.env.MQTT_BROKER_PORT || '1883', 10);

// --- Global MQTT Client Instance ---
let mqttClient;
// A map to hold pending box data requests, keyed by a unique request ID
const pendingBoxDataRequests = new Map(); // Map<requestId, { resolve, reject, timeoutId }>

// --- MQTT Connection and Event Handlers ---
function connectMqtt() {
    mqttClient = mqtt.connect(MQTT_BROKER_HOST, { port: MQTT_BROKER_PORT });

    mqttClient.on('connect', () => {
        console.log('Node.js Backend Connected to MQTT Broker!');
        // Subscribe to relevant topics upon connection
        mqttClient.subscribe('lockers/+/status', (err) => {
            if (err) console.error("Error subscribing to status topic:", err);
            else console.log("Subscribed to 'lockers/+/status'");
        });
        mqttClient.subscribe('lockers/+/response/boxes', (err) => {
            if (err) console.error("Error subscribing to box response topic:", err);
            else console.log("Subscribed to 'lockers/+/response/boxes'");
        });
    });

    mqttClient.on('error', (err) => {
        console.error("MQTT Error:", err);
        // Attempt to reconnect on error
        mqttClient.end(); // Disconnect cleanly
        setTimeout(connectMqtt, 5000); // Try reconnecting after 5 seconds
    });

    mqttClient.on('message', async (topic, message) => {
        console.log(`MQTT Message Received: Topic='${topic}', Payload='${message.toString()}'`);

        try {
            const payload = JSON.parse(message.toString());

            if (topic.endsWith('/status')) {
                // Handle locker status updates
                const parts = topic.split('/');
                const lockerId = parts[parts.length - 2]; // e.g., 'LKR-TEST-1' from 'lockers/LKR-TEST-1/status'
                if (lockerId) {
                    console.log(`Updating status for locker ${lockerId} in Firestore...`);
                    const lockerRef = db.collection(LOCKERS_COLLECTION_PATH).doc(lockerId);
                    await lockerRef.set({
                        is_full: payload.is_full || false,
                        status: payload.status || 'Offline',
                        temperature_c: payload.temperature_c !== undefined ? payload.temperature_c : null,
                        last_online: new Date().toISOString() // Update last online timestamp
                    }, { merge: true }); // Use merge: true to update only specified fields
                    console.log(`Locker ${lockerId} status updated in Firestore.`);
                }
            } else if (topic.endsWith('/response/boxes')) {
                // Handle box data responses from clients
                const parts = topic.split('/');
                const lockerId = parts[parts.length - 3]; // e.g., 'LKR-TEST-1' from 'lockers/LKR-TEST-1/response/boxes'
                const requestId = payload.requestId; // Assuming client sends back the requestId

                if (lockerId && requestId && pendingBoxDataRequests.has(requestId)) {
                    const { resolve, timeoutId } = pendingBoxDataRequests.get(requestId);
                    clearTimeout(timeoutId); // Clear timeout as response received
                    pendingBoxDataRequests.delete(requestId); // Clean up
                    console.log(`Box data response received for locker ${lockerId}, requestId ${requestId}`);
                    resolve(payload.boxesData); // Resolve the pending promise with the box data
                } else {
                    console.warn(`Warning: Unmatched box data response for locker ${lockerId}, requestId ${requestId}.`);
                }
            }
        } catch (error) {
            console.error("Error processing MQTT message:", error);
        }
    });
}

// Connect to MQTT when the server starts
connectMqtt();

// --- Express Routes ---

app.get('/', (req, res) => {
    res.send('Node.js Express backend is running!');
});

// GET all lockers from Firestore
app.get('/api/lockers', async (req, res) => {
    try {
        const lockersRef = db.collection(LOCKERS_COLLECTION_PATH);
        const snapshot = await lockersRef.get();
        const lockersList = [];
        snapshot.forEach(doc => {
            lockersList.push({ id: doc.id, ...doc.data() });
        });
        // Sort in memory if needed, e.g., by name
        lockersList.sort((a, b) => (a.locker_name || '').localeCompare(b.locker_name || ''));
        res.json(lockersList);
    } catch (error) {
        console.error("Error fetching all lockers:", error);
        res.status(500).json({ error: error.message });
    }
});

// Request box data from a specific locker client via MQTT
app.get('/api/lockers/:lockerId/boxes', async (req, res) => {
    const { lockerId } = req.params;
    if (!mqttClient || !mqttClient.connected) {
        return res.status(500).json({ error: 'MQTT client not connected on backend.' });
    }

    const requestId = uuidv4(); // Generate a unique ID for this request
    const requestTopic = `lockers/${lockerId}/request/boxes`;
    const responseTimeoutMs = 30000; // 30 seconds timeout for client response

    try {
        const boxesData = await new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                pendingBoxDataRequests.delete(requestId); // Clean up
                reject(new Error('Timeout: Locker client did not respond with box data.'));
            }, responseTimeoutMs);

            pendingBoxDataRequests.set(requestId, { resolve, reject, timeoutId });

            // Publish request to the specific locker's topic
            mqttClient.publish(requestTopic, JSON.stringify({ requestId }), { qos: 1 }, (err) => {
                if (err) {
                    clearTimeout(timeoutId);
                    pendingBoxDataRequests.delete(requestId);
                    reject(new Error(`Failed to publish MQTT request: ${err.message}`));
                } else {
                    console.log(`Published MQTT request to ${requestTopic} with ID: ${requestId}. Waiting for response...`);
                }
            });
        });
        res.json(boxesData);
    } catch (error) {
        console.error(`Error fetching box data for ${lockerId}:`, error);
        res.status(504).json({ error: error.message }); // Gateway Timeout or other error
    }
});

// Send an unlock command to a specific locker client via MQTT
app.post('/api/lockers/:lockerId/boxes/:boxId/unlock', async (req, res) => {
    const { lockerId, boxId } = req.params;
    if (!mqttClient || !mqttClient.connected) {
        return res.status(500).json({ error: 'MQTT client not connected on backend.' });
    }

    const commandTopic = `lockers/${lockerId}/command/unlock/${boxId}`;
    const payload = JSON.stringify({
        action: 'unlock',
        box_id: parseInt(boxId, 10),
        timestamp: new Date().toISOString()
    });

    try {
        mqttClient.publish(commandTopic, payload, { qos: 1 }, (err) => {
            if (err) {
                console.error(`Error publishing unlock command: ${err}`);
                return res.status(500).json({ error: `Failed to publish MQTT unlock command: ${err.message}` });
            }
            console.log(`Published MQTT unlock command to ${commandTopic}`);
            res.json({ message: `Unlock command sent to locker ${lockerId} for box ${boxId}. Client should respond via MQTT status update.` });
        });
    } catch (error) {
        console.error("Error sending unlock command:", error);
        res.status(500).json({ error: error.message });
    }
});

// Start the Express server
app.listen(PORT, () => {
    console.log(`Node.js Express backend running on http://localhost:${PORT}`);
});

