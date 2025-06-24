import React, { useState, useEffect, useCallback, useRef } from 'react';

// Define the base URL for your API server
// Ensure this matches the port your Node.js server is running on (e.g., 3001)
const API_BASE_URL = 'http://localhost:3001/api';

function App() {
  const [lockerId, setLockerId] = useState(''); // State for the locker ID input
  const [currentLockerData, setCurrentLockerData] = useState(null); // State for locker information
  const [boxData, setBoxData] = useState([]); // State for boxes inside the locker
  const [loading, setLoading] = useState(false); // Loading state for API calls
  const [message, setMessage] = useState(''); // Message for user feedback
  const messageTimeoutRef = useRef(null); // Ref to store message timeout ID

  // Function to display messages with a timeout
  const displayMessage = useCallback((msg, type = 'info') => {
    setMessage(msg);
    // Clear any existing timeout
    if (messageTimeoutRef.current) {
      clearTimeout(messageTimeoutRef.current);
    }
    // Set a new timeout to clear the message after 5 seconds
    messageTimeoutRef.current = setTimeout(() => {
      setMessage('');
    }, 5000);
  }, []);


  // Function to fetch locker data
  const fetchLockerData = useCallback(async (id) => {
    setLoading(true);
    displayMessage(`Fetching data for locker ${id}...`);
    try {
      const response = await fetch(`${API_BASE_URL}/lockers/${id}`);
      if (response.ok) {
        const data = await response.json();
        setCurrentLockerData(data);
        displayMessage(`Locker ${id} data loaded.`);
      } else if (response.status === 404) {
        // Locker not found, allow creation
        setCurrentLockerData(null);
        displayMessage(`Locker ${id} not found. You can create it by loading/creating.`);
      } else {
        throw new Error(`Failed to fetch locker: ${response.statusText}`);
      }
    } catch (error) {
      console.error("Error fetching locker data:", error);
      displayMessage(`Error fetching locker data: ${error.message}`, 'error');
      setCurrentLockerData(null);
    } finally {
      setLoading(false);
    }
  }, [displayMessage]);

  // Function to fetch box data for the current locker
  const fetchBoxData = useCallback(async (id) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/lockers/${id}/boxes`);
      if (response.ok) {
        const boxes = await response.json();
        // Sort boxes by ID for consistent display
        boxes.sort((a, b) => a.id.localeCompare(b.id));
        setBoxData(boxes);
      } else {
        throw new Error(`Failed to fetch boxes: ${response.statusText}`);
      }
    } catch (error) {
      console.error("Error fetching box data:", error);
      displayMessage(`Error fetching box data: ${error.message}`, 'error');
      setBoxData([]);
    } finally {
      setLoading(false);
    }
  }, [displayMessage]);


  // Effect to automatically fetch data when lockerId state is set
  useEffect(() => {
    if (currentLockerData?.id) {
      fetchLockerData(currentLockerData.id); // Refresh locker info
      fetchBoxData(currentLockerData.id); // Fetch boxes
    }
    // Set up polling for regular updates (optional, for real-time feel without WebSockets)
    const interval = setInterval(() => {
        if (currentLockerData?.id) {
            fetchLockerData(currentLockerData.id);
            fetchBoxData(currentLockerData.id);
        }
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(interval); // Clean up interval on component unmount
  }, [currentLockerData?.id, fetchLockerData, fetchBoxData]);


  // Handler for loading/creating a locker
  const handleLoadOrCreateLocker = useCallback(async () => {
    if (!lockerId) {
      displayMessage('Please enter a Locker ID.', 'error');
      return;
    }
    setLoading(true);
    displayMessage(`Attempting to load/create locker ${lockerId}...`);
    try {
      const response = await fetch(`${API_BASE_URL}/lockers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: lockerId })
      });
      if (response.ok || response.status === 201) {
        const result = await response.json();
        setCurrentLockerData(result.locker); // Server now returns the locker object
        displayMessage(result.message);
      } else {
        throw new Error(`Server responded with status: ${response.status}`);
      }
    } catch (error) {
      console.error("Error loading/creating locker:", error);
      displayMessage(`Failed to load/create locker: ${error.message}`, 'error');
      setCurrentLockerData(null);
    } finally {
      setLoading(false);
    }
  }, [lockerId, displayMessage]);


  // Handlers for client-side updates (to server)
  const handleLockerStatusChange = async (newStatus) => {
    if (!currentLockerData?.id) return;
    setLoading(true);
    displayMessage(`Updating locker status to ${newStatus}...`);
    try {
      const response = await fetch(`${API_BASE_URL}/lockers/${currentLockerData.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (response.ok) {
        const result = await response.json();
        displayMessage(result.message);
        fetchLockerData(currentLockerData.id); // Refresh locker data after update
      } else {
        throw new Error(`Failed to update status: ${response.statusText}`);
      }
    } catch (error) {
      console.error("Error updating locker status:", error);
      displayMessage(`Failed to update locker status: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleBoxPickup = async (boxId) => {
    if (!currentLockerData?.id) return;
    setLoading(true);
    displayMessage(`Customer picking up from box ${boxId}...`);
    try {
      const response = await fetch(`${API_BASE_URL}/boxes/${boxId}/pickup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockerId: currentLockerData.id }) // Send lockerId for server logic
      });
      if (response.ok) {
        const result = await response.json();
        displayMessage(result.message);
        fetchLockerData(currentLockerData.id); // Refresh locker info (for fullness)
        fetchBoxData(currentLockerData.id); // Refresh boxes
      } else {
        throw new Error(`Failed to pick up box: ${response.statusText}`);
      }
    } catch (error) {
      console.error("Error updating box status for pickup:", error);
      displayMessage(`Failed to update box status: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Simulate server adding a new parcel
  const simulateServerAddParcel = async () => {
    if (!currentLockerData?.id) return;
    setLoading(true);
    displayMessage("Simulating server adding new parcel...");
    try {
      const response = await fetch(`${API_BASE_URL}/lockers/${currentLockerData.id}/add-parcel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        const result = await response.json();
        displayMessage(result.message);
        fetchLockerData(currentLockerData.id); // Refresh locker info (for fullness)
        fetchBoxData(currentLockerData.id); // Refresh boxes
      } else {
        throw new Error(`Failed to simulate add parcel: ${response.statusText}`);
      }
    } catch (error) {
      console.error("Error simulating server add parcel:", error);
      displayMessage(`Failed to simulate server add parcel: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Function to initialize default boxes if none exist
  const initializeBoxes = async () => {
    if (!currentLockerData?.id) return;
    setLoading(true);
    displayMessage("Checking for default boxes...");
    try {
      const response = await fetch(`${API_BASE_URL}/lockers/${currentLockerData.id}/initialize-boxes`, {
        method: 'POST',
      });
      if (response.ok) {
        const result = await response.json();
        displayMessage(result.message);
        fetchLockerData(currentLockerData.id); // Refresh locker info (for fullness)
        fetchBoxData(currentLockerData.id); // Refresh boxes
      } else {
        throw new Error(`Failed to initialize boxes: ${response.statusText}`);
      }
    } catch (error) {
      console.error("Error initializing default boxes:", error);
      displayMessage(`Failed to initialize default boxes: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white font-inter p-6 flex flex-col items-center">
      <div className="bg-white bg-opacity-20 backdrop-filter backdrop-blur-lg rounded-xl shadow-2xl p-8 max-w-4xl w-full">
        <h1 className="text-4xl font-bold text-center mb-6 text-white drop-shadow-lg">Locker Client System</h1>

        <div className="mb-6">
          <label htmlFor="lockerIdInput" className="block text-lg font-semibold mb-2">Enter Locker ID:</label>
          <div className="flex gap-2">
            <input
              id="lockerIdInput"
              type="text"
              value={lockerId}
              onChange={(e) => setLockerId(e.target.value.toUpperCase())} // Convert to uppercase for consistency
              placeholder="e.g., LOCKER001"
              className="flex-grow p-3 rounded-lg bg-gray-700 bg-opacity-50 border border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-400 text-white placeholder-gray-300"
            />
            <button
              onClick={handleLoadOrCreateLocker}
              disabled={!lockerId || loading}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg shadow-md text-white font-semibold transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Load/Create Locker
            </button>
          </div>
        </div>

        {message && (
          <p className="text-center text-md mb-4 p-2 rounded-md bg-white bg-opacity-10">{message}</p>
        )}

        {loading && (
          <div className="flex justify-center items-center py-4">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white"></div>
            <p className="ml-3 text-lg">Loading...</p>
          </div>
        )}

        {currentLockerData && (
          <div className="mt-8">
            <h2 className="text-3xl font-bold mb-5 text-white drop-shadow-lg text-center">Locker Information (ID: {currentLockerData.id})</h2>
            <div className="grid md:grid-cols-2 gap-4 mb-6 bg-white bg-opacity-10 rounded-xl p-6">
              <div className="flex items-center text-lg"><span className="font-semibold w-32">Status:</span> <span className={`font-bold ${currentLockerData.status === 'available' ? 'text-green-300' : currentLockerData.status === 'maintenance' ? 'text-yellow-300' : 'text-red-300'}`}>{currentLockerData.status.toUpperCase()}</span></div>
              <div className="flex items-center text-lg"><span className="font-semibold w-32">Fullness:</span> {currentLockerData.fullness}</div>
              <div className="flex items-center text-lg"><span className="font-semibold w-32">Coordinates:</span> {currentLockerData.coordinates || 'N/A'}</div>
              <div className="flex items-center text-lg"><span className="font-semibold w-32">Business:</span> {currentLockerData.business || 'N/A'}</div>
              <div className="flex items-center text-lg"><span className="font-semibold w-32">Availability:</span> {currentLockerData.availability || 'N/A'}</div>
            </div>

            <div className="flex flex-wrap justify-center gap-4 mb-8">
              <button
                onClick={() => handleLockerStatusChange('available')}
                className="px-5 py-2 bg-green-500 hover:bg-green-600 rounded-lg shadow-md text-white font-semibold transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={loading || currentLockerData.status === 'available'}
              >
                Set Available
              </button>
              <button
                onClick={() => handleLockerStatusChange('maintenance')}
                className="px-5 py-2 bg-yellow-500 hover:bg-yellow-600 rounded-lg shadow-md text-white font-semibold transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={loading || currentLockerData.status === 'maintenance'}
              >
                Set Maintenance
              </button>
              <button
                onClick={() => handleLockerStatusChange('inactive')}
                className="px-5 py-2 bg-red-500 hover:bg-red-600 rounded-lg shadow-md text-white font-semibold transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={loading || currentLockerData.status === 'inactive'}
              >
                Set Inactive
              </button>
              <button
                onClick={simulateServerAddParcel}
                className="px-5 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg shadow-md text-white font-semibold transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={loading}
              >
                Simulate Server Add Parcel
              </button>
              <button
                onClick={initializeBoxes}
                className="px-5 py-2 bg-indigo-500 hover:bg-indigo-600 rounded-lg shadow-md text-white font-semibold transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={loading}
              >
                Initialize Default Boxes
              </button>
            </div>

            <h2 className="text-3xl font-bold mb-5 text-white drop-shadow-lg text-center">Boxes in Locker</h2>
            {boxData.length === 0 ? (
              <p className="text-center text-lg text-gray-200">No boxes found in this locker. Try initializing default boxes.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {boxData.map((box) => (
                  <div key={box.id} className="bg-white bg-opacity-15 rounded-xl shadow-lg p-5 flex flex-col justify-between">
                    <div>
                      <h3 className="text-xl font-bold mb-3 text-purple-200">Box ID: {box.id}</h3>
                      <p className="text-lg mb-1">Status: <span className={`font-bold ${box.status === 'empty' ? 'text-green-300' : 'text-orange-300'}`}>{box.status.toUpperCase()}</span></p>
                      <p className="text-md mb-1">Dimensions: {box.dimensions || 'N/A'}</p>
                      <p className="text-md mb-1">Availability: {box.availability_start_day || 'N/A'} to {box.availability_end_day || 'N/A'}</p>
                      {box.parcel_customer_name && box.status === 'occupied' && (
                        <div className="mt-3 border-t border-gray-400 pt-3">
                          <p className="text-lg font-semibold text-purple-200">Parcel Info:</p>
                          <p className="text-md mb-1">Customer: {box.parcel_customer_name}</p>
                          <p className="text-md mb-1">Code 1: <span className="font-mono bg-gray-700 bg-opacity-50 rounded px-2 py-1">{box.parcel_verification_code_1}</span></p>
                          <p className="text-md mb-1">Code 2: <span className="font-mono bg-gray-700 bg-opacity-50 rounded px-2 py-1">{box.parcel_verification_code_2}</span></p>
                        </div>
                      )}
                    </div>
                    {box.status === 'occupied' && (
                      <button
                        onClick={() => handleBoxPickup(box.id)}
                        className="mt-4 px-4 py-2 bg-pink-600 hover:bg-pink-700 rounded-lg shadow-md text-white font-semibold transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={loading}
                      >
                        Customer Pick Up
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

