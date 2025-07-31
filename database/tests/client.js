// test_client.js
// This script is designed to interact with your Locker Admin Dashboard API
// To run: node test_client.js
// Requires Node.js v18+ for native fetch. For older versions, install node-fetch: npm install node-fetch

// const fetch = require('node-fetch'); // Uncomment this line if you are on Node.js < 18

const BASE_URL = 'http://localhost:3000/api'; // Your server's API base URL

// --- Configuration for specific tests ---
// IMPORTANT: Replace these with actual IDs from your database for testing fill/pickup
const TEST_LOCKER_ID = 7; // Example: An existing locker ID
const TEST_BOX_ID = 23;    // Example: An empty box ID within the TEST_LOCKER_ID

// --- Helper function for making API requests ---
async function makeRequest(url, method = 'GET', data = null) {
    console.log(`\n--- ${method} ${url} ---`);
    const options = {
        method: method,
        headers: {
            'Content-Type': 'application/json',
        },
    };

    if (data) {
        options.body = JSON.stringify(data);
    }

    try {
        const response = await fetch(url, options);
        const responseData = await response.json();

        if (!response.ok) {
            console.error(`Error: ${response.status} ${response.statusText}`);
            console.error('Response Data:', responseData);
            return null;
        }

        console.log('Success!');
        console.log('Response:', responseData);
        return responseData;
    } catch (error) {
        console.error('Request failed:', error.message);
        return null;
    }
}

// --- API Test Functions ---

async function testGetAllLockers() {
    console.log('\n=== Testing GET /api/lockers ===');
    return await makeRequest(`${BASE_URL}/lockers`);
}

async function testGetSpecificLocker(lockerId) {
    console.log(`\n=== Testing GET /api/locker/${lockerId} ===`);
    return await makeRequest(`${BASE_URL}/locker/${lockerId}`);
}

async function testConnectLocker(lockerId) {
    console.log(`\n=== Testing POST /api/locker/${lockerId}/connect ===`);
    return await makeRequest(`${BASE_URL}/locker/${lockerId}/connect`, 'POST');
}

async function testDisconnectLocker(lockerId) {
    console.log(`\n=== Testing POST /api/locker/${lockerId}/disconnect ===`);
    return await makeRequest(`${BASE_URL}/locker/${lockerId}/disconnect`, 'POST');
}

async function testFillParcel(lockerId, boxId) {
    console.log(`\n=== Testing POST /api/locker/${lockerId}/box/${boxId}/fill_parcel ===`);
    const parcelData = {
        height: 10,
        width: 10,
        length: 10,
        volume: 1000,
        parcel_name: `Test Parcel ${Date.now()}`,
        customer_name: 'John Doe',
        customer_phone: '123-456-7890',
        ecommerce_name: 'Test E-commerce',
        occupied_from: new Date().toISOString().slice(0, 19).replace('T', ' '), // YYYY-MM-DD HH:MM:SS
        box_health: 'working'
    };
    return await makeRequest(`${BASE_URL}/locker/${lockerId}/box/${boxId}/fill_parcel`, 'POST', parcelData);
}

async function testPickupParcel(lockerId, boxId) {
    console.log(`\n=== Testing POST /api/locker/${lockerId}/box/${boxId}/pickup_parcel ===`);
    return await makeRequest(`${BASE_URL}/locker/${lockerId}/box/${boxId}/pickup_parcel`, 'POST');
}

// --- Main test sequence ---
async function runTests() {
    console.log('Starting API tests...');

    // Test 1: Get all lockers
    const allLockers = await testGetAllLockers();
    if (allLockers && allLockers.lockers.length > 0) {
        console.log(`Found ${allLockers.lockers.length} lockers.`);
        // You can use one of these locker IDs for subsequent tests
        // const firstLockerId = allLockers.lockers[0].locker_id;
        // console.log(`Using first locker ID for specific tests: ${firstLockerId}`);
    } else {
        console.log('No lockers found. Please add some lockers via the web UI to test further endpoints.');
    }

    // Test 2: Get a specific locker (using pre-configured ID)
    if (TEST_LOCKER_ID) {
        await testGetSpecificLocker(TEST_LOCKER_ID);
    } else {
        console.warn('TEST_LOCKER_ID not set. Skipping specific locker test.');
    }

    // Test 3: Connect a locker
    if (TEST_LOCKER_ID) {
        await testConnectLocker(TEST_LOCKER_ID);
    } else {
        console.warn('TEST_LOCKER_ID not set. Skipping connect locker test.');
    }

    // Give a small delay for server to process status update if needed
    await new Promise(resolve => setTimeout(resolve, 500));

    // Test 4: Disconnect a locker
    if (TEST_LOCKER_ID) {
        await testDisconnectLocker(TEST_LOCKER_ID);
    } else {
        console.warn('TEST_LOCKER_ID not set. Skipping disconnect locker test.');
    }

    // Test 5: Fill a box
    if (TEST_LOCKER_ID && TEST_BOX_ID) {
        console.log('\nAttempting to fill a box. Ensure box is empty and exists.');
        await testFillParcel(TEST_LOCKER_ID, TEST_BOX_ID);
    } else {
        console.warn('TEST_LOCKER_ID or TEST_BOX_ID not set. Skipping fill parcel test.');
    }

    // Give a small delay for server to process status update if needed
    await new Promise(resolve => setTimeout(resolve, 500));

    // Test 6: Pick up a parcel
    if (TEST_LOCKER_ID && TEST_BOX_ID) {
        console.log('\nAttempting to pick up a parcel. Ensure box is full.');
        await testPickupParcel(TEST_LOCKER_ID, TEST_BOX_ID);
    } else {
        console.warn('TEST_LOCKER_ID or TEST_BOX_ID not set. Skipping pickup parcel test.');
    }

    console.log('\nAPI tests finished.');
}

// Run the tests
runTests();

