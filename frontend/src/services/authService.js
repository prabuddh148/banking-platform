// api-gateway auth endpoints: POST /api/v1/auth/login, GET /api/v1/auth/me
import { api } from '../lib/api.js'
import { API_V1, USE_MOCK } from '../lib/config.js'
import { demoUsers } from '../data/mockData.js'
import * as mock from './mock/mockStore.js'

// Shown on the login page (same users the gateway is configured with).
export const DEMO_CREDENTIALS = demoUsers.map(({ username, password, user }) => ({
  username,
  password,
  label: user.roles.includes('ROLE_ADMIN') ? 'Admin' : 'Customer',
  name: user.name,
}))

function mapUser(u) {
  return {
    userId: u?.userId,
    username: u?.username,
    name: u?.name || u?.username || 'User',
    email: u?.email,
    roles: Array.isArray(u?.roles) ? u.roles : [],
  }
}

/** -> { token, user, expiresAt } */
export async function login(username, password) {
  const data = USE_MOCK
    ? await mock.login(username, password)
    : await api.post(`${API_V1}/auth/login`, { username, password }, { auth: false })

  const expiresIn = Number(data?.expiresIn) || 3600
  return {
    token: data.accessToken,
    user: mapUser(data.user),
    expiresAt: Date.now() + expiresIn * 1000,
  }
}

export async function me() {
  if (USE_MOCK) return null
  return mapUser(await api.get(`${API_V1}/auth/me`))
}
