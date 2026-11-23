// The API origin for every request the app makes.
//
// Set EXPO_PUBLIC_API_BASE_URL when running against a local server: a simulator or the web
// build can reach `http://localhost:3000`, a physical phone needs the machine's LAN address
// (`http://192.168.1.20:3000`) because `localhost` there is the phone itself.
const DEFAULT_API_BASE_URL = "http://localhost:3000";

const configured = process.env.EXPO_PUBLIC_API_BASE_URL;

export const API_BASE_URL = (configured && configured.trim() ? configured.trim() : DEFAULT_API_BASE_URL).replace(/\/+$/, "");
