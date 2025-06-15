import sqlite3
import paho.mqtt.client as mqtt
import time
import json
import random
import uuid
from datetime import datetime, timedelta

# --- Configuration for this Client Instance ---
# IMPORTANT: Change this for each client simulator instance you run.
# It should match an `locker_id` you add via the React frontend.
# Example: If you add a locker with ID "LKR-123456", set LOCKER_ID = "LKR-123456"
LOCKER_ID = "slimlocker1" # <--- !!! CHANGE THIS FOR EACH INSTANCE !!!

# MQTT Broker Configuration
MQTT_BROKER_HOST = "broker.hivemq.com" # Using HiveMQ public broker
MQTT_BROKER_PORT = 1883

# --- SQLite Database Configuration ---
DB_NAME = f"locker_{LOCKER_ID}.db"

# --- MQTT Topics ---
TOPIC_STATUS = f"lockers/{LOCKER_ID}/status"
TOPIC_BOX_REQUEST = f"lockers/{LOCKER_ID}/request/boxes"
TOPIC_BOX_RESPONSE = f"lockers/{LOCKER_ID}/response/boxes"
TOPIC_COMMAND_UNLOCK = f"lockers/{LOCKER_ID}/command/unlock/#" # Wildcard to catch all box unlocks

# --- Global MQTT Client Instance ---
client = None

