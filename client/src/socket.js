import { io } from 'socket.io-client';

export const socket = io();

// Promise wrapper around ack-style emits
export function send(event, data = {}) {
  return new Promise((resolve) => socket.emit(event, data, resolve));
}

export function streetViewUrl(lat, lng) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
}
