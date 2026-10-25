// src/screens/MapScreen.web.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, TextInput, Linking } from 'react-native';
import type { Poi } from '../features/poi/types';
import { useBrowserPois } from '../features/content/web-hooks';
import {
  createGeofenceRuntimeState,
  evaluatePoi,
  isReliableOutsideGeofence,
  processGeofenceUpdate,
} from '../features/geofence';
import { foregroundGeofenceWeb } from '../features/geofence/services/foreground-geofence.web';
import type { WebGeofenceLocation } from '../features/geofence/services/foreground-geofence.web';
import { apiDelete, apiPost } from '../services/apiClient';
import { getDistanceMeters } from '../utils/distance';

type LanguageKey = 'vi' | 'en' | 'zh';
type VietnamRegion = 'north' | 'central' | 'south';
type VisitorStatus = 'idle' | 'loading' | 'inside' | 'exited' | 'deleted' | 'error';
type VisitorResponse = {
  status: 'inside' | 'exited';
  entered_at: string;
  exited_at: string | null;
  exit_method: 'manual' | 'geofence' | null;
  saved_itinerary: { poi_ids: string[] } | null;
};

const VISITOR_ID_KEY = 'visitor_visit_id';
const VISITOR_POI_KEY = 'visitor_poi_id';
const AUTO_EXIT_DEBOUNCE_MS = 10_000;
// Backend (POST /api/visitors/itinerary) chỉ nhận tối đa 20 điểm dừng; vượt quá sẽ bị lỗi 422.
const MAX_ROUTE_STOPS = 20;

