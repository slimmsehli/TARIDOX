-- SQLite SQL Script for Taridox Locker Management System - Updated with Customer Info

-- Table: lockers
-- Stores general information about each locker unit.
CREATE TABLE IF NOT EXISTS lockers (
    locker_id INTEGER PRIMARY KEY AUTOINCREMENT, -- Unique identifier for the locker
    name TEXT NOT NULL,                          -- Name of the locker (e.g., "City Center Locker")
    business_name TEXT NOT NULL,                 -- Business that owns or hosts the locker
    latitude REAL NOT NULL,                      -- GPS latitude coordinate
    longitude REAL NOT NULL,                     -- GPS longitude coordinate
    opening_hours TEXT,                          -- Opening hours (e.g., "9:00 AM - 9:00 PM", "24/7")
    status TEXT NOT NULL,                        -- Current status (online, maintenance, offline)
    fullness TEXT NOT NULL,                      -- Overall fullness (full, empty, has some space)
    total_boxes INTEGER NOT NULL,                -- Total number of boxes in the locker
    full_boxes INTEGER NOT NULL,                 -- Number of boxes currently full
    empty_boxes_left INTEGER NOT NULL,           -- Number of boxes currently empty and available
    CHECK (status IN ('online', 'maintenance', 'offline')),
    CHECK (fullness IN ('full', 'empty', 'has some space')),
    CHECK (total_boxes >= 0),
    CHECK (full_boxes >= 0),
    CHECK (empty_boxes_left >= 0),
    CHECK (full_boxes <= total_boxes),
    CHECK (empty_boxes_left <= total_boxes)
);

-- Table: locker_boxes
-- Tracks individual boxes within each locker.
CREATE TABLE IF NOT EXISTS locker_boxes (
    box_id INTEGER PRIMARY KEY AUTOINCREMENT,    -- Unique identifier for the box
    locker_id INTEGER NOT NULL,                  -- Foreign key referencing the lockers table
    height REAL NOT NULL,                        -- Height of the box in cm
    width REAL NOT NULL,                         -- Width of the box in cm
    length REAL NOT NULL,                        -- Length of the box in cm
    volume REAL NOT NULL,                        -- Calculated volume of the box in cubic cm
    status TEXT NOT NULL,                        -- Status of the box (empty, full, other - e.g., 'reserved', 'in use')
    ecommerce_name TEXT,                         -- Name of the e-commerce company if reserved/full
    occupied_from TEXT,                          -- Timestamp when the box was occupied (YYYY-MM-DD HH:MM:SS)
    occupied_to TEXT,                            -- Timestamp when the box is expected to be free (YYYY-MM-DD HH:MM:SS)
    code1_open TEXT,                             -- 4-digit code to open (delivery)
    code2_open TEXT,                             -- Second 4-digit code (pickup)
    box_health TEXT NOT NULL,                    -- Health status (working, maintenance, other)
    customer_name TEXT,                          -- NEW: Name of the customer picking up
    customer_phone TEXT,                         -- NEW: Phone number of the customer picking up
    FOREIGN KEY (locker_id) REFERENCES lockers(locker_id),
    CHECK (status IN ('empty', 'full', 'reserved', 'in use', 'other')),
    CHECK (box_health IN ('working', 'maintenance', 'other'))
);

-- Sample Data for 'lockers' table (unchanged)
INSERT INTO lockers (name, business_name, latitude, longitude, opening_hours, status, fullness, total_boxes, full_boxes, empty_boxes_left) VALUES
('Downtown Express', 'QuickShip Inc.', 48.8566, 2.3522, '24/7', 'online', 'has some space', 5, 4, 1),
('Suburban Hub', 'Local Deliveries Co.', 48.8789, 2.2945, '8:00 AM - 10:00 PM', 'online', 'empty', 3, 0, 3),
('Airport Terminal A', 'Global Parcels', 49.0097, 2.5479, '24/7', 'maintenance', 'full', 2, 2, 0),
('University Campus', 'EduLogistics', 48.8462, 2.3082, '6:00 AM - Midnight', 'online', 'has some space', 3, 2, 1),
('Shopping Mall North', 'Retail Innovations', 48.8687, 2.3168, '9:00 AM - 9:00 PM', 'offline', 'empty', 2, 0, 2);

-- Sample Data for 'locker_boxes' table (UPDATED with new columns)
-- Locker 1: Downtown Express (locker_id=1)
INSERT INTO locker_boxes (locker_id, height, width, length, volume, status, ecommerce_name, occupied_from, occupied_to, code1_open, code2_open, box_health, customer_name, customer_phone) VALUES
(1, 30, 30, 30, 27000, 'full', 'Amazon', '2025-06-23 10:00:00', '2025-06-25 10:00:00', '1234', '5678', 'working', 'Alice Wonderland', '0701234567'),
(1, 20, 40, 25, 20000, 'full', 'Zalando', '2025-06-24 11:30:00', '2025-06-26 11:30:00', '9876', '5432', 'working', 'Bob The Builder', '0709876543'),
(1, 40, 35, 30, 42000, 'empty', NULL, NULL, NULL, NULL, NULL, 'working', NULL, NULL),
(1, 15, 20, 20, 6000, 'reserved', 'eBay', '2025-06-24 15:00:00', '2025-06-27 15:00:00', '1111', '2222', 'working', 'Charlie Chaplin', '0701122334'),
(1, 25, 25, 25, 15625, 'full', 'AliExpress', '2025-06-23 09:00:00', '2025-06-25 09:00:00', '3333', '4444', 'working', 'Diana Prince', '0705566778');

