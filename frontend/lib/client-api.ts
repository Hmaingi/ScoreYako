export function apiFetch(path: string, init: RequestInit = {}) {
  return fetch(path, {
    ...init,
    credentials: 'same-origin',
  });
}