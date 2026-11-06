export class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_REJECTED') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function assert(condition, status, message, code) {
  if (!condition) throw new HttpError(status, message, code);
}
export function positiveId(value) {
  const text = String(value ?? '');
  return /^[1-9]\d{0,15}$/.test(text) ? text : null;
}
export function uniqueIds(value, { min = 1, max = 100 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) return null;
  const ids = value.map(positiveId);
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) return null;
  return ids;
}
export const maskImei = imei => {
  const value = String(imei ?? '');
  return value.length <= 5 ? '•••••' : '•••' + value.slice(-5);
};
