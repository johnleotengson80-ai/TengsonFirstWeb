// Same-origin API in deployment; file:// launches use the local Flask default.
const defaultApiOrigin = location.protocol === 'file:' ? 'http://127.0.0.1:5000' : location.origin;
window.API_BASE_URL = window.API_BASE_URL || `${defaultApiOrigin}/api`;
window.assetUrl = function (path) {
  if (!path) return '';
  if (/^data:image\//i.test(path)) return path;
  return new URL(path, location.origin).toString();
};
