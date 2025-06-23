-- SQLite Script for Locker Management Database

-- Table 1: lockers
-- Stores general information about each locker unit.
CREATE TABLE IF NOT EXISTS lockers (
    id TEXT PRIMARY KEY,          -- Unique ID for the locker (e.g., 'LOCKER001')
    status TEXT NOT NULL,         -- Current status of the locker ('available', 'maintenance', 'inactive')
    fullness TEXT NOT NULL,       -- State of the locker's capacity ('empty', 'has_boxes', 'full')
    coordinates TEXT,             -- Geographic coordinates or physical location description
    business TEXT,                -- The business where the locker is located
    availability TEXT             -- Days and hours of operation (e.g., 'Mon-Sat 24h')
);

-- Table 2: boxes
-- Stores details for each individual box inside a locker.
CREATE TABLE IF NOT EXISTS boxes (
    id TEXT PRIMARY KEY,                           -- Unique ID for the box (e.g., 'BOX001-A')
    locker_id TEXT NOT NULL,                       -- Foreign Key referencing the 'lockers' table
    status TEXT NOT NULL,                          -- Current status of the box ('empty', 'occupied')
    dimensions TEXT,                               -- Dimensions of the box (e.g., '20x30x40cm')
    availability_start_day TEXT,                   -- Start date for parcel availability (YYYY-MM-DD)
    availability_end_day TEXT,                     -- End date for parcel availability (YYYY-MM-DD)
    parcel_customer_name TEXT,                     -- Name of the customer for the parcel
    parcel_verification_code_1 TEXT,               -- First 4-digit verification code
    parcel_verification_code_2 TEXT,               -- Second 4-digit verification code

    -- Define foreign key constraint
    FOREIGN KEY (locker_id) REFERENCES lockers(id) ON DELETE CASCADE
);

-- Optional: Add indexes for better performance on common queries
CREATE INDEX IF NOT EXISTS idx_locker_status ON lockers (status);
CREATE INDEX IF NOT EXISTS idx_box_locker_id ON boxes (locker_id);
CREATE INDEX IF NOT EXISTS idx_box_status ON boxes (status);


-- Sample Data for 'lockers' table
INSERT INTO lockers (id, status, fullness, coordinates, business, availability) VALUES
('LOCKER001', 'available', 'has_boxes', 'Lat:48.85, Lon:2.29, Paris', 'City Mall', 'Mon-Sun 08:00-22:00'),
('LOCKER002', 'maintenance', 'empty', 'Lat:40.71, Lon:-74.00, NYC', 'Grand Central Station', 'Mon-Fri 06:00-23:00'),
('LOCKER003', 'inactive', 'empty', 'Lat:51.50, Lon:0.12, London', 'Oxford Street Shop', 'Not Available'),
('LOCKER004', 'available', 'full', 'Lat:34.05, Lon:-118.24, LA', 'Downtown Market', 'Mon-Sat 09:00-20:00');

-- Sample Data for 'boxes' table
INSERT INTO boxes (id, locker_id, status, dimensions, availability_start_day, availability_end_day, parcel_customer_name, parcel_verification_code_1, parcel_verification_code_2) VALUES
('BOX001-A', 'LOCKER001', 'occupied', '20x30x40cm', '2025-06-20', '2025-06-27', 'Alice Wonderland', '1234', '5678'),
('BOX001-B', 'LOCKER001', 'empty', '25x25x25cm', NULL, NULL, NULL, NULL, NULL),
('BOX001-C', 'LOCKER001', 'occupied', '30x30x30cm', '2025-06-21', '2025-06-28', 'Bob The Builder', '9876', '5432'),
('BOX001-D', 'LOCKER001', 'empty', '15x20x30cm', NULL, NULL, NULL, NULL, NULL),
('BOX002-A', 'LOCKER002', 'empty', '40x50x60cm', NULL, NULL, NULL, NULL, NULL),
('BOX002-B', 'LOCKER002', 'empty', '20x20x20cm', NULL, NULL, NULL, NULL, NULL),
('BOX004-A', 'LOCKER004', 'occupied', '20x30x40cm', '2025-06-22', '2025-06-29', 'Charlie Chaplin', '1111', '2222'),
('BOX004-B', 'LOCKER004', 'occupied', '25x25x25cm', '2025-06-22', '2025-06-29', 'Diana Ross', '3333', '4444'),
('BOX004-C', 'LOCKER004', 'occupied', '30x30x30cm', '2025-06-23', '2025-06-30', 'Eve Adams', '5555', '6666');
