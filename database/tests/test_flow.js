// test_box_flow.js
// This script simulates the complete flow of parcel reservation, delivery, and pickup.
// To run: node test_box_flow.js
// Requires Node.js v18+ for native fetch. For older versions, install node-fetch: npm install node-fetch

// const fetch = require('node-fetch'); // Uncomment this line if you are on Node.js < 18

const BASE_URL = 'http://localhost:3000/api'; // Your server's API base URL

// --- Fixed Package Data for the Test ---
// IMPORTANT: Ensure your chosen locker (TEST_LOCKER_ID) has an empty box
// that can accommodate these dimensions.
const packageData = {
    locker_id: 1, // <<< IMPORTANT: Set an existing locker ID here with empty boxes
    package_height: 15,
    package_width: 15,
    package_length: 15,
    package_volume: 3375, // 15*15*15
    customer_email: 'test.customer@example.com', // Simulated customer email
    customer_name: 'Jane Doe',
    customer_phone: '987-654-3210',
    parcel_name: 'My Awesome Gadget',
    ecommerce_name: 'ElectroMart'
};

let reservedBoxId = null;
let deliveryCode = null;
let pickupCode1 = null;
let pickupCode2 = null;

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

// --- Test Flow Functions ---

// Step 1-3: Customer Reservation
async function step1_customerReservation() {
    console.log('\n=== Step 1-3: Customer reserves a box ===');
    console.log('Attempting to reserve a box for package:', packageData.parcel_name);

    const response = await makeRequest(`${BASE_URL}/reserve_box`, 'POST', packageData);

    if (response && response.success) {
        reservedBoxId = response.box_id;
        deliveryCode = response.delivery_code;
        console.log(`Box ${reservedBoxId} reserved successfully! Delivery Code: ${deliveryCode}`);
        return true;
    } else {
        console.error('Box reservation failed.');
        return false;
    }
}

// Step 4-5: Delivery Person Places Package
async function step2_deliveryConfirmation() {
    console.log('\n=== Step 4-5: Delivery person places package ===');
    if (!reservedBoxId || !deliveryCode) {
        console.error('Reservation data missing. Cannot proceed with delivery confirmation.');
        return false;
    }

    console.log(`Attempting to confirm delivery for Box ${reservedBoxId} with code ${deliveryCode}`);
    const confirmationData = {
        locker_id: packageData.locker_id,
        box_id: reservedBoxId,
        delivery_code: deliveryCode,
        actual_occupied_from: new Date().toISOString().slice(0, 19).replace('T', ' ') // Current timestamp
    };

    const response = await makeRequest(`${BASE_URL}/confirm_delivery`, 'POST', confirmationData);

    if (response && response.success) {
        pickupCode1 = response.pickup_code1;
        pickupCode2 = response.pickup_code2;
        console.log(`Delivery confirmed for Box ${reservedBoxId}. Customer Pickup Codes: ${pickupCode1} ${pickupCode2}`);
        console.log('Check your server console for the simulated email to the customer.');
        return true;
    } else {
        console.error('Delivery confirmation failed.');
        return false;
    }
}

// Step 6-7: Client Picks Up Parcel
async function step3_clientPickup() {
    console.log('\n=== Step 6-7: Client picks up parcel ===');
    if (!reservedBoxId || !pickupCode1 || !pickupCode2) {
        console.error('Pickup codes or box ID missing. Cannot proceed with pickup.');
        return false;
    }

    // In a real scenario, the client would use their codes to open the box via the locker hardware.
    // The locker hardware would then call the pickup_parcel API.
    // Here, we simulate the locker calling the API after the client "enters" codes.
    console.log(`Simulating client pickup for Box ${reservedBoxId} with codes ${pickupCode1} ${pickupCode2}`);

    const response = await makeRequest(`${BASE_URL}/locker/${packageData.locker_id}/box/${reservedBoxId}/pickup_parcel`, 'POST');

    if (response && response.success) {
        console.log(`Parcel picked up successfully from Box ${reservedBoxId}. Box is now empty.`);
        return true;
    } else {
        console.error('Parcel pickup failed.');
        return false;
    }
}

// --- Main Flow Execution ---
async function runFullFlowTest() {
    console.log('--- Starting Full Box Reservation and Pickup Flow Test ---');

    // Ensure the locker is online and has empty boxes before starting a fresh flow
    // You might want to add a check here to ensure the locker exists and has capacity
    // For simplicity, we assume TEST_LOCKER_ID is valid and has empty boxes.

    let success = await step1_customerReservation();
    if (!success) {
        console.error('Flow aborted: Reservation failed.');
        return;
    }

    // Small delay to simulate real-world time between reservation and delivery
    await new Promise(resolve => setTimeout(resolve, 1000));

    success = await step2_deliveryConfirmation();
    if (!success) {
        console.error('Flow aborted: Delivery confirmation failed.');
        return;
    }

    // Small delay to simulate real-world time between delivery and pickup
    await new Promise(resolve => setTimeout(resolve, 1000));

    success = await step3_clientPickup();
    if (!success) {
        console.error('Flow aborted: Client pickup failed.');
        return;
    }

    console.log('\n--- Full Box Reservation and Pickup Flow Test Completed Successfully! ---');
    console.log('Please verify the locker and box status in your admin dashboard (http://localhost:3000) and check your server console for simulated email output.');
}

// Execute the full flow
runFullFlowTest();

