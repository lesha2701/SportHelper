/** Where the backend lives. On a phone "localhost" is the phone itself: set EXPO_PUBLIC_API_URL to http://<computer IP>:8002. */
export const API_BASE_URL: string = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8002").replace(/\/+$/, "");
