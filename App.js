import React, { useState, useEffect, useCallback, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, addDoc, setDoc, deleteDoc, query } from 'firebase/firestore';

// Ensure Tailwind CSS is loaded via a script tag in your HTML if not using a build process.
// Example: <script src="https://cdn.tailwindcss.com"></script>

function App() {
    // Firebase and Firestore instances
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);

    // Locker data from Firestore
    const [lockers, setLockers] = useState([]);
    const [selectedLockerId, setSelectedLockerId] = useState(null);
    const [selectedLockerDetails, setSelectedLockerDetails] = useState(null);
    const [currentBoxData, setCurrentBoxData] = useState([]); // This will hold box data from a client
    const [isFetchingBoxData, setIsFetchingBoxData] = useState(false);

    // UI state for Add Locker Modal
    const [showAddLockerModal, setShowAddLockerModal] = useState(false);
    const [newLockertName, setNewLockertName] = useState('');
    const [newLockertLatitude, setNewLockertLatitude] = useState('');
    const [newLockertLongitude, setNewLockertLongitude] = useState('');
    const [newLockertCommerce, setNewLockertCommerce] = useState('');
    const [newLockertOpeningHours, setNewLockertOpeningHours] = useState('');

    // UI state for custom confirmation modal
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmMessage, setConfirmMessage] = useState('');
    const [confirmAction, setConfirmAction] = useState(null); // Function to execute on confirm

    // General message display
    const [message, setMessage] = useState('');
    const [messageType, setMessageType] = useState(''); // 'success', 'error', 'info'

    // Ref for cleanup
    const unsubscribeLockerRef = useRef(null);

    // Initialize Firebase
    useEffect(() => {
        try {
            const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
            const app = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(app);
            const firebaseAuth = getAuth(app);

            setDb(firestoreDb);
            setAuth(firebaseAuth);

            // Listen for auth state changes
            const unsubscribeAuth = onAuthStateChanged(firebaseAuth, async (user) => {
                if (user) {
                    setUserId(user.uid);
                    setIsAuthReady(true);
                    displayMessage('Signed in successfully.', 'success');
                } else {
                    // Sign in anonymously if no token is provided (for local testing)
                    try {
                        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                            await signInWithCustomToken(firebaseAuth, __initial_auth_token);
                            displayMessage('Signed in with custom token.', 'success');
                        } else {
                            await signInAnonymously(firebaseAuth);
                            displayMessage('Signed in anonymously.', 'success');
                        }
                    } catch (error) {
                        console.error('Firebase Auth Error:', error);
                        displayMessage(`Auth Error: ${error.message}`, 'error');
                    }
                    setIsAuthReady(true); // Still set ready even if anonymous
                }
            });

            return () => unsubscribeAuth();
        } catch (error) {
            console.error("Firebase initialization failed:", error);
            displayMessage(`Firebase Init Error: ${error.message}`, 'error');
        }
    }, []);

    const displayMessage = useCallback((msg, type) => {
        setMessage(msg);
        setMessageType(type);
        const timer = setTimeout(() => {
            setMessage('');
            setMessageType('');
        }, 5000); // Clear message after 5 seconds
        return () => clearTimeout(timer); // Cleanup on re-render
    }, []);

    // Fetch lockers from Firestore
    useEffect(() => {
        if (!db || !isAuthReady) return;

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const lockersCollectionRef = collection(db, `artifacts/${appId}/public/data/lockers`);
        const q = query(lockersCollectionRef); // No orderBy to avoid index issues

        unsubscribeLockerRef.current = onSnapshot(q, (snapshot) => {
            const fetchedLockers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            // Sort in memory if needed, e.g., by name
            fetchedLockers.sort((a, b) => (a.locker_name || '').localeCompare(b.locker_name || ''));
            setLockers(fetchedLockers);
        }, (error) => {
            console.error("Error fetching lockers:", error);
            displayMessage(`Error fetching lockers: ${error.message}`, 'error');
        });

        return () => {
            if (unsubscribeLockerRef.current) {
                unsubscribeLockerRef.current();
            }
        };
    }, [db, isAuthReady, userId, displayMessage]); // Re-run if db, auth state, or userId changes

    // Set selected locker details when selectedLockerId changes
    useEffect(() => {
        if (selectedLockerId) {
            const details = lockers.find(locker => locker.id === selectedLockerId);
            setSelectedLockerDetails(details);
            if (details) {
                // Fetch box data from the backend when a locker is selected
                fetchBoxData(selectedLockerId);
            }
        } else {
            setSelectedLockerDetails(null);
            setCurrentBoxData([]);
        }
    }, [selectedLockerId, lockers, fetchBoxData]); // Depend on lockers to update if they change

    const handleAddLocker = async () => {
        if (!db || !userId) {
            displayMessage("Database not ready or not authenticated.", 'error');
            return;
        }

        if (!newLockertName || !newLockertLatitude || !newLockertLongitude) {
            displayMessage("Locker name, latitude, and longitude are required.", 'error');
            return;
        }

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const lockerCollectionPath = `artifacts/${appId}/public/data/lockers`;

        try {
            // Generate a simple unique ID for the prototype. In production, use UUID or similar.
            // This ID needs to be explicitly set by the user to match the client simulator's ID.
            const newLockerId = newLockertName.replace(/\s+/g, '-').toUpperCase().substring(0, 15) + '-' + Date.now().toString().slice(-6);
            
            // Set the document with a custom ID for easy lookup by the client simulator
            await setDoc(doc(db.collection(lockerCollectionPath), newLockerId), {
                locker_id: newLockerId, // Store id within document too for easier client identification
                locker_name: newLockertName,
                latitude: parseFloat(newLockertLatitude),
                longitude: parseFloat(newLockertLongitude),
                commerce_name: newLockertCommerce || null,
                opening_hours: newLockertOpeningHours || null,
                is_full: false,
                status: 'Offline', // Default status for a new locker until client connects
                temperature_c: null,
                last_online: null,
            });
            displayMessage(`Locker "${newLockertName}" added successfully with ID: ${newLockerId}. REMEMBER THIS ID TO CONFIGURE YOUR CLIENT SIMULATOR!`, 'success');
            setShowAddLockerModal(false);
            setNewLockertName('');
            setNewLockertLatitude('');
            setNewLockertLongitude('');
            setNewLockertCommerce('');
            setNewLockertOpeningHours('');
        } catch (error) {
            console.error("Error adding locker:", error);
            displayMessage(`Error adding locker: ${error.message}`, 'error');
        }
    };

    const handleDeleteLocker = async (lockerId, lockerName) => {
        if (!db || !userId) {
            displayMessage("Database not ready or not authenticated.", 'error');
            return;
        }

        const confirmed = await new Promise(resolve => {
            setConfirmMessage(`Are you sure you want to delete locker "${lockerName}" (ID: ${lockerId})?`);
            setConfirmAction(() => () => resolve(true)); // Set action to resolve true
            setShowConfirmModal(true); // Show the modal
        });

        if (!confirmed) {
            return;
        }

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const lockerDocRef = doc(db.collection(`artifacts/${appId}/public/data/lockers`), lockerId);

        try {
            await deleteDoc(lockerDocRef);
            displayMessage(`Locker "${lockerName}" deleted successfully.`, 'success');
            if (selectedLockerId === lockerId) {
                setSelectedLockerId(null); // Deselect if the current locker is deleted
            }
        } catch (error) {
            console.error("Error deleting locker:", error);
            displayMessage(`Error deleting locker: ${error.message}`, 'error');
        }
    };

    const fetchBoxData = useCallback(async (lockerId) => {
        setIsFetchingBoxData(true);
        setCurrentBoxData([]); // Clear previous data
        displayMessage(`Requesting box data for ${lockerId}...`, 'info');
        try {
            // This API call goes to our Node.js backend, which will then use MQTT
            const response = await fetch(`http://localhost:5000/api/lockers/${lockerId}/boxes`);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }
            const data = await response.json();
            setCurrentBoxData(data);
            displayMessage(`Box data loaded for ${lockerId}.`, 'success');
        } catch (error) {
            console.error("Error fetching box data:", error);
            displayMessage(`Error fetching box data: ${error.message}. Ensure Node.js backend and client simulator are running.`, 'error');
            setCurrentBoxData([]); // Clear data on error
        } finally {
            setIsFetchingBoxData(false);
        }
    }, [displayMessage]);

    const handleUnlockBox = async (lockerId, boxId) => {
        const confirmed = await new Promise(resolve => {
            setConfirmMessage(`Are you sure you want to send an unlock command to box ${boxId} in locker ${lockerId}?`);
            setConfirmAction(() => () => resolve(true)); // Set action to resolve true
            setShowConfirmModal(true); // Show the modal
        });

        if (!confirmed) {
            return;
        }

        displayMessage(`Sending unlock command for box ${boxId} in locker ${lockerId}...`, 'info');
        try {
            const response = await fetch(`http://localhost:5000/api/lockers/${lockerId}/boxes/${boxId}/unlock`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ action: 'unlock' })
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }
            const data = await response.json();
            displayMessage(`Unlock command sent for box ${boxId}: ${data.message}`, 'success');
            // Re-fetch box data after a short delay to see the updated status
            setTimeout(() => fetchBoxData(lockerId), 2000);
        } catch (error) {
            console.error("Error sending unlock command:", error);
            displayMessage(`Error sending unlock command: ${error.message}. Ensure Node.js backend and client simulator are running.`, 'error');
        }
    };

    const CustomConfirmModal = () => {
        if (!showConfirmModal) return null;

        const handleConfirm = () => {
            if (confirmAction) {
                confirmAction();
            }
            setShowConfirmModal(false);
            setConfirmAction(null);
            setConfirmMessage('');
        };

        const handleCancel = () => {
            if (confirmAction) {
                // If the action resolves a Promise, resolve with false on cancel
                // Otherwise, just do nothing.
                confirmAction(false);
            }
            setShowConfirmModal(false);
            setConfirmAction(null);
            setConfirmMessage('');
        };

        return (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center p-4 z-50">
                <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-sm">
                    <h2 className="text-xl font-bold mb-4 text-gray-800">Confirmation</h2>
                    <p className="text-gray-700 mb-6">{confirmMessage}</p>
                    <div className="flex justify-end space-x-3">
                        <button
                            onClick={handleCancel}
                            className="px-5 py-2 bg-gray-300 text-gray-800 rounded-lg shadow-sm hover:bg-gray-400 transition duration-200"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirm}
                            className="px-5 py-2 bg-red-600 text-white font-medium rounded-lg shadow-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition duration-200"
                        >
                            Confirm
                        </button>
                    </div>
                </div>
            </div>
        );
    };


    if (!isAuthReady) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <p className="text-xl text-gray-700">Initializing Firebase...</p>
            </div>
        );
    }

    return (
        <div className="font-sans antialiased text-gray-800 bg-gray-50 min-h-screen p-4 sm:p-6 md:p-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
                {`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
                body { font-family: 'Inter', sans-serif; }
                `}
            </style>

            <div className="max-w-7xl mx-auto bg-white p-6 rounded-xl shadow-lg border border-gray-200">
                <h1 className="text-3xl font-bold text-center text-indigo-700 mb-8">Smart Locker Management Console</h1>

                {message && (
                    <div className={`p-3 mb-4 rounded-lg text-sm ${messageType === 'success' ? 'bg-green-100 text-green-700' : messageType === 'error' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                        {message}
                    </div>
                )}

                {!selectedLockerId ? (
                    // Locker List View
                    <div>
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-2xl font-semibold text-gray-700">All Lockers</h2>
                            <button
                                onClick={() => setShowAddLockerModal(true)}
                                className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg shadow-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition duration-200"
                            >
                                Add New Locker
                            </button>
                        </div>

                        {lockers.length === 0 ? (
                            <p className="text-gray-500 text-center py-8">No lockers found. Add a new one!</p>
                        ) : (
                            <div className="overflow-x-auto rounded-lg shadow-sm border border-gray-100">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Locker ID</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Location (Lat, Lng)</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Commerce</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Full</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Temp (°C)</th>
                                            <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {lockers.map((locker) => (
                                            <tr key={locker.id} className="hover:bg-gray-50">
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900">{locker.locker_id}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{locker.locker_name}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                    {locker.latitude?.toFixed(4)}, {locker.longitude?.toFixed(4)}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{locker.commerce_name || 'N/A'}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${locker.is_full ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                                                        {locker.is_full ? 'YES' : 'NO'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                                        locker.status === 'Active' ? 'bg-blue-100 text-blue-800' :
                                                        locker.status === 'Offline' ? 'bg-gray-100 text-gray-800' :
                                                        'bg-yellow-100 text-yellow-800'
                                                    }`}>
                                                        {locker.status}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                    {locker.temperature_c !== null ? `${locker.temperature_c?.toFixed(1)}°C` : 'N/A'}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                                                    <button
                                                        onClick={() => setSelectedLockerId(locker.id)}
                                                        className="text-indigo-600 hover:text-indigo-900 mx-2"
                                                    >
                                                        View Details
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteLocker(locker.id, locker.locker_name)}
                                                        className="text-red-600 hover:text-red-900 mx-2"
                                                    >
                                                        Delete
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                ) : (
                    // Locker Detail View
                    <div className="w-full">
                        <button
                            onClick={() => setSelectedLockerId(null)}
                            className="mb-6 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg shadow-sm hover:bg-gray-300 transition duration-200 text-sm"
                        >
                            &larr; Back to All Lockers
                        </button>

                        <h2 className="text-2xl font-semibold text-gray-700 mb-4">Locker Details: {selectedLockerDetails?.locker_name}</h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                            <div className="bg-gray-50 p-6 rounded-lg shadow-sm border border-gray-100">
                                <h3 className="text-xl font-medium text-gray-700 mb-4">General Information</h3>
                                <p><strong className="font-semibold">Locker ID:</strong> {selectedLockerDetails?.locker_id}</p>
                                <p><strong className="font-semibold">Location:</strong> {selectedLockerDetails?.latitude?.toFixed(4)}, {selectedLockerDetails?.longitude?.toFixed(4)}</p>
                                <p><strong className="font-semibold">Commerce:</strong> {selectedLockerDetails?.commerce_name || 'N/A'}</p>
                                <p><strong className="font-semibold">Opening Hours:</strong> {selectedLockerDetails?.opening_hours || 'N/A'}</p>
                                <p><strong className="font-semibold">Firebase Doc ID:</strong> {selectedLockerDetails?.id}</p>
                            </div>
                            <div className="bg-gray-50 p-6 rounded-lg shadow-sm border border-gray-100">
                                <h3 className="text-xl font-medium text-gray-700 mb-4">Real-time Status</h3>
                                <p><strong className="font-semibold">Full Status:</strong>
                                    <span className={`ml-2 px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${selectedLockerDetails?.is_full ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                                        {selectedLockerDetails?.is_full ? 'YES' : 'NO'}
                                    </span>
                                </p>
                                <p><strong className="font-semibold">Operational Status:</strong>
                                    <span className={`ml-2 px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                        selectedLockerDetails?.status === 'Active' ? 'bg-blue-100 text-blue-800' :
                                        selectedLockerDetails?.status === 'Offline' ? 'bg-gray-100 text-gray-800' :
                                        'bg-yellow-100 text-yellow-800'
                                    }`}>
                                        {selectedLockerDetails?.status}
                                    </span>
                                </p>
                                <p><strong className="font-semibold">Temperature:</strong> {selectedLockerDetails?.temperature_c !== null ? `${selectedLockerDetails?.temperature_c.toFixed(1)}°C` : 'N/A'}</p>
                                <p><strong className="font-semibold">Last Online:</strong> {selectedLockerDetails?.last_online ? new Date(selectedLockerDetails.last_online).toLocaleString() : 'N/A'}</p>
                                <button
                                    onClick={() => fetchBoxData(selectedLockerId)}
                                    className="mt-4 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition duration-200 text-sm"
                                    disabled={isFetchingBoxData}
                                >
                                    {isFetchingBoxData ? 'Fetching...' : 'Refresh Box Data'}
                                </button>
                            </div>
                        </div>

                        <h3 className="text-xl font-semibold text-gray-700 mb-4">Box Information</h3>
                        {isFetchingBoxData && <p className="text-gray-500 text-center py-4">Loading box data...</p>}
                        {!isFetchingBoxData && currentBoxData.length === 0 && <p className="text-gray-500 text-center py-4">No box data available. Ensure the client simulator for this locker is running.</p>}
                        {!isFetchingBoxData && currentBoxData.length > 0 && (
                            <div className="overflow-x-auto rounded-lg shadow-sm border border-gray-100">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Box ID</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Dimensions (cm)</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Volume (cm³)</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Occupied</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Occupied From</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Occupied To</th>
                                            <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Unlock Code</th>
                                            <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {currentBoxData.map((box) => (
                                            <tr key={box.box_id} className="hover:bg-gray-50">
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900">{box.box_id}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{box.width_cm}x{box.length_cm}x{box.height_cm}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{box.volume_cm3?.toFixed(2)}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${box.is_occupied ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                                                        {box.is_occupied ? 'YES' : 'NO'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{box.occupied_from ? new Date(box.occupied_from).toLocaleString() : 'N/A'}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{box.occupied_to ? new Date(box.occupied_to).toLocaleString() : 'N/A'}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">
                                                    {box.unlock_code_part1 ? `${box.unlock_code_part1}-****` : 'N/A'}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                                                    <button
                                                        onClick={() => handleUnlockBox(selectedLockerId, box.box_id)}
                                                        className="text-blue-600 hover:text-blue-900 mx-2"
                                                        disabled={!box.is_occupied}
                                                    >
                                                        Unlock
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Add Locker Modal */}
            {showAddLockerModal && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center p-4 z-50">
                    <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-lg">
                        <h2 className="text-2xl font-bold mb-6 text-indigo-700">Add New Locker</h2>
                        <div className="mb-4">
                            <label htmlFor="lockerName" className="block text-gray-700 text-sm font-semibold mb-2">Locker Name:</label>
                            <input
                                type="text"
                                id="lockerName"
                                value={newLockertName}
                                onChange={(e) => setNewLockertName(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                placeholder="e.g., Downtown Locker Hub"
                            />
                        </div>
                        <div className="mb-4">
                            <label htmlFor="latitude" className="block text-gray-700 text-sm font-semibold mb-2">Latitude:</label>
                            <input
                                type="number"
                                id="latitude"
                                value={newLockertLatitude}
                                onChange={(e) => setNewLockertLatitude(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                placeholder="e.g., 48.8566"
                                step="0.0001"
                            />
                        </div>
                        <div className="mb-4">
                            <label htmlFor="longitude" className="block text-gray-700 text-sm font-semibold mb-2">Longitude:</label>
                            <input
                                type="number"
                                id="longitude"
                                value={newLockertLongitude}
                                onChange={(e) => setNewLockertLongitude(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                placeholder="e.g., 2.3522"
                                step="0.0001"
                            />
                        </div>
                        <div className="mb-4">
                            <label htmlFor="commerce" className="block text-gray-700 text-sm font-semibold mb-2">Commerce Name (Optional):</label>
                            <input
                                type="text"
                                id="commerce"
                                value={newLockertCommerce}
                                onChange={(e) => setNewLockertCommerce(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                placeholder="e.g., City Mall"
                            />
                        </div>
                        <div className="mb-6">
                            <label htmlFor="openingHours" className="block text-gray-700 text-sm font-semibold mb-2">Opening Hours (Optional):</label>
                            <input
                                type="text"
                                id="openingHours"
                                value={newLockertOpeningHours}
                                onChange={(e) => setNewLockertOpeningHours(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                placeholder="e.g., Mon-Fri 9AM-5PM"
                            />
                        </div>
                        <div className="flex justify-end space-x-3">
                            <button
                                onClick={() => setShowAddLockerModal(false)}
                                className="px-5 py-2 bg-gray-300 text-gray-800 rounded-lg shadow-sm hover:bg-gray-400 transition duration-200"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAddLocker}
                                className="px-5 py-2 bg-indigo-600 text-white font-medium rounded-lg shadow-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition duration-200"
                            >
                                Add Locker
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Custom Confirmation Modal */}
            <CustomConfirmModal />
        </div>
    );
}

export default App;

