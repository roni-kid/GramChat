import axios from "axios";

// Same-origin by default (Vite proxies /api in dev; the backend serves the app in production).
// Set VITE_API_BASE_URL only if the API lives on a different origin.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

export const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});
