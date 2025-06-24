// public/script.js

const lockersView = document.getElementById('lockers-view');
const boxesView = document.getElementById('boxes-view');
const lockersTableBody = document.getElementById('lockers-table-body');
const boxesTableBody = document.getElementById('boxes-table-body');
const backToLockersBtn = document.getElementById('back-to-lockers-btn');
const currentLockerIdSpan = document.getElementById('current-locker-id');
const loadingIndicator = document.getElementById('loading');
const messageDisplay = document.getElementById('message');

let currentLockerBeingViewed = null; // To store the ID of the locker whose boxes are currently displayed

// --- Utility Functions ---
function showLoading() {
    loadingIndicator.classList.remove('hidden');
    messageDisplay.textContent = '';
}

function hideLoading() {
    loadingIndicator.classList.add('hidden');
}

function displayMessage(msg, type = 'info') {
    messageDisplay.textContent = msg;
    messageDisplay.className = `text-center text-lg mb-4 p-2 rounded-md ${type === 'error' ? 'bg-red-900 text-red-200' : 'bg-yellow-900 text-yellow-200'}`;
    setTimeout(() => {
        messageDisplay.textContent = '';
        messageDisplay.className = `text-center text-lg mb-4 text-yellow-300`; // Reset class
    }, 5000); // Clear message after 5 seconds
}

function showLockersView() {
    lockersView.classList.remove('hidden');
    boxesView.classList.add('hidden');
    currentLockerBeingViewed = null;
    fetchLockers(); // Refresh lockers list when returning
}

function showBoxesView(lockerId) {
    lockersView.classList.add('hidden');
    boxesView.classList.remove('hidden');
    currentLockerIdSpan.textContent = lockerId;
    currentLockerBeingViewed = lockerId;
    fetchBoxesForLocker(lockerId);
}

// --- Fetch Data Functions ---

async function fetchLockers() {
    showLoading();
    try {
        const response = await fetch('/api/lockers');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const lockers = await response.json();
        renderLockersTable(lockers);
    } catch (error) {
        console.error("Error fetching lockers:", error);
        displayMessage(`Failed to load lockers: ${error.message}`, 'error');
        lockersTableBody.innerHTML = `<tr><td colspan="7" class="py-4 text-center text-red-300">Error loading lockers.</td></tr>`;
    } finally {
        hideLoading();
    }
}

async function fetchBoxesForLocker(lockerId) {
    showLoading();
    try {
        const response = await fetch(`/api/lockers/${lockerId}/boxes`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const boxes = await response.json();
        renderBoxesTable(boxes);
    } catch (error) {
        console.error(`Error fetching boxes for locker ${lockerId}:`, error);
        displayMessage(`Failed to load boxes for ${lockerId}: ${error.message}`, 'error');
        boxesTableBody.innerHTML = `<tr><td colspan="9" class="py-4 text-center text-red-300">Error loading boxes.</td></tr>`;
    } finally {
        hideLoading();
    }
}

// --- Render Table Functions ---

function renderLockersTable(lockers) {
    lockersTableBody.innerHTML = ''; // Clear previous content
    if (lockers.length === 0) {
        lockersTableBody.innerHTML = `<tr><td colspan="7" class="py-4 text-center text-gray-300">No lockers found.</td></tr>`;
        return;
    }

    lockers.forEach(locker => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-700 transition duration-150 ease-in-out';

        let statusClass = '';
        if (locker.status === 'available') statusClass = 'text-green-300';
        else if (locker.status === 'maintenance') statusClass = 'text-yellow-300';
        else statusClass = 'text-red-300';

        row.innerHTML = `
            <td class="py-3 px-6 font-medium text-lg">${locker.id}</td>
            <td class="py-3 px-6 ${statusClass} font-semibold">${locker.status.toUpperCase()}</td>
            <td class="py-3 px-6">${locker.fullness}</td>
            <td class="py-3 px-6">${locker.coordinates || 'N/A'}</td>
            <td class="py-3 px-6">${locker.business || 'N/A'}</td>
            <td class="py-3 px-6">${locker.availability || 'N/A'}</td>
            <td class="py-3 px-6">
                <button data-id="${locker.id}" class="view-boxes-btn bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-md text-sm transition duration-300 mr-2">
                    View Boxes
                </button>
                <div class="relative inline-block text-left">
                    <button class="status-dropdown-toggle bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-md text-sm transition duration-300">
                        Update Status
                    </button>
                    <div class="status-dropdown-menu absolute right-0 mt-2 w-48 bg-gray-700 rounded-md shadow-lg z-10 hidden">
                        <button data-id="${locker.id}" data-status="available" class="update-status-btn block w-full text-left px-4 py-2 text-sm text-white hover:bg-gray-600 rounded-t-md">Available</button>
                        <button data-id="${locker.id}" data-status="maintenance" class="update-status-btn block w-full text-left px-4 py-2 text-sm text-white hover:bg-gray-600">Maintenance</button>
                        <button data-id="${locker.id}" data-status="inactive" class="update-status-btn block w-full text-left px-4 py-2 text-sm text-white hover:bg-gray-600 rounded-b-md">Inactive</button>
                    </div>
                </div>
            </td>
        `;
        lockersTableBody.appendChild(row);
    });

    // Add event listeners for new buttons
    document.querySelectorAll('.view-boxes-btn').forEach(button => {
        button.onclick = () => showBoxesView(button.dataset.id);
    });

    document.querySelectorAll('.status-dropdown-toggle').forEach(button => {
        button.onclick = (e) => {
            // Close other open dropdowns
            document.querySelectorAll('.status-dropdown-menu').forEach(menu => {
                if (menu !== e.target.nextElementSibling) {
                    menu.classList.add('hidden');
                }
            });
            e.target.nextElementSibling.classList.toggle('hidden');
        };
    });

    document.querySelectorAll('.update-status-btn').forEach(button => {
        button.onclick = (e) => {
            const lockerId = button.dataset.id;
            const newStatus = button.dataset.status;
            updateLockerStatus(lockerId, newStatus);
            // Hide the dropdown after selection
            e.target.closest('.status-dropdown-menu').classList.add('hidden');
        };
    });

    // Close dropdowns if clicked outside
    document.addEventListener('click', (e) => {
        if (!e.target.matches('.status-dropdown-toggle')) {
            document.querySelectorAll('.status-dropdown-menu').forEach(menu => {
                menu.classList.add('hidden');
            });
        }
    });
}

