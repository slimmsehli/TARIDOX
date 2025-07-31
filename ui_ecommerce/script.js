// Initialize the map
let map;
let markers = L.featureGroup(); // To manage all locker markers
let currentLat = 45.1885; // Default to Grenoble, France
let currentLon = 5.7245; // Default to Grenoble, France
const DEFAULT_RADIUS = 10000; // 10 km default search radius

function initializeMap(lat = currentLat, lon = currentLon) {
    if (map) {
        map.remove(); // Remove existing map if any
    }
    map = L.map('map').setView([lat, lon], 13); // Set default view

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    markers.addTo(map); // Add the feature group to the map
}

// Function to fetch lockers from your API
async function fetchLockers(latitude, longitude, radius = DEFAULT_RADIUS) {
    const url = `/api/lockers?lat=${latitude}&lon=${longitude}&radius=${radius}`;
    console.log(`Fetching lockers from: ${url}`);
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data.lockers; // Your API now returns { lockers: [...] }
    } catch (error) {
        console.error('Error fetching lockers from API:', error);
        return []; // Return empty array on error
    }
}

// Function to display lockers on the map and in the list
async function displayLockers(latitude, longitude) {
    markers.clearLayers(); // Clear existing markers
    const lockerListElement = document.getElementById('lockerList');
    lockerListElement.innerHTML = '<li class="no-lockers-message">Searching for lockers...</li>';

    try {
        const lockers = await fetchLockers(latitude, longitude);

        if (lockers.length === 0) {
            lockerListElement.innerHTML = '<li class="no-lockers-message">No lockers found in this area. Try searching a different location or zooming out.</li>';
            return;
        }

        lockerListElement.innerHTML = ''; // Clear "Searching..." message

        lockers.forEach(locker => {
            // Ensure locker has valid coordinates before adding to map
            if (locker.latitude && locker.longitude) {
                const marker = L.marker([locker.latitude, locker.longitude])
                    .bindPopup(`<b>${locker.name}</b><br>${locker.address}<br>Empty Boxes: ${locker.empty_boxes_left}`)
                    .on('click', () => {
                        // Highlight the corresponding list item when marker is clicked
                        const listItem = document.getElementById(`locker-${locker.locker_id}`);
                        if (listItem) {
                            listItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                            toggleLockerDetails(listItem); // Expand/collapse details
                        }
                    });
                markers.addLayer(marker);
            } else {
                console.warn(`Locker ${locker.locker_id} (${locker.name}) missing coordinates, cannot display on map.`);
            }


            // Add to list
            const listItem = document.createElement('li');
            listItem.className = 'locker-item';
            listItem.id = `locker-${locker.locker_id}`; // Use locker_id from API
            listItem.innerHTML = `
                <div class="locker-header">
                    <span>${locker.name} - ${locker.address}</span>
                    <i class="arrow-icon">▶</i>
                </div>
                <div class="locker-details">
                    <p><strong>Status:</strong> ${locker.status}</p>
                    <p><strong>Fullness:</strong> ${locker.fullness}</p>
                    <p><strong>Empty Boxes Available:</strong> ${locker.empty_boxes_left}</p>
                    <p><strong>Working Hours:</strong> ${locker.working_hours || 'N/A'}</p>
                    <p><strong>Business Info:</strong> ${locker.business_info || 'N/A'}</p>
                    ${locker.status === 'online' && locker.empty_boxes_left > 0 ?
                        `<button class="select-button" data-locker-id="${locker.locker_id}">Select This Locker</button>` :
                        `<button class="select-button" disabled>Not Available</button>`
                    }
                </div>
            `;
            lockerListElement.appendChild(listItem);
        });

        // Add event listeners for expanding/collapsing details
        lockerListElement.querySelectorAll('.locker-header').forEach(header => {
            header.addEventListener('click', (event) => {
                const listItem = event.currentTarget.closest('.locker-item');
                toggleLockerDetails(listItem);
            });
        });

        // Add event listeners for the "Select Locker" button
        lockerListElement.querySelectorAll('.select-button').forEach(button => {
            button.addEventListener('click', (event) => {
                const lockerId = event.target.dataset.lockerId;
                reserveLocker(lockerId); // Call the reservation API
            });
        });

        // Only fit bounds if there are markers to show
        if (markers.getLayers().length > 0) {
            map.fitBounds(markers.getBounds());
        } else {
            // If no markers, just center on the searched location
            map.setView([latitude, longitude], 13);
        }
    } catch (error) {
        console.error('Error fetching or displaying lockers:', error);
        lockerListElement.innerHTML = '<li class="no-lockers-message" style="color: red;">Error loading lockers. Please try again.</li>';
    }
}

function toggleLockerDetails(listItem) {
    const details = listItem.querySelector('.locker-details');
    const header = listItem.querySelector('.locker-header');
    const arrowIcon = header.querySelector('.arrow-icon');

    if (details.classList.contains('expanded')) {
        details.classList.remove('expanded');
        details.style.maxHeight = '0';
        arrowIcon.textContent = '▶'; // Point right
    } else {
        // Close any other open details
        document.querySelectorAll('.locker-details.expanded').forEach(openDetails => {
            openDetails.classList.remove('expanded');
            openDetails.style.maxHeight = '0';
            openDetails.closest('.locker-item').querySelector('.arrow-icon').textContent = '▶';
        });

        details.classList.add('expanded');
        // Set max-height dynamically based on content, plus a small buffer
        details.style.maxHeight = details.scrollHeight + 20 + 'px';
        arrowIcon.textContent = '▼'; // Point down
    }
}