-- Locker 2: Suburban Hub (locker_id=2) - all empty (unchanged for these)
INSERT INTO locker_boxes (locker_id, height, width, length, volume, status, ecommerce_name, occupied_from, occupied_to, code1_open, code2_open, box_health, customer_name, customer_phone) VALUES
(2, 30, 30, 30, 27000, 'empty', NULL, NULL, NULL, NULL, NULL, 'working', NULL, NULL),
(2, 20, 40, 25, 20000, 'empty', NULL, NULL, NULL, NULL, NULL, 'working', NULL, NULL),
(2, 40, 35, 30, 42000, 'empty', NULL, NULL, NULL, NULL, NULL, 'working', NULL, NULL);

-- Locker 3: Airport Terminal A (locker_id=3) - all full, under maintenance (updated for these)
INSERT INTO locker_boxes (locker_id, height, width, length, volume, status, ecommerce_name, occupied_from, occupied_to, code1_open, code2_open, box_health, customer_name, customer_phone) VALUES
(3, 30, 30, 30, 27000, 'full', 'DHL', '2025-06-20 08:00:00', '2025-06-22 08:00:00', '0000', '1000', 'maintenance', 'Eve Harrington', '0709988776'),
(3, 20, 40, 25, 20000, 'full', 'UPS', '2025-06-20 09:00:00', '2025-06-22 09:00:00', '2000', '3000', 'maintenance', 'Frankenstein Monster', '0704433221');

-- Locker 4: University Campus (locker_id=4) (updated for these)
INSERT INTO locker_boxes (locker_id, height, width, length, volume, status, ecommerce_name, occupied_from, occupied_to, code1_open, code2_open, box_health, customer_name, customer_phone) VALUES
(4, 25, 25, 25, 15625, 'full', 'Bookworm', '2025-06-23 14:00:00', '2025-06-26 14:00:00', '4321', '8765', 'working', 'Grace Hopper', '0708877665'),
(4, 30, 30, 30, 27000, 'empty', NULL, NULL, NULL, NULL, NULL, 'working', NULL, NULL),
(4, 20, 40, 25, 20000, 'full', 'Campus Supplies', '2025-06-24 09:00:00', '2025-06-25 09:00:00', '5678', '1234', 'working', 'Harry Potter', '0703322110');

-- Locker 5: Shopping Mall North (locker_id=5) - all empty, offline (unchanged for these)
INSERT INTO locker_boxes (locker_id, height, width, length, volume, status, ecommerce_name, occupied_from, occupied_to, code1_open, code2_open, box_health, customer_name, customer_phone) VALUES
(5, 30, 30, 30, 27000, 'empty', NULL, NULL, NULL, NULL, NULL, 'working', NULL, NULL),
(5, 20, 40, 25, 20000, 'empty', NULL, NULL, NULL, NULL, NULL, 'working', NULL, NULL);

-- Additional trial data for a new Locker
INSERT INTO lockers (name, business_name, latitude, longitude, opening_hours, status, fullness, total_boxes, full_boxes, empty_boxes_left) VALUES
('New Test Locker', 'Trial Co.', 48.8000, 2.3000, '10:00 AM - 6:00 PM', 'online', 'empty', 5, 2, 3);

-- Boxes for New Test Locker (locker_id=6, assuming it's the 6th locker)
INSERT INTO locker_boxes (locker_id, height, width, length, volume, status, ecommerce_name, occupied_from, occupied_to, code1_open, code2_open, box_health, customer_name, customer_phone) VALUES
(6, 25, 25, 25, 15625, 'empty', NULL, NULL, NULL, NULL, NULL, 'working', NULL, NULL),
(6, 30, 30, 30, 27000, 'reserved', 'Shopify', '2025-06-25 10:00:00', '2025-06-28 10:00:00', '5555', '6666', 'working', 'Isabel Jenkins', '0701239876'),
(6, 20, 40, 25, 20000, 'empty', NULL, NULL, NULL, NULL, NULL, 'working', NULL, NULL),
(6, 35, 35, 35, 42875, 'full', 'Etsy', '2025-06-24 18:00:00', '2025-06-26 18:00:00', '7777', '8888', 'working', 'Jack Sparrow', '0704561234'),
(6, 15, 20, 20, 6000, 'empty', NULL, NULL, NULL, NULL, NULL, 'maintenance', NULL, NULL);