# --- SQLite Database Functions ---
def init_db():
    """Initializes the SQLite database and creates the 'boxes' table."""
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS boxes (
            box_id INTEGER PRIMARY KEY,
            width_cm REAL NOT NULL,
            length_cm REAL NOT NULL,
            height_cm REAL NOT NULL,
            volume_cm3 REAL NOT NULL,
            is_occupied BOOLEAN NOT NULL DEFAULT 0,
            occupied_from DATETIME,
            occupied_to DATETIME,
            unlock_code_part1 TEXT,
            unlock_code_part2 TEXT
        )
    ''')
    conn.commit()
    conn.close()
    print(f"Database '{DB_NAME}' initialized.")

def populate_initial_boxes(num_boxes=5):
    """Populates the 'boxes' table with initial dummy data if empty."""
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM boxes")
    if cursor.fetchone()[0] == 0:
        print(f"Populating '{DB_NAME}' with {num_boxes} initial boxes...")
        for i in range(1, num_boxes + 1):
            width = round(random.uniform(20, 50), 2)
            length = round(random.uniform(20, 50), 2)
            height = round(random.uniform(15, 40), 2)
            volume = width * length * height
            cursor.execute(
                "INSERT INTO boxes (box_id, width_cm, length_cm, height_cm, volume_cm3, is_occupied) VALUES (?, ?, ?, ?, ?, ?)",
                (i, width, length, height, volume, 0)
            )
        conn.commit()
        print("Initial boxes populated.")
    else:
        print(f"Database '{DB_NAME}' already contains boxes.")
    conn.close()

def get_all_boxes():
    """Retrieves all box data from the database."""
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT box_id, width_cm, length_cm, height_cm, volume_cm3, is_occupied, occupied_from, occupied_to, unlock_code_part1, unlock_code_part2 FROM boxes")
    rows = cursor.fetchall()
    conn.close()
    
    boxes_data = []
    for row in rows:
        boxes_data.append({
            "box_id": row[0],
            "width_cm": row[1],
            "length_cm": row[2],
            "height_cm": row[3],
            "volume_cm3": row[4],
            "is_occupied": bool(row[5]),
            "occupied_from": row[6],
            "occupied_to": row[7],
            "unlock_code_part1": row[8],
            "unlock_code_part2": row[9]
        })
    return boxes_data

def update_box_status(box_id, is_occupied, occupied_from=None, occupied_to=None, unlock_code_part1=None, unlock_code_part2=None):
    """Updates the status of a specific box in the database."""
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    # Get current status to check if it changed
    cursor.execute("SELECT is_occupied FROM boxes WHERE box_id = ?", (box_id,))
    current_is_occupied = bool(cursor.fetchone()[0])

    if current_is_occupied != is_occupied:
        # Status has changed, update timestamps and codes
        if is_occupied:
            # Box becomes occupied
            occupied_from_ts = datetime.now().isoformat()
            occupied_to_ts = (datetime.now() + timedelta(hours=random.randint(1, 24))).isoformat()
            code1 = str(random.randint(1000, 9999))
            code2 = str(random.randint(1000, 9999))
            cursor.execute(
                "UPDATE boxes SET is_occupied=?, occupied_from=?, occupied_to=?, unlock_code_part1=?, unlock_code_part2=? WHERE box_id=?",
                (is_occupied, occupied_from_ts, occupied_to_ts, code1, code2, box_id)
            )
            print(f"Box {box_id} is now OCCUPIED. Code: {code1}-{code2}")
        else:
            # Box becomes empty
            cursor.execute(
                "UPDATE boxes SET is_occupied=?, occupied_from=NULL, occupied_to=NULL, unlock_code_part1=NULL, unlock_code_part2=NULL WHERE box_id=?",
                (is_occupied, box_id)
            )
            print(f"Box {box_id} is now EMPTY.")
    else:
        # Status didn't change, just update timestamps/codes if provided
        cursor.execute(
            "UPDATE boxes SET is_occupied=?, occupied_from=?, occupied_to=?, unlock_code_part1=?, unlock_code_part2=? WHERE box_id=?",
            (is_occupied, occupied_from, occupied_to, unlock_code_part1, unlock_code_part2, box_id)
        )

    conn.commit()
    conn.close()


def get_locker_full_status():
    """Checks if all boxes in the locker are occupied."""
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM boxes WHERE is_occupied = 0")
    empty_boxes = cursor.fetchone()[0]
    conn.close()
    return empty_boxes == 0

# --- MQTT Callbacks ---
def on_connect(client, userdata, flags, rc):
    """Callback for when the client connects to the MQTT broker."""
    if rc == 0:
        print(f"Locker Client {LOCKER_ID} Connected to MQTT Broker: {MQTT_BROKER_HOST}")
        # Subscribe to topics to receive commands and data requests
        client.subscribe(TOPIC_BOX_REQUEST)
        client.subscribe(TOPIC_COMMAND_UNLOCK)
        print(f"Subscribed to '{TOPIC_BOX_REQUEST}' and '{TOPIC_COMMAND_UNLOCK}'")
    else:
        print(f"Locker Client {LOCKER_ID} Failed to connect to MQTT Broker, return code {rc}")

def on_message(client, userdata, msg):
    """Callback for when a message is received from the MQTT broker."""
    print(f"MQTT Message Received: Topic='{msg.topic}', Payload='{msg.payload.decode()}'")
    try:
        payload_data = json.loads(msg.payload.decode())

        if msg.topic == TOPIC_BOX_REQUEST:
            # Handle request for all box data
            print(f"Request for box data received. Sending all box data for {LOCKER_ID}...")
            boxes_data = get_all_boxes()
            client.publish(TOPIC_BOX_RESPONSE, json.dumps(boxes_data), qos=1)
            print("Box data sent.")

        elif msg.topic.startswith(f"lockers/{LOCKER_ID}/command/unlock/"):
            # Handle unlock command for a specific box
            box_id_str = msg.topic.split('/')[-1]
            try:
                box_id = int(box_id_str)
                # In a real scenario, this would trigger hardware to unlock the box
                print(f"Simulating UNLOCK for box {box_id} in locker {LOCKER_ID}!")
                # Update box status to unoccupied after unlock
                update_box_status(box_id, False)
                # Immediately send status update to reflect the change
                send_locker_status_update(client)
            except ValueError:
                print(f"Invalid box_id in unlock command topic: {box_id_str}")

    except json.JSONDecodeError as e:
        print(f"Error decoding JSON payload: {e}")
    except Exception as e:
        print(f"Error processing MQTT message: {e}")

def send_locker_status_update(client):
    """Publishes the current locker status to the MQTT broker."""
    is_full = get_locker_full_status()
    current_temperature = round(random.uniform(15.0, 30.0), 1) # Simulate temperature
    
    status_payload = {
        "locker_id": LOCKER_ID,
        "is_full": is_full,
        "status": "Active", # Always active if script is running
        "temperature_c": current_temperature,
        "last_online": datetime.now().isoformat()
    }
    client.publish(TOPIC_STATUS, json.dumps(status_payload), qos=1)
    print(f"Locker {LOCKER_ID} status sent: Full={is_full}, Temp={current_temperature}°C")

def simulate_box_activity():
    """Randomly changes the occupancy status of boxes."""
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT box_id, is_occupied FROM boxes")
    boxes = cursor.fetchall()
    conn.close()

    if not boxes:
        return

    # Randomly pick a box to potentially change status
    box_to_change = random.choice(boxes)
    box_id, current_is_occupied = box_to_change
    
    # 20% chance to flip status
    if random.random() < 0.2:
        new_is_occupied = not bool(current_is_occupied)
        update_box_status(box_id, new_is_occupied)
        print(f"Simulated box {box_id} occupancy change to {'occupied' if new_is_occupied else 'empty'}.")

# --- Main Execution ---
if __name__ == "__main__":
    print(f"Starting Locker Client Simulator for LOCKER_ID: {LOCKER_ID}")

    # 1. Initialize and populate database
    init_db()
    populate_initial_boxes()

    # 2. Initialize MQTT client
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, client_id=f"LockerClient_{LOCKER_ID}")
    client.on_connect = on_connect
    client.on_message = on_message

    # 3. Connect to MQTT Broker
    try:
        client.connect(MQTT_BROKER_HOST, MQTT_BROKER_PORT, 60)
        # Start MQTT loop in a non-blocking way
        client.loop_start()
    except Exception as e:
        print(f"Failed to connect to MQTT broker: {e}")
        exit(1)

    # 4. Main loop for simulating activity and sending updates
    try:
        while True:
            # Send status update every 5 seconds
            send_locker_status_update(client)
            # Simulate box activity every 10-20 seconds
            if random.random() < 0.5: # 50% chance to run activity simulation in this cycle
                simulate_box_activity()
            
            time.sleep(random.randint(5, 10)) # Adjust update frequency
    except KeyboardInterrupt:
        print("Locker Client Simulator stopped by user.")
    finally:
        client.loop_stop()
        client.disconnect()
        print("MQTT client disconnected.")


