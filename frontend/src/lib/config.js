// Runtime configuration read from Vite env variables (see .env.example).
//
//  VITE_API_BASE_URL  Where the API gateway lives. Empty (default) = same origin,
//                     which in `npm run dev` is proxied to http://localhost:8080
//                     by vite.config.js.
//  VITE_USE_MOCK      "true" = never call the backend, serve the bundled mock
//                     data instead (handy for UI work without Docker running).

export const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')

export const USE_MOCK = String(import.meta.env.VITE_USE_MOCK || '').toLowerCase() === 'true'

// Currency used whenever the API does not send one (the backend default is INR).
export const DEFAULT_CURRENCY = 'INR'

// Every backend route is versioned under this prefix (served by the api-gateway).
export const API_V1 = '/api/v1'
