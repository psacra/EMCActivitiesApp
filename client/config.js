// Point this at your deployed backend (see server/.env.example PUBLIC_SERVER_URL).
// For local dev with the server running on its default port:
window.EMC_API_BASE = window.EMC_API_BASE || "https://emcactivitiesapp.onrender.com";

// If you set CURATOR_PASSWORD on the server, put the same value here so
// editing/deleting activities from the browser is authorized. Leave blank
// if you didn't set a curator password on the server.
window.EMC_CURATOR_PASSWORD = window.EMC_CURATOR_PASSWORD || "pwd4EMC2026!";