function createVisitId() {
  if (typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }

  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function formatVisitTimestamp(value: string | null, language: LanguageKey) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const locale = { vi: 'vi-VN', en: 'en-US', zh: 'zh-CN' }[language];
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatDistance(meters: number) {
  return meters < 1_000 ? `${Math.round(meters)} m` : `${(meters / 1_000).toFixed(1)} km`;
}

type RouteLeg = { poi: Poi; distanceFromPreviousMeters: number | null };

function buildRouteLegs(routePois: Poi[]) {
  let totalMeters = 0;
  const legs: RouteLeg[] = routePois.map((poi, index) => {
    const previous = routePois[index - 1];
    const distanceFromPreviousMeters = previous ? getDistanceMeters(previous, poi) : null;
    if (distanceFromPreviousMeters !== null) totalMeters += distanceFromPreviousMeters;
    return { poi, distanceFromPreviousMeters };
  });
  return { legs, totalMeters };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type RoutePrintLabels = {
  documentTitle: string;
  stopsUnit: string;
  totalDistance: string;
  fromPrevious: string;
  startPoint: string;
  coordinates: string;
  radius: string;
  metersUnit: string;
  note: string;
  printedAt: string;
};

function buildRoutePrintHtml(
  legs: RouteLeg[],
  totalMeters: number,
  language: LanguageKey,
  labels: RoutePrintLabels,
  printedAt: string,
) {
  const items = legs.map(({ poi, distanceFromPreviousMeters }, index) => {
    const name = poi.name?.[language] || poi.name?.vi || poi.id;
    const description = poi.description?.[language] || poi.description?.vi || '';
    const mapUrl = poi.mapUrl && /^https?:\/\//i.test(poi.mapUrl)
      ? poi.mapUrl
      : `https://www.google.com/maps/search/?api=1&query=${poi.latitude},${poi.longitude}`;
    const leg = distanceFromPreviousMeters === null
      ? labels.startPoint
      : `${labels.fromPrevious}: ${formatDistance(distanceFromPreviousMeters)}`;
    return `<li>
      <div class="num">${index + 1}</div>
      <div class="body">
        <h2>${escapeHtml(name)}</h2>
        <p class="desc">${escapeHtml(description)}</p>
        <p class="meta">${escapeHtml(leg)} · ${escapeHtml(labels.coordinates)}: ${poi.latitude}, ${poi.longitude} · ${escapeHtml(labels.radius)}: ${poi.radiusMeters} ${escapeHtml(labels.metersUnit)}</p>
        <p class="link">${escapeHtml(mapUrl)}</p>
      </div>
    </li>`;
  }).join('');

  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(labels.documentTitle)}</title>
<style>
  @page { margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #203548; margin: 0; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #5b6f7d; font-size: 12px; margin: 0 0 18px; }
  ol { list-style: none; margin: 0; padding: 0; }
  li { display: flex; gap: 12px; padding: 12px 0; border-top: 1px solid #d9e4ec; break-inside: avoid; page-break-inside: avoid; }
  .num { flex: none; width: 30px; height: 30px; border-radius: 50%; background: #3d9b62; color: #fff; font-weight: 700; text-align: center; line-height: 30px; }
  h2 { font-size: 15px; margin: 0 0 4px; }
  .desc { font-size: 12px; line-height: 1.5; margin: 0 0 4px; }
  .meta { font-size: 11px; color: #5b6f7d; margin: 0 0 2px; }
  .link { font-size: 10px; color: #5b6f7d; margin: 0; word-break: break-all; }
  .total { margin-top: 14px; padding-top: 12px; border-top: 2px solid #203548; font-size: 13px; font-weight: 700; }
  .note { font-size: 10px; color: #6d7f8b; margin-top: 6px; }
</style>
</head>
<body>
  <h1>${escapeHtml(labels.documentTitle)}</h1>
  <p class="sub">${legs.length} ${escapeHtml(labels.stopsUnit)} · ${escapeHtml(labels.printedAt)}: ${escapeHtml(printedAt)}</p>
  <ol>${items}</ol>
  <p class="total">${escapeHtml(labels.totalDistance)}: ${formatDistance(totalMeters)}</p>
  <p class="note">${escapeHtml(labels.note)}</p>
</body>
</html>`;
}

// In bằng iframe ẩn để không bị trình duyệt chặn popup.
function printRouteDocument(html: string) {
  if (typeof document === 'undefined') return false;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);

  const frameWindow = frame.contentWindow;
  const frameDocument = frame.contentDocument;
  if (!frameWindow || !frameDocument) {
    frame.remove();
    return false;
  }

  const cleanup = () => {
    if (frame.parentNode) frame.parentNode.removeChild(frame);
  };

  frameDocument.open();
  frameDocument.write(html);
  frameDocument.close();
  // Gắn listener SAU document.open(): lệnh này xóa mọi listener đã gắn trên cửa sổ của iframe.
  frameWindow.addEventListener('afterprint', () => window.setTimeout(cleanup, 500));
  window.setTimeout(cleanup, 120_000);
  window.setTimeout(() => {
    try {
      frameWindow.focus();
      frameWindow.print();
    } catch {
      cleanup();
    }
  }, 200);
  return true;
}

function getVietnamRegion(latitude: number): VietnamRegion {
  if (latitude >= 18) return 'north';
  if (latitude <= 13.5) return 'south';
  return 'central';
}

// Từ điển đa ngôn ngữ hoàn chỉnh cho toàn bộ giao diện
const uiText = {
  vi: {
    searchPlaceholder: 'Tìm kiếm di tích, địa điểm...',
    poiListTitle: '🏛️ Danh Sách Điểm Đến',
    coordLabel: '📍 Tọa độ',
    radiusLabel: '🎯 Bán kính Geofence',
    radiusBadge: 'Bán kính',
    priorityBadge: 'Ưu tiên',
    metersUnit: 'mét',
    ttsTitle: '🗣️ Kịch bản Thuyết minh',
    listen: '🔊 Nghe âm thanh',
    stop: '⏹️ Dừng đọc',
    openMap: '🌐 Mở trên Google Maps',
    selectPrompt: '📍 Vui lòng chọn một địa điểm ở danh sách bên trái',
    qrTitle: '📲 Quét QR để ghi nhận lượt tham quan',
    qrDescription: 'Quét mã để ghi nhận lượt tham quan. Bạn có thể tự bấm kết thúc hoặc chủ động bật GPS để tự kết thúc khi ra khỏi bán kính.',
    visitorTitle: 'Ghi nhận lượt tham quan',
    visitorCheckIn: 'Đang ghi nhận lượt vào...',
    visitorCheckInFailed: 'Không thể ghi nhận lượt vào.',
    visitorExit: 'Rời điểm tham quan',
    visitorExitProgress: 'Đang ghi nhận lượt ra...',
    visitorExitSuccess: 'Đã ghi nhận thời gian rời điểm tham quan.',
    visitorRetry: 'Thử lại',
    visitRecordTitle: 'LỊCH SỬ LƯỢT THAM QUAN',
    visitReference: 'Mã lượt',
    checkInRecord: 'Đã quét vào',
    checkOutRecord: 'Đã kết thúc và rời địa điểm',
    recordPending: 'Chưa ghi nhận',
    recordActive: 'Đang tham quan',
    recordComplete: 'Đã kết thúc',
    startNewVisit: 'Bắt đầu lượt tham quan mới',
    deleteVisit: 'Xóa dữ liệu lượt này',
    deletingVisit: 'Đang xóa dữ liệu...',
    deleteVisitConfirm: 'Xóa vĩnh viễn lượt tham quan và lộ trình đã lưu?',
    visitDeleted: 'Dữ liệu lượt tham quan đã được xóa.',
    deleteVisitFailed: 'Không thể xóa dữ liệu lượt tham quan. Vui lòng thử lại.',
    enableAutoExit: 'Bật tự kết thúc bằng GPS',
    disableAutoExit: 'Tắt tự kết thúc bằng GPS',
    autoExitHelp: 'Tùy chọn: cho phép trình duyệt kiểm tra vị trí trên thiết bị này. Khi ra ngoài bán kính điểm tham quan đủ lâu, lượt sẽ tự kết thúc. Tọa độ không gửi lên máy chủ; cần mở trang và bật GPS. Bạn vẫn có thể kết thúc thủ công.',
    exitedByGeofence: 'Tự kết thúc khi ra khỏi vùng',
    exitedManually: 'Kết thúc thủ công',
    autoExitPermissionError: 'Không thể bật GPS. Hãy cấp quyền vị trí và dùng HTTPS hoặc localhost.',
    enableLocation: 'Bật GPS',
    disableLocation: 'Tắt GPS',
    locationPermissionError: 'Không thể lấy vị trí. Hãy cấp quyền vị trí và dùng HTTPS hoặc localhost.',
    geofenceArrival: 'Bạn đang ở gần điểm tham quan',
    geofenceDistance: 'Khoảng cách',
    visitorInvalidQr: 'Mã QR không hợp lệ hoặc không có địa điểm tham quan.',
    brand: 'GO TO HORIZON',
    webTitle: 'Chạm vào di sản Việt Nam',
    webSubtitle: 'Khám phá những điểm đến nổi bật và nghe câu chuyện phía sau mỗi địa danh.',
    locationLabel: 'ĐIỂM ĐẾN',
    detailsLabel: 'THÔNG TIN ĐIỂM ĐẾN',
    routeTitle: 'Lộ trình của bạn',
    routeButton: 'Lộ trình',
    routeHelp: 'Chọn các điểm muốn ghé. Thứ tự bạn thêm sẽ là thứ tự hành trình.',
    chooseRoute: 'Chọn lộ trình',
    closeRoutePicker: 'Đóng chọn lộ trình',
    confirmRoute: 'Xác nhận lộ trình',
    routeEmpty: 'Chưa chọn điểm dừng nào.',
    regions: { north: 'Miền Bắc', central: 'Miền Trung', south: 'Miền Nam' },
    addRegion: 'Thêm vùng',
    removeRegion: 'Bỏ vùng',
    regionHelp: 'Chọn các vùng theo thứ tự muốn đi. Các điểm tham quan trong vùng sẽ được thêm theo thứ tự đó.',
    routeControlsLocked: 'Các nút chọn và xóa lộ trình sẽ dùng được sau khi lượt tham quan được ghi nhận.',
    routeCanEditBeforeCheckIn: 'Chọn vùng và điểm trước, lượt tham quan và lộ trình sẽ được ghi nhận khi bạn xác nhận.',
    clearRoute: 'Xóa toàn bộ lộ trình',
    clearRouteConfirm: 'Xóa toàn bộ lộ trình này, bao gồm bản đã lưu?',
    clearingRoute: 'Đang xóa lộ trình...',
    clearRouteFailed: 'Không thể xóa lộ trình. Vui lòng thử lại.',
    addStop: 'Thêm vào lộ trình',
    removeStop: 'Bỏ khỏi lộ trình',
    moveUp: 'Lên',
    moveDown: 'Xuống',
    saveRoute: 'Lưu lộ trình',
    savingRoute: 'Đang lưu lộ trình...',
    routeSaved: 'Đã lưu lộ trình vào hồ sơ lượt tham quan.',
    routeSaveFailed: 'Không thể lưu lộ trình. Vui lòng thử lại.',
    printRoute: '🖨 In lộ trình',
    routeResultTitle: 'Lộ trình đã chọn',
    routeDraftNote: 'Bản nháp — chưa lưu vào lượt tham quan.',
    editRoute: 'Chỉnh sửa lộ trình',
    closeDialog: 'Đóng',
    routeLimitReached: 'Lộ trình tối đa 20 điểm dừng.',
    totalDistance: 'Tổng quãng đường',
    fromPrevious: 'Cách điểm trước',
    startPoint: 'Điểm xuất phát',
    straightLineNote: 'Khoảng cách tính theo đường chim bay, chỉ mang tính tham khảo.',
    printUnavailable: 'Không mở được hộp thoại in. Vui lòng kiểm tra trình duyệt.',
    printDocumentTitle: 'Lộ trình tham quan',
    printedAt: 'In lúc',
    stopsUnit: 'điểm dừng',
    visitStarted: 'Lượt tham quan đang hoạt động',
    exploreTitle: 'Khám phá các điểm đến',
    destinationFilter: 'Tìm điểm tham quan trong danh sách...',
    destinationDetails: 'Điểm bạn đang xem',
    noDestinationsFound: 'Không tìm thấy điểm đến phù hợp.',
    directions: 'Chỉ đường',
  },
  en: {
    searchPlaceholder: 'Search locations...',
    poiListTitle: '🏛️ Destinations',
    coordLabel: '📍 Coordinates',
    radiusLabel: '🎯 Geofence Radius',
    radiusBadge: 'Radius',
    priorityBadge: 'Priority',
    metersUnit: 'meters',
    ttsTitle: '🗣️ Narration Script',
    listen: '🔊 Listen Audio',
    stop: '⏹️ Stop',
    openMap: '🌐 Open on Google Maps',
    selectPrompt: '📍 Please select a location from the left list',
    qrTitle: '📲 Scan to record your visit',
    qrDescription: 'Scan to record your visit. Check out manually, or opt in to GPS auto checkout when you leave the radius.',
    visitorTitle: 'Visitor check-in',
    visitorCheckIn: 'Recording your arrival...',
    visitorCheckInFailed: 'Could not record your arrival.',
    visitorExit: 'Leave this location',
    visitorExitProgress: 'Recording your departure...',
    visitorExitSuccess: 'Your departure time has been recorded.',
    visitorRetry: 'Try again',
    visitRecordTitle: 'VISIT RECORD',
    visitReference: 'Visit ID',
    checkInRecord: 'Arrival recorded',
    checkOutRecord: 'Visit ended / departure recorded',
    recordPending: 'Not recorded',
    recordActive: 'Visit in progress',
    recordComplete: 'Visit completed',
    startNewVisit: 'Start a new visit',
    deleteVisit: 'Delete this visit data',
    deletingVisit: 'Deleting data...',
    deleteVisitConfirm: 'Permanently delete this visit and its saved itinerary?',
    visitDeleted: 'Visit data has been deleted.',
    deleteVisitFailed: 'Could not delete visit data. Please try again.',
    enableAutoExit: 'Enable GPS auto checkout',
    disableAutoExit: 'Turn off GPS auto checkout',
    autoExitHelp: 'Optional: allow this browser to check location on this device. The visit ends after you remain outside the destination radius. Coordinates are not sent to the server; keep this page open and GPS enabled. You can still check out manually.',
    exitedByGeofence: 'Automatically ended outside the geofence',
    exitedManually: 'Ended manually',
    autoExitPermissionError: 'Could not enable GPS. Grant location access and use HTTPS or localhost.',
    enableLocation: 'Enable GPS',
    disableLocation: 'Turn GPS off',
    locationPermissionError: 'Could not access location. Grant permission and use HTTPS or localhost.',
    geofenceArrival: 'You are near a destination',
    geofenceDistance: 'Distance',
    visitorInvalidQr: 'This QR code is invalid or does not identify a location.',
    brand: 'GO TO HORIZON',
    webTitle: 'Discover Vietnam’s heritage',
    webSubtitle: 'Explore remarkable places and hear the stories behind each destination.',
    locationLabel: 'DESTINATIONS',
    detailsLabel: 'DESTINATION DETAILS',
    routeTitle: 'Your itinerary',
    routeButton: 'Itinerary',
    routeHelp: 'Choose places to visit. The order you add them becomes your route.',
    chooseRoute: 'Choose an itinerary',
    closeRoutePicker: 'Close itinerary selection',
    confirmRoute: 'Confirm itinerary',
    routeEmpty: 'No stops selected yet.',
    regions: { north: 'Northern Vietnam', central: 'Central Vietnam', south: 'Southern Vietnam' },
    addRegion: 'Add region',
    removeRegion: 'Remove region',
    regionHelp: 'Choose regions in the order you plan to visit. Their destinations will be added in that order.',
    routeControlsLocked: 'Itinerary controls become available after your visit is recorded.',
    routeCanEditBeforeCheckIn: 'Choose regions and destinations first; your visit and itinerary will be recorded when you confirm.',
    clearRoute: 'Clear entire itinerary',
    clearRouteConfirm: 'Clear this entire itinerary, including the saved version?',
    clearingRoute: 'Clearing itinerary...',
    clearRouteFailed: 'Could not clear the itinerary. Please try again.',
    addStop: 'Add to itinerary',
    removeStop: 'Remove from itinerary',
    moveUp: 'Up',
    moveDown: 'Down',
    saveRoute: 'Save itinerary',
    savingRoute: 'Saving itinerary...',
    routeSaved: 'Your itinerary has been saved to this visit.',
    routeSaveFailed: 'Could not save the itinerary. Please try again.',
    printRoute: '🖨 Print itinerary',
    routeResultTitle: 'Selected itinerary',
    routeDraftNote: 'Draft — not saved to your visit yet.',
    editRoute: 'Edit itinerary',
    closeDialog: 'Close',
    routeLimitReached: 'An itinerary can have at most 20 stops.',
    totalDistance: 'Total distance',
    fromPrevious: 'From previous stop',
    startPoint: 'Starting point',
    straightLineNote: 'Distances are straight-line estimates for reference only.',
    printUnavailable: 'Could not open the print dialog. Please check your browser.',
    printDocumentTitle: 'Sightseeing itinerary',
    printedAt: 'Printed',
    stopsUnit: 'stops',
    visitStarted: 'Your visit is active',
    exploreTitle: 'Explore destinations',
    destinationFilter: 'Search destinations...',
    destinationDetails: 'Currently viewing',
    noDestinationsFound: 'No destinations match your search.',
    directions: 'Directions',
  },
  zh: {
    searchPlaceholder: '搜索地点...',
    poiListTitle: '🏛️ 景点列表',
    coordLabel: '📍 坐标',
    radiusLabel: '🎯 围栏半径',
    radiusBadge: '半径',
    priorityBadge: '优先级别',
    metersUnit: '米',
    ttsTitle: '🗣️ 语音讲解脚本',
    listen: '🔊 听语音',
    stop: '⏹️ 停止',
    openMap: '🌐 在谷歌地图中打开',
    selectPrompt: '📍 请从左侧列表中选择一个地点',
    qrTitle: '📲 扫码记录参观',
    qrDescription: '扫码记录参观。您可以手动结束，也可以主动开启 GPS，在离开景点范围后自动结束。',
    visitorTitle: '访客签到',
    visitorCheckIn: '正在记录到达时间...',
    visitorCheckInFailed: '无法记录到达时间。',
    visitorExit: '离开此地点',
    visitorExitProgress: '正在记录离开时间...',
    visitorExitSuccess: '已记录离开时间。',
    visitorRetry: '重试',
    visitRecordTitle: '参观记录',
    visitReference: '记录编号',
    checkInRecord: '已记录到达',
    checkOutRecord: '参观结束 / 已记录离开',
    recordPending: '尚未记录',
    recordActive: '参观进行中',
    recordComplete: '参观已结束',
    startNewVisit: '开始新的参观',
    deleteVisit: '删除本次参观数据',
    deletingVisit: '正在删除数据...',
    deleteVisitConfirm: '永久删除本次参观记录及已保存的行程？',
    visitDeleted: '参观数据已删除。',
    deleteVisitFailed: '无法删除参观数据，请重试。',
    enableAutoExit: '开启 GPS 自动结束',
    disableAutoExit: '关闭 GPS 自动结束',
    autoExitHelp: '可选：允许浏览器在此设备上检查位置。持续离开景点范围后将自动结束参观。坐标不会发送到服务器；请保持页面打开并开启 GPS。您也可以手动结束。',
    exitedByGeofence: '离开围栏后自动结束',
    exitedManually: '手动结束',
    autoExitPermissionError: '无法开启 GPS。请授予位置权限并使用 HTTPS 或 localhost。',
    enableLocation: '开启 GPS',
    disableLocation: '关闭 GPS',
    locationPermissionError: '无法获取位置，请授予位置权限并使用 HTTPS 或 localhost。',
    geofenceArrival: '您已接近景点',
    geofenceDistance: '距离',
    visitorInvalidQr: '二维码无效或未指定参观点。',
    brand: 'GO TO HORIZON',
    webTitle: '探索越南文化遗产',
    webSubtitle: '探索特色景点，聆听每个目的地背后的故事。',
    locationLabel: '目的地',
    detailsLabel: '目的地详情',
    routeTitle: '您的行程',
    routeButton: '行程',
    routeHelp: '选择要游览的地点，添加顺序就是行程顺序。',
    chooseRoute: '选择行程',
    closeRoutePicker: '关闭行程选择',
    confirmRoute: '确认行程',
    routeEmpty: '尚未选择地点。',
    regions: { north: '越南北部', central: '越南中部', south: '越南南部' },
    addRegion: '添加地区',
    removeRegion: '移除地区',
    regionHelp: '按计划游览的顺序选择地区，景点会按此顺序加入行程。',
    routeControlsLocked: '参观记录完成后即可使用行程选择和删除按钮。',
    routeCanEditBeforeCheckIn: '可先选择地区和景点；确认行程时系统会记录本次参观和行程。',
    clearRoute: '清空整个行程',
    clearRouteConfirm: '清空整个行程，包括已保存的版本？',
    clearingRoute: '正在清空行程...',
    clearRouteFailed: '无法清空行程，请重试。',
    addStop: '加入行程',
    removeStop: '移出行程',
    moveUp: '上移',
    moveDown: '下移',
    saveRoute: '保存行程',
    savingRoute: '正在保存行程...',
    routeSaved: '行程已保存至本次参观记录。',
    routeSaveFailed: '无法保存行程，请重试。',
    printRoute: '🖨 打印行程',
    routeResultTitle: '已选行程',
    routeDraftNote: '草稿——尚未保存至本次参观记录。',
    editRoute: '编辑行程',
    closeDialog: '关闭',
    routeLimitReached: '行程最多包含 20 个景点。',
    totalDistance: '总距离',
    fromPrevious: '距上一站',
    startPoint: '起点',
    straightLineNote: '距离为直线距离，仅供参考。',
    printUnavailable: '无法打开打印对话框，请检查浏览器。',
    printDocumentTitle: '游览行程',
    printedAt: '打印时间',
    stopsUnit: '个景点',
    visitStarted: '参观记录已开启',
    exploreTitle: '探索景点',
    destinationFilter: '搜索景点...',
    destinationDetails: '当前查看',
    noDestinationsFound: '没有找到符合条件的景点。',
    directions: '导航',
  },
};

export default function MapScreenWeb() {
  const { pois, isLoading: isContentLoading } = useBrowserPois();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPoi, setSelectedPoi] = useState<Poi | null>(null);
  const [currentLang, setCurrentLang] = useState<LanguageKey>('vi');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLocationTracking, setIsLocationTracking] = useState(false);
  const [location, setLocation] = useState<WebGeofenceLocation | null>(null);
  const [locationError, setLocationError] = useState('');
  const [geofenceArrivalPoiId, setGeofenceArrivalPoiId] = useState<string | null>(null);
  const geofenceState = useRef(createGeofenceRuntimeState());
  const announceRef = useRef<(text?: string) => void>(() => undefined);
  const [visitorStatus, setVisitorStatus] = useState<VisitorStatus>('idle');
  const [visitorVisitId, setVisitorVisitId] = useState<string | null>(null);
  const [visitorEnteredAt, setVisitorEnteredAt] = useState<string | null>(null);
  const [visitorExitedAt, setVisitorExitedAt] = useState<string | null>(null);
  const [visitorExitMethod, setVisitorExitMethod] = useState<VisitorResponse['exit_method']>(null);
  const [visitorError, setVisitorError] = useState('');
  const [visitorRetryAction, setVisitorRetryAction] = useState<'check-in' | 'check-out'>('check-in');
  const [isAutoCheckoutEnabled, setIsAutoCheckoutEnabled] = useState(false);
  const autoCheckoutOutsideSince = useRef<number | null>(null);
  const autoCheckoutOutsideSamples = useRef(0);
  const autoCheckoutPending = useRef(false);
  const [routePoiIds, setRoutePoiIds] = useState<string[]>([]);
  const [isRoutePickerOpen, setIsRoutePickerOpen] = useState(false);
  const [routeSaved, setRouteSaved] = useState(false);
  const [isSavingRoute, setIsSavingRoute] = useState(false);
  const [isClearingRoute, setIsClearingRoute] = useState(false);
  const [isDeletingVisit, setIsDeletingVisit] = useState(false);
  const [isRouteResultOpen, setIsRouteResultOpen] = useState(false);

  const visitorParams = typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search);
  const visitorMode = visitorParams?.get('visit') === '1';
  const visitorPoiId = visitorParams?.get('poi') ?? null;
  const visitorPoi = pois.find(poi => poi.id === visitorPoiId) ?? null;
  const geofenceArrivalPoi = pois.find((poi) => poi.id === geofenceArrivalPoiId) ?? null;
  // Chỉ giữ các điểm còn tồn tại trong danh sách POI hiện tại (tránh id cũ làm sai số liệu).
  const routePois = routePoiIds
    .map((poiId) => pois.find((poi) => poi.id === poiId))
    .filter((poi): poi is Poi => Boolean(poi));
  const routeSummary = buildRouteLegs(routePois);

  const t = uiText[currentLang];

  // Dừng âm thanh khi chuyển trang hoặc unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    if (!pois.length) return;
    setSelectedPoi((current) =>
      current && pois.some((poi) => poi.id === current.id)
        ? current
        : pois.find((poi) => poi.id === visitorPoiId) ?? pois[0] ?? null,
    );
  }, [pois, visitorPoiId]);

  useEffect(() => {
    const shouldTrackLocation =
      isLocationTracking ||
      (visitorMode && visitorStatus === 'inside' && isAutoCheckoutEnabled);
    if (!shouldTrackLocation) {
      geofenceState.current = createGeofenceRuntimeState();
      return;
    }

    const watchId = foregroundGeofenceWeb.startTracking(
      (nextLocation) => {
        setLocation(nextLocation);
        if (
          !visitorMode ||
          visitorStatus !== 'inside' ||
          !visitorPoi ||
          !visitorVisitId ||
          !isAutoCheckoutEnabled
        ) return;

        const now = Date.now();
        if (!isReliableOutsideGeofence(nextLocation, visitorPoi, now)) {
          autoCheckoutOutsideSince.current = null;
          autoCheckoutOutsideSamples.current = 0;
          return;
        }

        if (autoCheckoutOutsideSince.current === null) {
          autoCheckoutOutsideSince.current = now;
          autoCheckoutOutsideSamples.current = 1;
          return;
        }

        autoCheckoutOutsideSamples.current += 1;
        if (
          autoCheckoutPending.current ||
          autoCheckoutOutsideSamples.current < 3 ||
          now - autoCheckoutOutsideSince.current < AUTO_EXIT_DEBOUNCE_MS
        ) return;

        autoCheckoutPending.current = true;
        setVisitorRetryAction('check-out');
        setVisitorStatus('loading');
        setVisitorError('');
        void apiPost<VisitorResponse>('/api/visitors/check-out', {
          visit_id: visitorVisitId,
          exit_method: 'geofence',
        }).then((visit) => {
          setVisitorEnteredAt(visit.entered_at);
          setVisitorExitedAt(visit.exited_at);
          setVisitorExitMethod(visit.exit_method);
          setVisitorStatus(visit.status);
          setIsAutoCheckoutEnabled(false);
        }).catch((error: unknown) => {
          setVisitorError(error instanceof Error ? error.message : t.visitorCheckInFailed);
          setVisitorStatus('error');
        }).finally(() => {
          autoCheckoutPending.current = false;
        });
      },
      (error) => {
        setLocationError(error.message);
        setVisitorError(error.message);
        if (isAutoCheckoutEnabled) setIsAutoCheckoutEnabled(false);
        if (isLocationTracking) setIsLocationTracking(false);
      },
    );

    if (watchId === null) {
      if (isAutoCheckoutEnabled) {
        setVisitorError(t.autoExitPermissionError);
        setIsAutoCheckoutEnabled(false);
      }
      if (isLocationTracking) {
        setLocationError(t.locationPermissionError);
        setIsLocationTracking(false);
      }
    } else {
      setLocationError('');
    }

    return () => foregroundGeofenceWeb.stopTracking();
  }, [
    isLocationTracking,
    isAutoCheckoutEnabled,
    visitorMode,
    visitorStatus,
    visitorPoi,
    visitorVisitId,
    t.autoExitPermissionError,
    t.locationPermissionError,
    t.visitorCheckInFailed,
  ]);

  useEffect(() => {
    if (!visitorMode) return;

    if (isContentLoading) return;

    const visitPoi = pois.find(poi => poi.id === visitorPoiId) ?? null;
    if (!visitPoi) {
      setVisitorStatus('error');
      setVisitorError(t.visitorInvalidQr);
      return;
    }

    let cancelled = false;
    void (async () => {
      setVisitorStatus('loading');
      setVisitorError('');
      try {
        const storedVisitId = window.sessionStorage.getItem(VISITOR_ID_KEY);
        const storedPoiId = window.sessionStorage.getItem(VISITOR_POI_KEY);
        const visitId =
          storedVisitId && storedPoiId === visitPoi.id &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storedVisitId)
            ? storedVisitId
          : createVisitId();

        window.sessionStorage.setItem(VISITOR_ID_KEY, visitId);
        window.sessionStorage.setItem(VISITOR_POI_KEY, visitPoi.id);
        setVisitorVisitId(visitId);

        const visit = await apiPost<VisitorResponse>('/api/visitors/check-in', {
          visit_id: visitId,
          poi_id: visitPoi.id,
        });
        if (!cancelled) {
          setVisitorEnteredAt(visit.entered_at);
          setVisitorExitedAt(visit.exited_at);
          setVisitorExitMethod(visit.exit_method);
          if (visit.saved_itinerary) {
            setRoutePoiIds(visit.saved_itinerary.poi_ids);
            setRouteSaved(true);
          }
          if (visit.status === 'exited') {
            setVisitorStatus('exited');
          } else {
            setVisitorStatus('inside');
          }
        }
      } catch (error) {
        if (!cancelled) {
          setVisitorRetryAction('check-in');
          setVisitorError(error instanceof Error ? error.message : t.visitorCheckInFailed);
          setVisitorStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visitorMode, visitorPoiId, isContentLoading, pois, t.visitorCheckInFailed, t.visitorInvalidQr]);

  const handleVisitorAction = async (action: 'check-in' | 'check-out') => {
    if (!visitorVisitId || !visitorPoi) return;

    setVisitorRetryAction(action);
    setVisitorStatus('loading');
    setVisitorError('');
    try {
      const visit = await apiPost<VisitorResponse>(`/api/visitors/${action}`, {
        visit_id: visitorVisitId,
        ...(action === 'check-in' ? { poi_id: visitorPoi.id } : {}),
        ...(action === 'check-out' ? { exit_method: 'manual' } : {}),
      });

      setVisitorEnteredAt(visit.entered_at);
      setVisitorExitedAt(visit.exited_at);
      setVisitorExitMethod(visit.exit_method);
      if (visit.status === 'exited') {
        setVisitorStatus('exited');
      } else {
        setVisitorStatus('inside');
      }
    } catch (error) {
      setVisitorRetryAction(action);
      setVisitorError(error instanceof Error ? error.message : t.visitorCheckInFailed);
      setVisitorStatus('error');
    }
  };

  const handleDeleteVisit = async () => {
    if (!visitorVisitId || !window.confirm(t.deleteVisitConfirm)) return;

    setIsDeletingVisit(true);
    setVisitorError('');
    try {
      await apiDelete(`/api/visitors/${encodeURIComponent(visitorVisitId)}`);
      window.sessionStorage.removeItem(VISITOR_ID_KEY);
      window.sessionStorage.removeItem(VISITOR_POI_KEY);
      setVisitorVisitId(null);
      setVisitorEnteredAt(null);
      setVisitorExitedAt(null);
      setVisitorExitMethod(null);
      setRoutePoiIds([]);
      setRouteSaved(false);
      setVisitorStatus('deleted');
    } catch (error) {
      setVisitorError(error instanceof Error ? error.message : t.deleteVisitFailed);
    } finally {
      setIsDeletingVisit(false);
    }
  };

  const startNewVisitorVisit = () => {
    window.sessionStorage.removeItem(VISITOR_ID_KEY);
    window.sessionStorage.removeItem(VISITOR_POI_KEY);
    window.location.reload();
  };

  const toggleRoutePoi = (poiId: string) => {
    if (!routePoiIds.includes(poiId) && routePoiIds.length >= MAX_ROUTE_STOPS) {
      setVisitorError(t.routeLimitReached);
      return;
    }
    setVisitorError('');
    setRoutePoiIds((current) =>
      current.includes(poiId)
        ? current.filter((id) => id !== poiId)
        : [...current, poiId],
    );
    setRouteSaved(false);
  };

  const toggleRouteRegion = (region: VietnamRegion) => {
    const regionPoiIds = pois
      .filter((poi) => getVietnamRegion(poi.latitude) === region)
      .map((poi) => poi.id);
    if (regionPoiIds.length === 0) return;

    const regionIsSelected = regionPoiIds.some((poiId) => routePoiIds.includes(poiId));
    if (regionIsSelected) {
      setVisitorError('');
      setRoutePoiIds((current) => current.filter((poiId) => !regionPoiIds.includes(poiId)));
    } else {
      const additions = regionPoiIds.filter((poiId) => !routePoiIds.includes(poiId));
      const room = Math.max(MAX_ROUTE_STOPS - routePoiIds.length, 0);
      setVisitorError(additions.length > room ? t.routeLimitReached : '');
      setRoutePoiIds((current) => [...current, ...additions.slice(0, room)]);
    }
    setRouteSaved(false);
  };

  const beginDesktopRouteSelection = () => {
    setVisitorError('');
    setIsRoutePickerOpen(true);
  };

  const openDesktopRoute = () => {
    setVisitorError('');
    if (routeSaved && routePois.length > 0) {
      setIsRouteResultOpen(true);
    } else {
      beginDesktopRouteSelection();
    }
  };

  const handlePrintRoute = () => {
    if (routePois.length === 0) return;
    setVisitorError('');
    const html = buildRoutePrintHtml(
      routeSummary.legs,
      routeSummary.totalMeters,
      currentLang,
      {
        documentTitle: t.printDocumentTitle,
        stopsUnit: t.stopsUnit,
        totalDistance: t.totalDistance,
        fromPrevious: t.fromPrevious,
        startPoint: t.startPoint,
        coordinates: t.coordLabel.replace(/^[^\p{L}\p{N}]+/u, ''),
        radius: t.radiusLabel.replace(/^[^\p{L}\p{N}]+/u, ''),
        metersUnit: t.metersUnit,
        note: t.straightLineNote,
        printedAt: t.printedAt,
      },
      formatVisitTimestamp(new Date().toISOString(), currentLang) ?? '',
    );
    if (!printRouteDocument(html)) setVisitorError(t.printUnavailable);
  };

  const moveRouteStop = (poiId: string, direction: -1 | 1) => {
    setRoutePoiIds((current) => {
      const index = current.indexOf(poiId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      const currentId = next[index];
      const adjacentId = next[nextIndex];
      if (!currentId || !adjacentId) return current;
      next[index] = adjacentId;
      next[nextIndex] = currentId;
      return next;
    });
    setRouteSaved(false);
  };

  const handleSaveRoute = async () => {
    if (!routePoiIds.length || !selectedPoi) return false;

    setIsSavingRoute(true);
    setVisitorError('');
    try {
      let visitId = visitorVisitId;
      if (!visitId || visitorStatus !== 'inside') {
        const storedVisitId = window.sessionStorage.getItem(VISITOR_ID_KEY);
        const storedPoiId = window.sessionStorage.getItem(VISITOR_POI_KEY);
        visitId =
          storedVisitId && storedPoiId === selectedPoi.id
            ? storedVisitId
            : createVisitId();
        window.sessionStorage.setItem(VISITOR_ID_KEY, visitId);
        window.sessionStorage.setItem(VISITOR_POI_KEY, selectedPoi.id);
        setVisitorVisitId(visitId);
        const visit = await apiPost<VisitorResponse>('/api/visitors/check-in', {
          visit_id: visitId,
          poi_id: selectedPoi.id,
        });
        setVisitorEnteredAt(visit.entered_at);
        setVisitorExitedAt(visit.exited_at);
        setVisitorExitMethod(visit.exit_method);
        if (visit.status !== 'inside') {
          setVisitorStatus(visit.status);
          throw new Error(t.visitorCheckInFailed);
        }
        setVisitorStatus('inside');
      }
      await apiPost('/api/visitors/itinerary', {
        visit_id: visitId,
        poi_ids: routePoiIds,
      });
      setRouteSaved(true);
      return true;
    } catch (error) {
      setVisitorError(error instanceof Error ? error.message : t.routeSaveFailed);
      setRouteSaved(false);
      return false;
    } finally {
      setIsSavingRoute(false);
    }
  };

  const handleClearRoute = async () => {
    if (isClearingRoute || !window.confirm(t.clearRouteConfirm)) return;

    setIsClearingRoute(true);
    setVisitorError('');
    try {
      if (routeSaved && visitorVisitId) {
        await apiDelete(`/api/visitors/itinerary/${visitorVisitId}`);
      }
      setRoutePoiIds([]);
      setRouteSaved(false);
      setIsRoutePickerOpen(false);
      setIsRouteResultOpen(false);
    } catch (error) {
      setVisitorError(error instanceof Error ? error.message : t.clearRouteFailed);
    } finally {
      setIsClearingRoute(false);
    }
  };

  // Hàm kích hoạt giọng đọc trình duyệt (TTS) theo đúng ngôn ngữ hiện tại
  const handleSpeak = useCallback((text?: string) => {
    if (!text) return;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel(); // Dừng đoạn đọc cũ nếu có
      
      const utterance = new SpeechSynthesisUtterance(text);
      
      if (currentLang === 'vi') utterance.lang = 'vi-VN';
      else if (currentLang === 'en') utterance.lang = 'en-US';
      else if (currentLang === 'zh') utterance.lang = 'zh-CN';

      utterance.rate = 1.0;

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      window.speechSynthesis.speak(utterance);
    } else {
      alert('Trình duyệt của bạn không hỗ trợ tính năng phát âm thanh (TTS).');
    }
  }, [currentLang]);

  announceRef.current = handleSpeak;

  useEffect(() => {
    if (!isLocationTracking || !location || pois.length === 0) return;

    const update = processGeofenceUpdate(
      location,
      pois,
      geofenceState.current,
      location.timestamp,
      { debounceMs: 3_000, cooldownMs: 5 * 60 * 1_000, exitMultiplier: 1.25 },
    );
    geofenceState.current = update.state;

    if (!update.trigger) return;
    const poi = pois.find((item) => item.id === update.trigger?.poiId);
    if (!poi) return;

    setGeofenceArrivalPoiId(poi.id);
    setSelectedPoi(poi);
    const script = poi.ttsScript?.[currentLang] || poi.description?.[currentLang];
    if (script && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      announceRef.current(script);
    }
  }, [currentLang, isLocationTracking, location, pois]);

  const handleStopSpeech = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  };

  const filteredPois = pois.filter(item => {
    const nameText = item.name?.[currentLang]?.toLowerCase() || item.name?.vi?.toLowerCase() || '';
    const descText = item.description?.[currentLang]?.toLowerCase() || item.description?.vi?.toLowerCase() || '';
    const query = searchQuery.toLowerCase();
    return nameText.includes(query) || descText.includes(query);
  });

  if (location) {
    filteredPois.sort(
      (first, second) =>
        evaluatePoi(location, first).distanceMeters - evaluatePoi(location, second).distanceMeters,
    );
  }

  const toggleLocationTracking = () => {
    if (isLocationTracking) {
      setIsLocationTracking(false);
      setLocation(null);
      setGeofenceArrivalPoiId(null);
      return;
    }
    if (typeof window !== 'undefined' && !window.isSecureContext && window.location.hostname !== 'localhost') {
      setLocationError(t.locationPermissionError);
      return;
    }
    setLocationError('');
    setIsLocationTracking(true);
  };

  const openGoogleMaps = (poi: Poi) => {
    const destination = poi.mapUrl ||
      `https://www.google.com/maps/search/?api=1&query=${poi.latitude},${poi.longitude}`;
    void Linking.openURL(destination);
  };

  if (visitorMode) {
    return (
      <View style={styles.visitorContainer}>
        <View style={styles.visitorHeader}>
          <Text style={styles.brand}>{t.brand}</Text>
          <View style={styles.visitorHeaderActions}>
            {visitorStatus === 'inside' && (
              <TouchableOpacity
                style={[styles.locationButton, isLocationTracking && styles.locationButtonActive]}
                onPress={toggleLocationTracking}
              >
                <Text style={[styles.locationButtonText, isLocationTracking && styles.locationButtonTextActive]}>
                  {isLocationTracking ? t.disableLocation : t.enableLocation}
                </Text>
              </TouchableOpacity>
            )}
            {(['vi', 'en', 'zh'] as LanguageKey[]).map((lang) => (
              <TouchableOpacity
                key={lang}
                style={[styles.languageButton, currentLang === lang && styles.languageButtonActive]}
                onPress={() => {
                  handleStopSpeech();
                  setCurrentLang(lang);
                }}
              >
                <Text style={[styles.languageText, currentLang === lang && styles.languageTextActive]}>
                  {lang.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <ScrollView style={styles.visitorScroll} contentContainerStyle={styles.visitorContent}>
          <View style={styles.visitorIntro}>
            <Text style={styles.eyebrow}>{t.visitorTitle}</Text>
            <Text style={styles.visitorTitle}>
              {visitorPoi?.name?.[currentLang] || visitorPoi?.name?.vi || t.visitorTitle}
            </Text>
            <Text style={styles.visitorMessage}>
              {visitorStatus === 'loading'
                ? visitorVisitId && visitorRetryAction === 'check-out'
                  ? t.visitorExitProgress
                  : t.visitorCheckIn
                : visitorStatus === 'inside'
                  ? t.routeHelp
                  : visitorStatus === 'exited'
                    ? t.visitorExitSuccess
                    : visitorStatus === 'deleted'
                      ? t.visitDeleted
                      : visitorError || t.visitorInvalidQr}
            </Text>
          </View>

          <View style={styles.visitRecordPanel}>
            <View style={styles.visitRecordHeader}>
              <Text style={styles.visitRecordTitle}>{t.visitRecordTitle}</Text>
              <Text style={styles.visitReference} selectable>
                {visitorVisitId ? `${t.visitReference}: ${visitorVisitId}` : t.recordPending}
              </Text>
            </View>
            <View style={styles.visitRecordRow}>
              <View style={[styles.visitRecordDot, styles.visitRecordDotEntry]} />
              <View style={styles.visitRecordCopy}>
                <Text style={styles.visitRecordLabel}>{t.checkInRecord}</Text>
                <Text style={styles.visitRecordTime}>
                  {formatVisitTimestamp(visitorEnteredAt, currentLang) ??
                    (visitorStatus === 'loading' ? t.visitorCheckIn : t.recordPending)}
                </Text>
              </View>
              <Text style={[styles.visitRecordBadge, styles.visitRecordBadgeEntry]}>
                {visitorEnteredAt ? t.recordComplete : t.recordPending}
              </Text>
            </View>
            <View style={styles.visitRecordRow}>
              <View style={[styles.visitRecordDot, styles.visitRecordDotExit]} />
              <View style={styles.visitRecordCopy}>
                <Text style={styles.visitRecordLabel}>
                  {visitorExitMethod === 'geofence'
                    ? t.exitedByGeofence
                    : visitorExitMethod === 'manual'
                      ? t.exitedManually
                      : t.checkOutRecord}
                </Text>
                <Text style={styles.visitRecordTime}>
                  {formatVisitTimestamp(visitorExitedAt, currentLang) ??
                    (visitorStatus === 'loading' && visitorRetryAction === 'check-out'
                      ? t.visitorExitProgress
                      : t.recordPending)}
                </Text>
              </View>
              <Text
                style={[
                  styles.visitRecordBadge,
                  visitorExitedAt ? styles.visitRecordBadgeExit : styles.visitRecordBadgePending,
                ]}
              >
                {visitorExitedAt
                  ? t.recordComplete
                  : visitorStatus === 'inside'
                    ? t.recordActive
                    : t.recordPending}
              </Text>
            </View>
            {visitorVisitId && visitorStatus !== 'deleted' && (
              <TouchableOpacity
                style={styles.deleteVisitButton}
                disabled={isDeletingVisit}
                onPress={() => void handleDeleteVisit()}
              >
                <Text style={styles.deleteVisitButtonText}>
                  {isDeletingVisit ? t.deletingVisit : t.deleteVisit}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {pois.length > 0 && (
            <>
              <View style={styles.routePanel}>
                <Text style={styles.routeTitle}>{t.exploreTitle}</Text>
                <TextInput
                  style={styles.searchInput}
                  placeholder={t.destinationFilter}
                  placeholderTextColor="#888"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                {isRoutePickerOpen && (
                  <View style={styles.regionPicker}>
                    <Text style={styles.routeHelp}>{t.regionHelp}</Text>
                    {visitorStatus !== 'inside' && (
                      <Text style={styles.routeControlHint}>{t.routeControlsLocked}</Text>
                    )}
                    {(['south', 'north', 'central'] as VietnamRegion[]).map((region) => {
                      const regionPois = pois.filter((poi) => getVietnamRegion(poi.latitude) === region);
                      const regionPoiIds = regionPois.map((poi) => poi.id);
                      const selectedCount = regionPoiIds.filter((poiId) => routePoiIds.includes(poiId)).length;
                      const regionSelected = selectedCount > 0;
                      const disabled = visitorStatus !== 'inside' || regionPoiIds.length === 0;
                      return (
                        <TouchableOpacity
                          key={region}
                          style={[
                            styles.regionButton,
                            regionSelected && styles.regionButtonSelected,
                            disabled && styles.routeControlDisabled,
                          ]}
                          disabled={disabled}
                          onPress={() => toggleRouteRegion(region)}
                        >
                          <View style={styles.regionButtonCopy}>
                            <Text style={styles.regionButtonTitle}>{t.regions[region]}</Text>
                            <Text style={styles.regionButtonCount}>
                              {`${selectedCount}/${regionPois.length}`}
                            </Text>
                          </View>
                          <Text style={[styles.regionButtonAction, regionSelected && styles.regionButtonActionSelected]}>
                            {regionSelected ? t.removeRegion : t.addRegion}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
                {filteredPois.length === 0 ? (
                  <Text style={styles.routeHelp}>{t.noDestinationsFound}</Text>
                ) : (
                  filteredPois.map((poi, index) => {
                    const isSelected = selectedPoi?.id === poi.id;
                    const isOnRoute = routePoiIds.includes(poi.id);
                    return (
                      <View
                        key={poi.id}
                        style={[styles.visitorDestinationCard, isSelected && styles.routeOptionSelected]}
                      >
                        <TouchableOpacity
                          style={styles.routeOptionCopy}
                          onPress={() => {
                            handleStopSpeech();
                            setSelectedPoi(poi);
                          }}
                        >
                          <Text style={styles.poiIndex}>{String(index + 1).padStart(2, '0')}</Text>
                          <Text style={styles.routeOptionName}>
                            {poi.name?.[currentLang] || poi.name?.vi}
                          </Text>
                          <Text style={styles.routeOptionDescription} numberOfLines={2}>
                            {poi.description?.[currentLang] || poi.description?.vi}
                          </Text>
                        </TouchableOpacity>
                        {isRoutePickerOpen && (
                          <TouchableOpacity
                            style={[
                              styles.routeActionButton,
                              isOnRoute && styles.routeActionButtonSelected,
                              visitorStatus !== 'inside' && styles.routeControlDisabled,
                            ]}
                            disabled={visitorStatus !== 'inside'}
                            onPress={() => toggleRoutePoi(poi.id)}
                          >
                            <Text style={[styles.routeAction, isOnRoute && styles.routeActionSelected]}>
                              {isOnRoute ? t.removeStop : t.addStop}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })
                )}
              </View>

              {selectedPoi && (
                <View style={styles.visitorDetailCard}>
                  <Text style={styles.eyebrow}>{t.destinationDetails}</Text>
                  <Text style={styles.visitorDetailTitle}>
                    {selectedPoi.name?.[currentLang] || selectedPoi.name?.vi}
                  </Text>
                  <Text style={styles.detailDescription}>
                    {selectedPoi.description?.[currentLang] || selectedPoi.description?.vi}
                  </Text>
                  <View style={styles.coordBox}>
                    <Text style={styles.coordText}>
                      {t.coordLabel}: {selectedPoi.latitude}, {selectedPoi.longitude}
                    </Text>
                    <Text style={styles.coordText}>
                      {t.radiusLabel}: {selectedPoi.radiusMeters} {t.metersUnit}
                    </Text>
                    {location && (
                      <Text style={styles.coordText}>
                        {t.geofenceDistance}: {formatDistance(evaluatePoi(location, selectedPoi).distanceMeters)}
                      </Text>
                    )}
                  </View>
                  {(selectedPoi.ttsScript?.[currentLang] || selectedPoi.description?.[currentLang] || selectedPoi.description?.vi) && (
                    <View style={styles.ttsBox}>
                      <View style={styles.ttsHeaderRow}>
                        <Text style={styles.ttsTitle}>{t.ttsTitle}</Text>
                        <TouchableOpacity
                          style={[styles.speakButton, isSpeaking && styles.stopButton]}
                          onPress={() => isSpeaking
                            ? handleStopSpeech()
                            : handleSpeak(
                              selectedPoi.ttsScript?.[currentLang] ||
                              selectedPoi.description?.[currentLang] ||
                              selectedPoi.description?.vi,
                            )}
                        >
                          <Text style={styles.speakButtonText}>
                            {isSpeaking ? t.stop : t.listen}
                          </Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.ttsText}>
                        {selectedPoi.ttsScript?.[currentLang] ||
                          selectedPoi.description?.[currentLang] ||
                          selectedPoi.description?.vi}
                      </Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.mapButton}
                    onPress={() => openGoogleMaps(selectedPoi)}
                  >
                    <Text style={styles.mapButtonText}>↗ {t.directions}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}

          <View style={styles.routePanel}>
            <Text style={styles.routeTitle}>{t.routeTitle} · {routePoiIds.length}</Text>
            <Text style={styles.routeHelp}>{t.routeHelp}</Text>
            {visitorStatus !== 'inside' && (
              <Text style={styles.routeControlHint}>{t.routeControlsLocked}</Text>
            )}
            <TouchableOpacity
              style={[
                styles.primaryButton,
                visitorStatus !== 'inside' && styles.buttonDisabled,
              ]}
              disabled={visitorStatus !== 'inside'}
              onPress={() => setIsRoutePickerOpen((open) => !open)}
            >
              <Text style={styles.primaryButtonText}>
                {isRoutePickerOpen ? t.closeRoutePicker : t.chooseRoute}
              </Text>
            </TouchableOpacity>
            {routePoiIds.length === 0 ? (
              <Text style={styles.routeHelp}>{t.routeEmpty}</Text>
            ) : (
              routePoiIds.map((poiId, index) => {
                const poi = pois.find((item) => item.id === poiId);
                if (!poi) return null;
                return (
                  <View key={poiId} style={styles.routeStop}>
                    <Text style={styles.routeStopNumber}>{String(index + 1).padStart(2, '0')}</Text>
                    <Text style={styles.routeStopName}>{poi.name?.[currentLang] || poi.name?.vi}</Text>
                    <TouchableOpacity
                      accessibilityLabel={t.directions}
                      style={styles.moveButton}
                      onPress={() => openGoogleMaps(poi)}
                    >
                      <Text style={styles.moveButtonText}>↗</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      accessibilityLabel={t.moveUp}
                      style={[styles.moveButton, (visitorStatus !== 'inside' || index === 0) && styles.routeControlDisabled]}
                      disabled={visitorStatus !== 'inside' || index === 0}
                      onPress={() => moveRouteStop(poiId, -1)}
                    >
                      <Text style={styles.moveButtonText}>↑</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      accessibilityLabel={t.moveDown}
                      style={[styles.moveButton, (visitorStatus !== 'inside' || index === routePoiIds.length - 1) && styles.routeControlDisabled]}
                      disabled={visitorStatus !== 'inside' || index === routePoiIds.length - 1}
                      onPress={() => moveRouteStop(poiId, 1)}
                    >
                      <Text style={styles.moveButtonText}>↓</Text>
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
            {routePois.length > 0 && (
              <>
                <Text style={styles.routeSummaryTotal}>
                  {t.totalDistance}: {formatDistance(routeSummary.totalMeters)}
                </Text>
                <Text style={styles.routeHelp}>{t.straightLineNote}</Text>
                <TouchableOpacity style={styles.secondaryButton} onPress={handlePrintRoute}>
                  <Text style={styles.secondaryButtonText}>{t.printRoute}</Text>
                </TouchableOpacity>
              </>
            )}
            {isRoutePickerOpen && (
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  (routePoiIds.length === 0 || isSavingRoute || visitorStatus !== 'inside') && styles.buttonDisabled,
                ]}
                disabled={routePoiIds.length === 0 || isSavingRoute || visitorStatus !== 'inside'}
                onPress={() => {
                  void handleSaveRoute().then((saved) => {
                    if (saved) setIsRoutePickerOpen(false);
                  });
                }}
              >
                <Text style={styles.primaryButtonText}>
                  {isSavingRoute ? t.savingRoute : t.confirmRoute}
                </Text>
              </TouchableOpacity>
            )}
            {routePoiIds.length > 0 && (
              <TouchableOpacity
                style={[
                  styles.clearRouteButton,
                  (visitorStatus !== 'inside' || isClearingRoute || isSavingRoute) &&
                    styles.routeControlDisabled,
                ]}
                disabled={visitorStatus !== 'inside' || isClearingRoute || isSavingRoute}
                onPress={() => void handleClearRoute()}
              >
                <Text style={styles.clearRouteButtonText}>
                  {isClearingRoute ? t.clearingRoute : t.clearRoute}
                </Text>
              </TouchableOpacity>
            )}
            {routeSaved && <Text style={styles.successMessage}>{t.routeSaved}</Text>}
            {visitorError && <Text style={styles.errorMessage}>{visitorError}</Text>}
          </View>

          {visitorStatus === 'inside' && (
            <>
              <View style={styles.autoExitPanel}>
                <Text style={styles.autoExitHelp}>{t.autoExitHelp}</Text>
                <TouchableOpacity
                  style={[styles.autoExitButton, isAutoCheckoutEnabled && styles.autoExitButtonActive]}
                  onPress={() => {
                    setVisitorError('');
                    setIsAutoCheckoutEnabled((enabled) => !enabled);
                  }}
                >
                  <Text style={[styles.autoExitButtonText, isAutoCheckoutEnabled && styles.autoExitButtonTextActive]}>
                    {isAutoCheckoutEnabled ? t.disableAutoExit : t.enableAutoExit}
                  </Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.exitButton} onPress={() => void handleVisitorAction('check-out')}>
                <Text style={styles.exitButtonText}>{t.visitorExit}</Text>
              </TouchableOpacity>
            </>
          )}
          {visitorStatus === 'error' && visitorVisitId && (
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => void handleVisitorAction(visitorRetryAction)}
            >
              <Text style={styles.primaryButtonText}>{t.visitorRetry}</Text>
            </TouchableOpacity>
          )}
          {visitorStatus === 'exited' && (
            <TouchableOpacity style={styles.newVisitButton} onPress={startNewVisitorVisit}>
              <Text style={styles.newVisitButtonText}>{t.startNewVisit}</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <View>
          <Text style={styles.brand}>{t.brand}</Text>
          <Text style={styles.heroTitle}>{t.webTitle}</Text>
          <Text style={styles.heroSubtitle}>{t.webSubtitle}</Text>
        </View>
        <View style={styles.topbarActions}>
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.adminEntryButton}
            onPress={() => window.location.assign('/admin')}
          >
            <Text style={styles.adminEntryButtonText}>Quản trị Admin</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.locationButton, isLocationTracking && styles.locationButtonActive]}
            onPress={toggleLocationTracking}
          >
            <Text style={[styles.locationButtonText, isLocationTracking && styles.locationButtonTextActive]}>
              {isLocationTracking ? t.disableLocation : t.enableLocation}
            </Text>
          </TouchableOpacity>
          <View style={styles.langContainer}>
            {(['vi', 'en', 'zh'] as LanguageKey[]).map((lang) => (
              <TouchableOpacity
                key={lang}
                style={[styles.langBtn, currentLang === lang && styles.langBtnActive]}
                onPress={() => {
                  handleStopSpeech();
                  setCurrentLang(lang);
                }}
              >
                <Text style={[styles.langText, currentLang === lang && styles.langTextActive]}>
                  {lang.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
      {geofenceArrivalPoi && location && (
        <View style={styles.geofenceNotice}>
          <View style={styles.geofenceNoticeCopy}>
            <Text style={styles.geofenceNoticeTitle}>
              {t.geofenceArrival}: {geofenceArrivalPoi.name?.[currentLang] || geofenceArrivalPoi.name.vi}
            </Text>
            <Text style={styles.geofenceNoticeDistance}>
              {t.geofenceDistance}: {formatDistance(evaluatePoi(location, geofenceArrivalPoi).distanceMeters)}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.geofenceListenButton}
            onPress={() => handleSpeak(
              geofenceArrivalPoi.ttsScript?.[currentLang] ||
              geofenceArrivalPoi.description?.[currentLang] ||
              geofenceArrivalPoi.description.vi,
            )}
          >
            <Text style={styles.geofenceListenText}>{t.listen}</Text>
          </TouchableOpacity>
        </View>
      )}
      {locationError ? <Text style={styles.statusError}>{locationError}</Text> : null}
      <View style={styles.contentRow}>
        <View style={styles.sidebar}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>{t.locationLabel}</Text>
          <TouchableOpacity
            style={styles.desktopRouteButton}
            onPress={openDesktopRoute}
          >
            <Text style={styles.desktopRouteButtonText}>
              {`${t.routeButton}${routePoiIds.length ? ` · ${routePoiIds.length}` : ''}`}
            </Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={styles.searchInput}
          placeholder={t.searchPlaceholder}
          placeholderTextColor="#888"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />

        <View style={styles.poiListViewport}>
          <ScrollView style={styles.poiListScroll}>
            {filteredPois.map((poi, index) => {
              const isSelected = selectedPoi?.id === poi.id;
              return (
                <View
                  key={poi.id}
                  style={[styles.poiCard, isSelected && styles.poiCardSelected]}
                >
                  <TouchableOpacity
                    onPress={() => {
                      handleStopSpeech();
                      setSelectedPoi(poi);
                    }}
                  >
                    <Text style={styles.poiIndex}>{String(index + 1).padStart(2, '0')}</Text>
                    <Text style={styles.poiName}>{poi.name?.[currentLang] || poi.name?.vi}</Text>
                    <Text style={styles.poiDesc} numberOfLines={2}>{poi.description?.[currentLang] || poi.description?.vi}</Text>
                    <View style={styles.poiBadgeRow}>
                      <Text style={styles.badge}>{t.radiusBadge}: {poi.radiusMeters}m</Text>
                      <Text style={styles.badgePriority}>{t.priorityBadge}: {poi.priority}</Text>
                      {location && (
                        <Text style={styles.badgeDistance}>
                          {formatDistance(evaluatePoi(location, poi).distanceMeters)}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
      <View style={styles.mapContainer}>
        {selectedPoi ? (
          <View style={styles.detailCard}>
            <Text style={styles.eyebrow}>{t.detailsLabel}</Text>
            <Text style={styles.detailTitle}>{selectedPoi.name?.[currentLang] || selectedPoi.name?.vi}</Text>
            <Text style={styles.detailDescription}>{selectedPoi.description?.[currentLang] || selectedPoi.description?.vi}</Text>
            
            <View style={styles.coordBox}>
              <Text style={styles.coordText}>{t.coordLabel}: {selectedPoi.latitude}, {selectedPoi.longitude}</Text>
              <Text style={styles.coordText}>{t.radiusLabel}: {selectedPoi.radiusMeters} {t.metersUnit}</Text>
            </View>

            {selectedPoi.ttsScript?.[currentLang] && (
              <View style={styles.ttsBox}>
                <View style={styles.ttsHeaderRow}>
                  <Text style={styles.ttsTitle}>{t.ttsTitle}:</Text>
                  <TouchableOpacity 
                    style={[styles.speakButton, isSpeaking && styles.stopButton]} 
                    onPress={() => {
                      if (isSpeaking) {
                        handleStopSpeech();
                      } else {
                        handleSpeak(selectedPoi.ttsScript?.[currentLang]);
                      }
                    }}
                  >
                    <Text style={styles.speakButtonText}>
                      {isSpeaking ? t.stop : t.listen}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.ttsText}>{selectedPoi.ttsScript[currentLang]}</Text>
              </View>
            )}

            <TouchableOpacity 
              style={styles.mapButton} 
              onPress={() => openGoogleMaps(selectedPoi)}
            >
              <Text style={styles.mapButtonText}>↗  {t.directions}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.mapMockup}>
            <Text style={styles.mapMockupText}>{t.selectPrompt}</Text>
          </View>
        )}
      </View>
      </div>
      </View>
      {isRoutePickerOpen && (
        <View style={styles.desktopRouteOverlay}>
          <View style={styles.desktopRouteDialog}>
            <View style={styles.desktopRouteDialogHeader}>
              <View style={styles.routeOptionCopy}>
                <Text style={styles.routeTitle}>{t.routeTitle} · {routePoiIds.length}</Text>
                <Text style={styles.routeHelp}>{t.routeHelp}</Text>
              </View>
              <TouchableOpacity
                style={styles.moveButton}
                accessibilityLabel={t.closeRoutePicker}
                onPress={() => setIsRoutePickerOpen(false)}
              >
                <Text style={styles.moveButtonText}>×</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.desktopRouteDialogScroll}>
              <Text style={styles.routeHelp}>{t.regionHelp}</Text>
              {visitorStatus !== 'inside' && (
                <Text style={styles.routeControlHint}>{t.routeCanEditBeforeCheckIn}</Text>
              )}
              {(['south', 'north', 'central'] as VietnamRegion[]).map((region) => {
                const regionPois = pois.filter((poi) => getVietnamRegion(poi.latitude) === region);
                if (regionPois.length === 0) return null;
                const regionPoiIds = regionPois.map((poi) => poi.id);
                const selectedCount = regionPoiIds.filter((poiId) => routePoiIds.includes(poiId)).length;
                const regionSelected = selectedCount > 0;
                return (
                  <TouchableOpacity
                    key={region}
                    style={[
                      styles.regionButton,
                      regionSelected && styles.regionButtonSelected,
                    ]}
                    onPress={() => toggleRouteRegion(region)}
                  >
                    <View style={styles.regionButtonCopy}>
                      <Text style={styles.regionButtonTitle}>{t.regions[region]}</Text>
                      <Text style={styles.regionButtonCount}>
                        {`${selectedCount}/${regionPois.length}`}
                      </Text>
                    </View>
                    <Text style={[styles.regionButtonAction, regionSelected && styles.regionButtonActionSelected]}>
                      {regionSelected ? t.removeRegion : t.addRegion}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {filteredPois.map((poi) => {
                const isOnRoute = routePoiIds.includes(poi.id);
                return (
                  <View key={poi.id} style={styles.visitorDestinationCard}>
                    <View style={styles.routeOptionCopy}>
                      <Text style={styles.routeOptionName}>{poi.name?.[currentLang] || poi.name?.vi}</Text>
                      <Text style={styles.routeOptionDescription} numberOfLines={2}>
                        {poi.description?.[currentLang] || poi.description?.vi}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[
                        styles.routeActionButton,
                        isOnRoute && styles.routeActionButtonSelected,
                      ]}
                      onPress={() => toggleRoutePoi(poi.id)}
                    >
                      <Text style={[styles.routeAction, isOnRoute && styles.routeActionSelected]}>
                        {isOnRoute ? t.removeStop : t.addStop}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
              <Text style={styles.routeTitle}>{t.routeTitle}</Text>
              {routePoiIds.length === 0 ? (
                <Text style={styles.routeHelp}>{t.routeEmpty}</Text>
              ) : routePoiIds.map((poiId, index) => {
                const poi = pois.find((item) => item.id === poiId);
                if (!poi) return null;
                return (
                  <View key={poiId} style={styles.routeStop}>
                    <Text style={styles.routeStopNumber}>{String(index + 1).padStart(2, '0')}</Text>
                    <Text style={styles.routeStopName}>{poi.name?.[currentLang] || poi.name?.vi}</Text>
                    <TouchableOpacity
                      accessibilityLabel={t.moveUp}
                      style={[
                        styles.moveButton,
                        index === 0 && styles.routeControlDisabled,
                      ]}
                      disabled={index === 0}
                      onPress={() => moveRouteStop(poiId, -1)}
                    >
                      <Text style={styles.moveButtonText}>↑</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      accessibilityLabel={t.moveDown}
                      style={[
                        styles.moveButton,
                        index === routePoiIds.length - 1 && styles.routeControlDisabled,
                      ]}
                      disabled={index === routePoiIds.length - 1}
                      onPress={() => moveRouteStop(poiId, 1)}
                    >
                      <Text style={styles.moveButtonText}>↓</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
              {visitorError && <Text style={styles.errorMessage}>{visitorError}</Text>}
            </ScrollView>
            <View style={styles.desktopRouteDialogFooter}>
              <View style={styles.routeFooterActions}>
                {routePoiIds.length > 0 && (
                  <TouchableOpacity
                    style={[styles.clearRouteButton, styles.routeFooterButtonReset]}
                    disabled={isClearingRoute || isSavingRoute}
                    onPress={() => void handleClearRoute()}
                  >
                    <Text style={styles.clearRouteButtonText}>
                      {isClearingRoute ? t.clearingRoute : t.clearRoute}
                    </Text>
                  </TouchableOpacity>
                )}
                {routePois.length > 0 && (
                  <TouchableOpacity
                    style={[styles.secondaryButton, styles.routeFooterButtonReset]}
                    onPress={handlePrintRoute}
                  >
                    <Text style={styles.secondaryButtonText}>{t.printRoute}</Text>
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  styles.routeFooterButtonReset,
                  (routePoiIds.length === 0 || isSavingRoute) && styles.buttonDisabled,
                ]}
                disabled={routePoiIds.length === 0 || isSavingRoute}
                onPress={() => {
                  void handleSaveRoute().then((saved) => {
                    if (saved) {
                      setIsRoutePickerOpen(false);
                      setIsRouteResultOpen(true);
                    }
                  });
                }}
              >
                <Text style={[styles.primaryButtonText, styles.routeFooterPrimaryText]}>
                  {isSavingRoute ? t.savingRoute : t.confirmRoute}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
      {isRouteResultOpen && (
        <View style={styles.desktopRouteOverlay}>
          <View style={styles.desktopRouteDialog}>
            <View style={styles.desktopRouteDialogHeader}>
              <View style={styles.routeOptionCopy}>
                <Text style={styles.routeTitle}>{t.routeResultTitle} · {routePois.length}</Text>
                <Text style={routeSaved ? styles.successMessage : styles.routeHelp}>
                  {routeSaved ? t.routeSaved : t.routeDraftNote}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.moveButton}
                accessibilityLabel={t.closeDialog}
                onPress={() => setIsRouteResultOpen(false)}
              >
                <Text style={styles.moveButtonText}>×</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.desktopRouteDialogScroll}>
              {routeSummary.legs.map(({ poi, distanceFromPreviousMeters }, index) => (
                <View key={poi.id} style={styles.routeResultStop}>
                  <Text style={styles.routeResultNumber}>{index + 1}</Text>
                  <View style={styles.routeOptionCopy}>
                    <Text style={styles.routeOptionName}>{poi.name?.[currentLang] || poi.name?.vi}</Text>
                    <Text style={styles.routeOptionDescription} numberOfLines={3}>
                      {poi.description?.[currentLang] || poi.description?.vi}
                    </Text>
                    <Text style={styles.routeStopMeta}>
                      {distanceFromPreviousMeters === null
                        ? t.startPoint
                        : `${t.fromPrevious}: ${formatDistance(distanceFromPreviousMeters)}`}
                    </Text>
                  </View>
                  <TouchableOpacity
                    accessibilityLabel={t.directions}
                    style={styles.moveButton}
                    onPress={() => openGoogleMaps(poi)}
                  >
                    <Text style={styles.moveButtonText}>↗</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <Text style={styles.routeSummaryTotal}>
                {t.totalDistance}: {formatDistance(routeSummary.totalMeters)}
              </Text>
              <Text style={styles.routeHelp}>{t.straightLineNote}</Text>
              {visitorError ? <Text style={styles.errorMessage}>{visitorError}</Text> : null}
            </ScrollView>
            <View style={styles.desktopRouteDialogFooter}>
              <TouchableOpacity
                style={[styles.secondaryButton, styles.routeFooterButtonReset]}
                onPress={() => {
                  setIsRouteResultOpen(false);
                  beginDesktopRouteSelection();
                }}
              >
                <Text style={styles.secondaryButtonText}>{t.editRoute}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, styles.routeFooterButtonReset]}
                onPress={handlePrintRoute}
              >
                <Text style={[styles.primaryButtonText, styles.routeFooterPrimaryText]}>{t.printRoute}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f8ff',
  },
  topbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 14,
    paddingHorizontal: 32,
    paddingVertical: 18,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2ebf4',
  },
  topbarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
  },
  adminEntryButton: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#b8d7c4',
    backgroundColor: '#eef7f1',
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  adminEntryButtonText: {
    color: '#286847',
    fontSize: 12,
    fontWeight: '800',
  },
  brand: {
    color: '#388557',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 8,
  },
  heroTitle: {
    color: '#203548',
    fontSize: 30,
    fontWeight: '800',
    marginBottom: 5,
  },
  heroSubtitle: {
    color: '#617487',
    fontSize: 14,
  },
  contentRow: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
  },
  sidebar: {
    width: '29%',
    maxWidth: 500,
    minWidth: 340,
    flexShrink: 0,
    backgroundColor: '#ffffff',
    borderRightWidth: 1,
    borderRightColor: '#e2ebf4',
    paddingHorizontal: 28,
    paddingVertical: 24,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#748077',
    letterSpacing: 1.4,
  },
  langContainer: {
    flexDirection: 'row',
    gap: 6,
    flexShrink: 0,
  },
  locationButton: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#cfe0ed',
    backgroundColor: '#f4f9ff',
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  locationButtonActive: {
    backgroundColor: '#e5f5e9',
    borderColor: '#b8e2c4',
  },
  locationButtonText: {
    color: '#456b83',
    fontSize: 11,
    fontWeight: '800',
  },
  locationButtonTextActive: {
    color: '#287548',
  },
  statusError: {
    paddingHorizontal: 28,
    paddingVertical: 8,
    backgroundColor: '#fff1ed',
    color: '#a94f42',
    fontSize: 12,
  },
  geofenceNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 28,
    paddingVertical: 13,
    backgroundColor: '#e9f7ed',
    borderBottomWidth: 1,
    borderBottomColor: '#cbe8d3',
  },
  geofenceNoticeCopy: {
    flex: 1,
  },
  geofenceNoticeTitle: {
    color: '#286a43',
    fontSize: 13,
    fontWeight: '800',
  },
  geofenceNoticeDistance: {
    color: '#62826d',
    fontSize: 11,
    marginTop: 4,
  },
  geofenceListenButton: {
    backgroundColor: '#3d9b62',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  geofenceListenText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  langBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#eff6fb',
    borderWidth: 1,
    borderColor: '#eff6fb',
  },
  langBtnActive: {
    backgroundColor: '#e5f5e9',
    borderColor: '#b8e2c4',
  },
  langText: {
    color: '#7b857c',
    fontSize: 11,
    fontWeight: '800',
  },
  langTextActive: {
    color: '#287548',
  },
  searchInput: {
    backgroundColor: '#f4f9ff',
    borderWidth: 1,
    borderColor: '#dce8f2',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#24394a',
    marginBottom: 20,
  },
  poiListViewport: {
    flex: 1,
    minHeight: 0,
  },
  desktopRouteButton: {
    borderWidth: 1,
    borderColor: '#cfe0ed',
    borderRadius: 18,
    backgroundColor: '#f4f9ff',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  desktopRouteButtonText: {
    color: '#456b83',
    fontSize: 10,
    fontWeight: '800',
  },
  desktopRouteOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
    backgroundColor: 'rgba(27, 46, 61, 0.38)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  desktopRouteDialog: {
    width: '100%',
    maxWidth: 760,
    height: '86%',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    borderColor: '#dce8f2',
    shadowColor: '#203548',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 12,
  },
  desktopRouteDialogHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2ebf4',
  },
  desktopRouteDialogScroll: {
    flex: 1,
    minHeight: 0,
    marginTop: 14,
  },
  desktopRouteDialogFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2ebf4',
  },
  poiListScroll: {
    flex: 1,
  },
  poiCard: {
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e3edf5',
  },
  poiCardSelected: {
    borderColor: '#8ed2a1',
    backgroundColor: '#eefaf1',
  },
  poiIndex: {
    color: '#829281',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 8,
  },
  poiName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#25372a',
    marginBottom: 6,
  },
  poiDesc: {
    fontSize: 13,
    color: '#7a8279',
    lineHeight: 19,
    marginBottom: 12,
  },
  poiBadgeRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  badge: {
    fontSize: 11,
    color: '#7d7253',
    backgroundColor: '#f4f0e4',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
  },
  badgePriority: {
    fontSize: 11,
    color: '#537456',
    backgroundColor: '#eaf1e8',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
  },
  badgeDistance: {
    fontSize: 11,
    color: '#456b83',
    backgroundColor: '#edf7ff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
  },
  mapContainer: {
    flex: 1,
    backgroundColor: '#f2f8ff',
    padding: 44,
  },
  detailCard: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 36,
    borderWidth: 1,
    borderColor: '#e3edf5',
    shadowColor: '#475748',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.06,
    shadowRadius: 28,
  },
  eyebrow: {
    color: '#738571',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  detailTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#25372a',
    marginBottom: 10,
  },
  detailDescription: {
    fontSize: 15,
    color: '#6d786e',
    lineHeight: 24,
    marginBottom: 22,
  },
  coordBox: {
    backgroundColor: '#f5faff',
    padding: 16,
    borderRadius: 14,
    marginBottom: 20,
  },
  coordText: {
    color: '#727d73',
    fontSize: 13,
    marginBottom: 6,
  },
  ttsBox: {
    backgroundColor: '#fff9e8',
    padding: 18,
    borderRadius: 14,
    marginBottom: 20,
    borderLeftWidth: 3,
    borderLeftColor: '#c39a54',
  },
  ttsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  ttsTitle: {
    color: '#89713e',
    fontWeight: '800',
    fontSize: 13,
  },
  speakButton: {
    backgroundColor: '#e5f5e9',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  stopButton: {
    backgroundColor: '#fff0ec',
  },
  speakButtonText: {
    color: '#48684b',
    fontSize: 12,
    fontWeight: '800',
  },
  ttsText: {
    color: '#69736a',
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  mapButton: {
    backgroundColor: '#3d9b62',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 14,
  },
  mapButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  visitorContainer: {
    flex: 1,
    backgroundColor: '#f2f8ff',
  },
  visitorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2ebf4',
  },
  visitorHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  visitorScroll: {
    flex: 1,
  },
  visitorContent: {
    width: '100%',
    maxWidth: 820,
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 48,
  },
  visitorIntro: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e3edf5',
    borderRadius: 20,
    padding: 20,
    marginBottom: 18,
  },
  visitorTitle: {
    color: '#25372a',
    fontWeight: '800',
    fontSize: 25,
    marginBottom: 10,
  },
  visitorMessage: {
    color: '#6d786e',
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 0,
  },
  visitRecordPanel: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dceaf4',
    borderRadius: 18,
    padding: 22,
    marginBottom: 18,
    shadowColor: '#7b9bb2',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
  },
  visitRecordHeader: {
    gap: 8,
    marginBottom: 8,
  },
  visitRecordTitle: {
    color: '#48708a',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  visitReference: {
    color: '#8293a3',
    fontSize: 11,
    lineHeight: 17,
  },
  visitRecordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#edf3f8',
  },
  deleteVisitButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    marginTop: 4,
  },
  deleteVisitButtonText: {
    color: '#a94f42',
    fontSize: 12,
    fontWeight: '700',
  },
  visitRecordDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  visitRecordDotEntry: {
    backgroundColor: '#48b876',
  },
  visitRecordDotExit: {
    backgroundColor: '#f0a54d',
  },
  visitRecordCopy: {
    flex: 1,
  },
  visitRecordLabel: {
    color: '#2f4658',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 4,
  },
  visitRecordTime: {
    color: '#6d8192',
    fontSize: 12,
    lineHeight: 18,
  },
  visitRecordBadge: {
    overflow: 'hidden',
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 5,
    fontSize: 10,
    fontWeight: '800',
  },
  visitRecordBadgeEntry: {
    color: '#287548',
    backgroundColor: '#e5f5e9',
  },
  visitRecordBadgeExit: {
    color: '#a8661d',
    backgroundColor: '#fff3dc',
  },
  visitRecordBadgePending: {
    color: '#758698',
    backgroundColor: '#f0f5f9',
  },
  routePanel: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e3edf5',
    borderRadius: 20,
    padding: 24,
    marginBottom: 16,
  },
  routeTitle: {
    color: '#25372a',
    fontSize: 19,
    fontWeight: '800',
    marginBottom: 7,
  },
  routeHelp: {
    color: '#7a8279',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 16,
  },
  sectionLabel: {
    color: '#748077',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: 10,
  },
  routeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#e3edf5',
    borderRadius: 13,
    padding: 13,
    marginBottom: 9,
    backgroundColor: '#ffffff',
  },
  routeOptionSelected: {
    borderColor: '#9bd9aa',
    backgroundColor: '#effaf2',
  },
  routeCheckbox: {
    width: 26,
    height: 26,
    borderWidth: 1,
    borderColor: '#cbd2c8',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeCheckboxSelected: {
    backgroundColor: '#3d9b62',
    borderColor: '#3d9b62',
  },
  routeCheckboxText: {
    color: '#ffffff',
    fontWeight: '800',
  },
  routeOptionCopy: {
    flex: 1,
  },
  visitorDestinationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#e3edf5',
    borderRadius: 13,
    padding: 13,
    marginBottom: 9,
    backgroundColor: '#ffffff',
  },
  routeActionButton: {
    borderRadius: 16,
    backgroundColor: '#eff7ff',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  routeActionButtonSelected: {
    backgroundColor: '#e5f5e9',
  },
  routeControlDisabled: {
    opacity: 0.55,
  },
  routeControlHint: {
    color: '#7a8279',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  routeOptionName: {
    color: '#2c3c30',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 4,
  },
  routeOptionDescription: {
    color: '#7a8279',
    fontSize: 11,
    lineHeight: 16,
  },
  routeAction: {
    color: '#58745b',
    fontSize: 11,
    fontWeight: '800',
  },
  routeActionSelected: {
    color: '#287548',
  },
  regionPicker: {
    marginBottom: 16,
  },
  regionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#dce8f2',
    borderRadius: 12,
    backgroundColor: '#f7fbff',
  },
  regionButtonSelected: {
    borderColor: '#9bd9aa',
    backgroundColor: '#effaf2',
  },
  regionButtonCopy: {
    flex: 1,
  },
  regionButtonTitle: {
    color: '#2c3c30',
    fontSize: 13,
    fontWeight: '800',
  },
  regionButtonCount: {
    color: '#7a8279',
    fontSize: 11,
    marginTop: 3,
  },
  regionButtonAction: {
    color: '#456b83',
    fontSize: 11,
    fontWeight: '800',
  },
  regionButtonActionSelected: {
    color: '#287548',
  },
  visitorDetailCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e3edf5',
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
  },
  visitorDetailTitle: {
    color: '#25372a',
    fontSize: 25,
    fontWeight: '800',
    marginBottom: 10,
  },
  routeStop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#efeee8',
  },
  routeStopNumber: {
    color: '#8b9a88',
    fontSize: 11,
    fontWeight: '800',
  },
  routeStopName: {
    flex: 1,
    color: '#344337',
    fontSize: 13,
    fontWeight: '700',
  },
  autoExitPanel: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dceaf4',
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
  },
  autoExitHelp: {
    color: '#687b89',
    fontSize: 12,
    lineHeight: 19,
    marginBottom: 12,
  },
  autoExitButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#eff7ff',
    borderWidth: 1,
    borderColor: '#d1e5f3',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  autoExitButtonActive: {
    backgroundColor: '#e5f5e9',
    borderColor: '#b8e2c4',
  },
  autoExitButtonText: {
    color: '#456b83',
    fontSize: 12,
    fontWeight: '800',
  },
  autoExitButtonTextActive: {
    color: '#287548',
  },
  moveButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: '#eff6fb',
  },
  moveButtonText: {
    color: '#388557',
    fontWeight: '800',
    fontSize: 16,
  },
  primaryButton: {
    backgroundColor: '#3d9b62',
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 16,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  clearRouteButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#e5c8c2',
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 9,
    marginBottom: 12,
  },
  clearRouteButtonText: {
    color: '#a94f42',
    fontSize: 12,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#b8d7c4',
    backgroundColor: '#eef7f1',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
    marginTop: 12,
  },
  secondaryButtonText: {
    color: '#286847',
    fontSize: 13,
    fontWeight: '800',
  },
  routeFooterActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    flexShrink: 1,
  },
  routeFooterButtonReset: {
    marginTop: 0,
    marginBottom: 0,
  },
  routeFooterPrimaryText: {
    paddingHorizontal: 18,
  },
  routeResultStop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#efeee8',
  },
  routeResultNumber: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#3d9b62',
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 30,
  },
  routeStopMeta: {
    color: '#6d7f8b',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  routeSummaryTotal: {
    color: '#203548',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 14,
  },
  successMessage: {
    color: '#287548',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
  },
  errorMessage: {
    color: '#ad5147',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
  },
  exitButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#f4e9e5',
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 13,
    marginTop: 2,
  },
  exitButtonText: {
    color: '#9a4c41',
    fontSize: 13,
    fontWeight: '800',
  },
  newVisitButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#e5f5e9',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#b8e2c4',
    paddingHorizontal: 20,
    paddingVertical: 13,
    marginTop: 2,
  },
  newVisitButtonText: {
    color: '#287548',
    fontSize: 13,
    fontWeight: '800',
  },
  languageButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#eff6fb',
  },
  languageButtonActive: {
    backgroundColor: '#e5f5e9',
  },
  languageText: {
    color: '#7b857c',
    fontSize: 11,
    fontWeight: '800',
  },
  languageTextActive: {
    color: '#287548',
  },
  mapMockup: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapMockupText: {
    color: '#778177',
    fontSize: 16,
  },
});