/**
 * AppZeto JS Bridge Helper
 * This script should be included in your React application (MERN frontend).
 * It enables bidirectional communication between the React web app and the
 * Flutter native wrapper via the WebView JavaScript channel.
 */

const AppZetoBridge = {
  /**
   * Check if the app is running inside the Flutter WebView
   * @returns {boolean}
   */
  isFlutterApp: () => {
    return !!window.Flutter;
  },

  /**
   * Send a message to Flutter
   * @param {string} action - Action name (open_camera, get_location, pick_file, get_fcm_token)
   */
  send: (action) => {
    if (window.Flutter) {
      window.Flutter.postMessage(action);
    } else {
      console.warn("Flutter context not found. Are you running inside the Flutter app?");
    }
  },

  /**
   * Listen for responses from Flutter
   * @param {Function} callback - Function to handle the response
   */
  onResponse: (callback) => {
    window.onFlutterResponse = (response) => {
      // response format: { type: "camera_response", data: "base64..." }
      callback(response);
    };
  },

  /**
   * Request FCM Token from Flutter and return it as a Promise
   * @returns {Promise<string|null>}
   */
  getFcmToken: () => {
    return new Promise((resolve) => {
      if (!window.Flutter) {
        resolve(null);
        return;
      }

      // One-time listener for the token response
      const originalOnResponse = window.onFlutterResponse;
      window.onFlutterResponse = (response) => {
        if (response.type === 'fcm_token_response') {
          // Restore original listener if it existed
          window.onFlutterResponse = originalOnResponse;
          resolve(response.data);
        } else if (originalOnResponse) {
          // Pass other messages to the original listener
          originalOnResponse(response);
        }
      };

      window.Flutter.postMessage("get_fcm_token");
      
      // Timeout after 10 seconds
      setTimeout(() => {
        if (window.onFlutterResponse !== originalOnResponse) {
          window.onFlutterResponse = originalOnResponse;
          resolve(null);
        }
      }, 10000);
    });
  },

  /**
   * Request Location from Flutter and return it as a Promise
   * @returns {Promise<{lat: number, lng: number}|null>}
   */
  getLocation: () => {
    return new Promise((resolve) => {
      if (!window.Flutter) {
        resolve(null);
        return;
      }

      const originalOnResponse = window.onFlutterResponse;
      window.onFlutterResponse = (response) => {
        if (response.type === 'location_response') {
          window.onFlutterResponse = originalOnResponse;
          resolve(response.data);
        } else if (originalOnResponse) {
          originalOnResponse(response);
        }
      };

      window.Flutter.postMessage("get_location");
      
      setTimeout(() => {
        if (window.onFlutterResponse !== originalOnResponse) {
          window.onFlutterResponse = originalOnResponse;
          resolve(null);
        }
      }, 15000); // Higher timeout for GPS
    });
  }
};

// --- Example Usage in React Component ---

/*
import React, { useEffect, useState } from 'react';

const MyComponent = () => {
  const [image, setImage] = useState(null);

  useEffect(() => {
    AppZetoBridge.onResponse((res) => {
      if (res.type === 'camera_response' && res.data) {
        setImage(`data:image/jpeg;base64,${res.data}`);
      }
      if (res.type === 'location_response') {
        console.log("Current Location:", res.data);
      }
      if (res.type === 'fcm_token_response') {
        console.log("FCM Token:", res.data);
        // Send this token to your backend API to save it for push notifications
      }
    });
  }, []);

  const handleCapture = () => {
    AppZetoBridge.send("open_camera");
  };

  const handleGetLocation = () => {
    AppZetoBridge.send("get_location");
  };

  return (
    <div>
      <button onClick={handleCapture}>Open Camera</button>
      <button onClick={handleGetLocation}>Get Location</button>
      {image && <img src={image} alt="Captured" style={{width: '200px'}} />}
    </div>
  );
};
*/

export default AppZetoBridge;