function renderBoxesTable(boxes) {
    boxesTableBody.innerHTML = ''; // Clear previous content
    if (boxes.length === 0) {
        boxesTableBody.innerHTML = `<tr><td colspan="9" class="py-4 text-center text-gray-300">No boxes found for this locker.</td></tr>`;
        return;
    }

    boxes.forEach(box => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-700 transition duration-150 ease-in-out';

        let statusClass = '';
        if (box.status === 'empty') statusClass = 'text-green-300';
        else statusClass = 'text-orange-300';

        row.innerHTML = `
            <td class="py-3 px-6 font-medium text-lg">${box.id}</td>
            <td class="py-3 px-6 ${statusClass} font-semibold">${box.status.toUpperCase()}</td>
            <td class="py-3 px-6">${box.dimensions || 'N/A'}</td>
            <td class="py-3 px-6">${box.availability_start_day || 'N/A'}</td>
            <td class="py-3 px-6">${box.availability_end_day || 'N/A'}</td>
            <td class="py-3 px-6">${box.parcel_customer_name || 'N/A'}</td>
            <td class="py-3 px-6 font-mono">${box.parcel_verification_code_1 || 'N/A'}</td>
            <td class="py-3 px-6 font-mono">${box.parcel_verification_code_2 || 'N/A'}</td>
            <td class="py-3 px-6">
                ${box.status === 'occupied' ? `
                <button data-id="${box.id}" class="pickup-box-btn bg-pink-500 hover:bg-pink-600 text-white font-bold py-2 px-4 rounded-md text-sm transition duration-300">
                    Mark Picked Up
                </button>
                ` : '<span class="text-gray-400">Empty</span>'}
            </td>
        `;
        boxesTableBody.appendChild(row);
    });

    // Add event listeners for new buttons
    document.querySelectorAll('.pickup-box-btn').forEach(button => {
        button.onclick = () => updateBoxToEmpty(button.dataset.id);
    });
}

// --- Update Data Functions (via API) ---

async function updateLockerStatus(lockerId, newStatus) {
    showLoading();
    try {
        const response = await fetch(`/api/lockers/${lockerId}/status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: newStatus })
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const result = await response.json();
        displayMessage(result.message);
        fetchLockers(); // Refresh locker list
    } catch (error) {
        console.error(`Error updating locker ${lockerId} status:`, error);
        displayMessage(`Failed to update locker status: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

async function updateBoxToEmpty(boxId) {
    showLoading();
    try {
        const response = await fetch(`/api/boxes/${boxId}/pickup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const result = await response.json();
        displayMessage(result.message);
        if (currentLockerBeingViewed) {
            fetchBoxesForLocker(currentLockerBeingViewed); // Refresh boxes for current locker
        }
    } catch (error) {
        console.error(`Error marking box ${boxId} as picked up:`, error);
        displayMessage(`Failed to mark box as picked up: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

// --- Event Listeners ---
backToLockersBtn.addEventListener('click', showLockersView);

// Initial data load when the page loads
document.addEventListener('DOMContentLoaded', fetchLockers);
