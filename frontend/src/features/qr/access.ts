// Cổng QR: du khách phải quét một mã QR hợp lệ mới vào được ứng dụng.
// Quyền vào chỉ giữ trong phiên của tab hiện tại (sessionStorage):
// tải lại trang vẫn vào được, còn đóng tab / thoát trình duyệt thì phải quét lại.
const KEY = 'gth-qr-access';

export function hasQrAccess(): boolean {
  try { return window.sessionStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function grantQrAccess() {
  try { window.sessionStorage.setItem(KEY, '1'); } catch { /* storage unavailable */ }
}
