/**
 * Real-time yuz tekshiruvi uchun Socket.IO ulanishi.
 *
 * Backend'ning mavjud `/ws` gateway'iga access token bilan ulanadi
 * (EventsGateway handshake'da JWT'ni tekshiradi). FaceCheckGateway
 * `face:start` / `face:frame` / `face:result` xabarlarini boshqaradi.
 */
import { io, type Socket } from 'socket.io-client';
import { API_URL, tokenStorage } from './api';

/** API_URL'dan origin (http://host:port) ni ajratadi — /api/v1 siz. */
export function apiOrigin(): string {
  return API_URL.replace(/\/api\/v\d+$/, '');
}

export async function createFaceSocket(): Promise<Socket> {
  const token = await tokenStorage.getAccess();
  return io(apiOrigin(), {
    path: '/ws',
    transports: ['websocket'],
    auth: { token: token ?? '' },
    reconnection: false,
    timeout: 8000,
  });
}
