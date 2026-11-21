// notification-service: /api/v1/notifications
import { api, pageContent } from '../lib/api.js'
import { API_V1, USE_MOCK } from '../lib/config.js'
import { humanize, isAdminUser } from './mappers.js'
import * as mock from './mock/mockStore.js'

const BASE = `${API_V1}/notifications`

// Backend notification "type" (e.g. TRANSACTION_COMPLETED) -> the icon group used by the UI.
function uiType(type = '') {
  const t = String(type).toUpperCase()
  if (t.includes('FRAUD') || t.includes('SECURITY') || t.includes('FAILED') || t.includes('FROZEN')) return 'security'
  if (t.includes('TRANSACTION') || t.includes('TRANSFER') || t.includes('DEPOSIT') || t.includes('WITHDRAW')) return 'transaction'
  if (t.includes('PROMO')) return 'promo'
  return 'account'
}

/**
 * NotificationResponse -> UI notification
 * { id, type, title, message, date, read, channel, status, recipient }
 */
export function mapNotification(dto) {
  return {
    id: dto.id,
    type: uiType(dto.type),
    title: dto.subject || humanize(dto.type) || 'Notification',
    message: dto.message || '',
    date: dto.sentAt || dto.createdAt,
    read: Boolean(dto.readAt || dto.read),
    channel: humanize(dto.channel),
    status: humanize(dto.status),
    recipient: dto.recipient,
  }
}

export async function listMyNotifications(user) {
  if (USE_MOCK) return mock.listNotifications()
  // Admins see everyone's notifications by default; scope to their own inbox.
  const query = { page: 0, size: 100 }
  if (isAdminUser(user)) query.recipientId = user.userId
  const page = await api.get(BASE, { query })
  return pageContent(page)
    .map(mapNotification)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
}

export async function markNotificationRead(id) {
  if (USE_MOCK) return mock.markNotificationRead(id)
  return api.patch(`${BASE}/${id}/read`)
}