// Function to handle locker reservation (integrates with your /api/reserve_box)
async function reserveLocker(lockerId) {
    console.log(`Attempting to reserve locker: ${lockerId}`);

    // --- IMPORTANT: These values would typically come from your e-commerce checkout form ---
    const packageDetails = {
        package_height: 10,
        package_width: 10,
        package_length: 10,
        package_volume: 10 * 10 * 10, // cm³
        customer_email: 'customer@example.com', // Replace with dynamic customer email
        customer_name: 'John Doe', // Replace with dynamic customer name
        customer_phone: '+33612345678', // Optional
        parcel_name: 'E-commerce Order #12345', // Replace with dynamic parcel name
        ecommerce_name: 'MyOnlineStore' // Your e-commerce business name
    };
    // --------------------------------------------------------------------------------------

    try {
        const response = await fetch('/api/reserve_box', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ locker_id: lockerId, ...packageDetails }),
        });

        const data = await response.json();

        if (data.success) {
            alert(`Locker ${data.locker_id} (Box ${data.box_id}) reserved successfully! Delivery Code: ${data.delivery_code}. This code is for the delivery person.`);
            console.log('Reservation successful:', data);
            // In a real e-commerce integration, you would typically:
            // 1. Send the `locker_id` and `box_id` back to the parent e-commerce page/system.
            // 2. Possibly send `delivery_code` to the e-commerce backend for delivery confirmation.
            // 3. Potentially close this locker selection window/modal or redirect.
            window.parent.postMessage({
                type: 'lockerSelectedAndReserved',
                lockerId: data.locker_id,
                boxId: data.box_id,
                deliveryCode: data.delivery_code
            }, '*'); // Use specific origin instead of '*' in production

        } else {
            alert(`Reservation failed: ${data.message}`);
            console.error('Reservation failed:', data.message);
        }
    } catch (error) {
        console.error('Error during reservation API call:', error);
        alert('An error occurred during reservation. Please try again.');
    }
}

// Geocoding function (using OpenStreetMap Nominatim for simplicity)
async function geocodeAddress(address) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data && data.length > 0) {
            return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
        }
        return null;
    } catch (error) {
        console.error('Error geocoding address:', error);
        return null;
    }
}

// Event listener for the search button
document.getElementById('searchButton').addEventListener('click', async () => {
    const address = document.getElementById('locationSearch').value;
    if (address) {
        const coords = await geocodeAddress(address);
        if (coords) {
            currentLat = coords.lat;
            currentLon = coords.lon;
            map.setView([currentLat, currentLon], 13); // Center map on searched location
            displayLockers(currentLat, currentLon);
        } else {
            alert('Could not find location. Please try a different address.');
        }
    } else {
        alert('Please enter an address to search.');
    }
});

// Event listener for "Use My Location" button
document.getElementById('useMyLocationButton').addEventListener('click', () => {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                currentLat = position.coords.latitude;
                currentLon = position.coords.longitude;
                map.setView([currentLat, currentLon], 13);
                displayLockers(currentLat, currentLon);
            },
            (error) => {
                console.warn('Geolocation failed:', error);
                alert('Could not get your current location. Please try searching or allowing location access.');
                // Optionally display lockers at the default or current map center
                displayLockers(currentLat, currentLon);
            }
        );
    } else {
        alert('Geolocation is not supported by your browser.');
        displayLockers(currentLat, currentLon);
    }
});


// Initial load: Get user's current location or default
window.onload = () => {
    initializeMap(); // Initialize map with default view first
    // Try to get user's location, otherwise use default
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                currentLat = position.coords.latitude;
                currentLon = position.coords.longitude;
                map.setView([currentLat, currentLon], 13); // Center map on user
                displayLockers(currentLat, currentLon);
            },
            (error) => {
                console.warn('Geolocation failed:', error);
                alert('Could not get your current location. Displaying default lockers.');
                displayLockers(currentLat, currentLon); // Use default map center
            }
        );
    } else {
        alert('Geolocation is not supported by your browser. Displaying default lockers.');
        displayLockers(currentLat, currentLon); // Use default map center
    }
};

// Listen for map drag/zoom end to re-fetch lockers in the visible area
map.on('moveend', () => {
    const center = map.getCenter();
    // In a real scenario, you might want to adjust the radius based on zoom level
    // For simplicity, we'll keep a fixed radius or calculate from map bounds
    // A simple approximation for radius based on map bounds:
    // const bounds = map.getBounds();
    // const northEast = bounds.getNorthEast();
    // const southWest = bounds.getSouthWest();
    // const mapCenter = map.getCenter();
    // const maxDistance = mapCenter.distanceTo(northEast); // Distance from center to corner
    // displayLockers(center.lat, center.lng, maxDistance);
    currentLat = center.lat;
    currentLon = center.lng;
    displayLockers(currentLat, currentLon, DEFAULT_RADIUS); // Fetch lockers within default radius of current map center
});