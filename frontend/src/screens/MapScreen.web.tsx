// src/screens/MapScreen.web.tsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, TextInput, Linking } from 'react-native-web';
import type { Poi } from '../features/poi/types';
import { useBrowserPois, useOfflineDownload, useVisitorOptions } from '../features/content/web-hooks';
import { useVisitorSession } from '../features/content/visitor-session';
import { useNarration } from '../features/content/useNarration';
import { getPoiDetail } from '../features/poi/api';
import { PoiMap } from '../features/poi/PoiMap.web';
import { parsePoiQr } from '../features/qr/services/qr-content';
import {
  createGeofenceRuntimeState,
  evaluatePoi,
  isReliableOutsideGeofence,
  processGeofenceUpdate,
} from '../features/geofence';
import { foregroundGeofenceWeb } from '../features/geofence/services/foreground-geofence.web';
import type { WebGeofenceLocation } from '../features/geofence/services/foreground-geofence.web';
import { apiDelete, apiPost } from '../services/apiClient';


import { AudioControl, HeritageHeader, Icon, LanguageSelect, PoiPhoto, getUrlLanguage, interfaceLanguage, saveLanguage } from '../design/Heritage';

const playbackText = {
  vi: { pause: 'Tạm dừng', progress: 'Tiến trình thuyết minh', unavailable: 'Trình duyệt chưa có giọng đọc cho ngôn ngữ này.', failed: 'Không phát được thuyết minh. Hãy thử bấm phát lại.', recording: 'Audio ghi sẵn', speech: 'Giọng đọc trình duyệt', fallback: 'Ngôn ngữ thay thế', auto: 'Tự phát khi đến gần', offline: 'Tải để dùng ngoại tuyến', map: 'Bản đồ điểm tham quan', position: 'Vị trí của bạn', finding: 'Đang tìm vị trí…', checkingQr: 'Đang xác thực mã QR…', qrUnavailable: 'Cần kết nối để xác thực mã QR.', qrAccepted: 'Mã QR hợp lệ.' },
  en: { pause: 'Pause', progress: 'Narration progress', unavailable: 'This browser has no voice for this language.', failed: 'Playback failed. Press play to try again.', recording: 'Recorded audio', speech: 'Browser narration', fallback: 'Fallback language', auto: 'Play automatically on arrival', offline: 'Download for offline use', map: 'Destination map', position: 'Your location', finding: 'Finding your location…', checkingQr: 'Checking QR code…', qrUnavailable: 'A connection is required to check this QR code.', qrAccepted: 'QR code accepted.' },
  zh: { pause: '暂停', progress: '讲解进度', unavailable: '浏览器没有此语言的朗读语音。', failed: '播放失败，请点击播放重试。', recording: '录制音频', speech: '浏览器朗读', fallback: '备用语言', auto: '到达附近时自动播放', offline: '下载以便离线使用', map: '景点地图', position: '您的位置', finding: '正在定位…', checkingQr: '正在验证二维码…', qrUnavailable: '联网后才能验证二维码。', qrAccepted: '二维码有效。' },
};

const explorerText = {
  vi: { explore: 'Khám phá', title: 'Nghe chuyện', subtitle: 'từ mỗi miền.', kicker: 'Thuyết minh di sản Việt Nam', intro: 'Chọn điểm đến, nghe thuyết minh bằng ngôn ngữ của bạn và lưu những nơi muốn ghé.', places: 'Khám phá điểm đến', help: 'Tìm địa điểm theo vùng hoặc bật GPS để xem điểm gần bạn.', all: 'Tất cả', qr: 'Quét QR', admin: 'Quản trị', details: 'Xem địa điểm', loading: 'Đang tải điểm đến…', inside: 'Đang tham quan', transcript: 'Nội dung thuyết minh' },
  en: { explore: 'Explore', title: 'Hear the stories', subtitle: 'of every region.', kicker: 'Vietnam heritage audio guide', intro: 'Choose a destination, listen in your language and save the places you want to visit.', places: 'Explore destinations', help: 'Browse by region or turn on GPS to see places near you.', all: 'All regions', qr: 'Scan QR', admin: 'Admin', details: 'View destination', loading: 'Loading destinations…', inside: 'Visit in progress', transcript: 'Audio transcript' },
  zh: { explore: '探索', title: '聆听故事', subtitle: '走遍各地。', kicker: '越南文化遗产语音导览', intro: '选择目的地，用您的语言收听导览，并保存想去的景点。', places: '探索目的地', help: '按地区浏览，或开启 GPS 查找附近景点。', all: '全部地区', qr: '扫描二维码', admin: '管理', details: '查看景点', loading: '正在加载景点…', inside: '参观中', transcript: '讲解文字' },
};
const mediaText = {
  vi: { noAudio: 'Chưa có audio ghi sẵn', noTiles: 'Không tải được nền OpenStreetMap. Các điểm tham quan vẫn có thể chọn.', noPois: 'Hiện chưa có điểm tham quan được công khai.', qrPoiHidden: 'Mã QR hợp lệ. Điểm liên kết hiện chưa công khai.' },
  en: { noAudio: 'No recorded audio available', noTiles: 'The OpenStreetMap background is unavailable. You can still select destinations.', noPois: 'No destinations are currently published.', qrPoiHidden: 'QR code accepted. The linked destination is unavailable.' },
  zh: { noAudio: '暂无录制音频', noTiles: '无法加载 OpenStreetMap 底图。仍可选择景点。', noPois: '暂无已公开景点。', qrPoiHidden: '二维码有效。关联景点暂未公开。' },
};
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

function getVietnamRegion(poi: Poi): VietnamRegion | undefined {
  const code = poi.regionCode;
  return code === 'north' || code === 'central' || code === 'south' ? code : undefined;
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
    listen: 'Nghe thuyết minh',
    stop: 'Dừng đọc',
    openMap: '🌐 Mở trên Google Maps',
    selectPrompt: '📍 Vui lòng chọn một địa điểm ở danh sách bên trái',
    qrTitle: '📲 Quét QR để ghi nhận lượt tham quan',
    qrDescription: 'Quét mã để ghi nhận lượt tham quan. Bạn có thể tự bấm kết thúc hoặc chủ động bật GPS để tự kết thúc khi ra khỏi bán kính.',
    visitorTitle: 'Ghi nhận lượt tham quan',
    visitorCheckIn: 'Đang ghi nhận lượt vào...',
    visitorCheckInFailed: 'Không thể ghi nhận lượt vào.',
    visitorExit: 'Kết thúc tham quan',
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
    listen: 'Listen to the audio guide',
    stop: 'Stop narration',
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
    listen: '收听语音导览',
    stop: '停止播放',
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
    visitStarted: '参观记录已开启',
    exploreTitle: '探索景点',
    destinationFilter: '搜索景点...',
    destinationDetails: '当前查看',
    noDestinationsFound: '没有找到符合条件的景点。',
    directions: '导航',
  },
};

export default function MapScreenWeb({ onQrResult }: { onQrResult?: (valid: boolean | null) => void } = {}) {
  const [currentLang, setCurrentLang] = useState(getUrlLanguage);
  const { pois, isLoading: isContentLoading, error: catalogError } = useBrowserPois(currentLang);
  const { languages, regions, optionsError } = useVisitorOptions();
  const offline = useOfflineDownload(currentLang);
  const uiLang = interfaceLanguage(currentLang);
  const audioText = playbackText[uiLang];
  const media = mediaText[uiLang];
  const qrCode = new URLSearchParams(window.location.search).get('qr');
  const { session, sessionError, track } = useVisitorSession(qrCode, currentLang);
  useEffect(() => {
    if (qrCode === null) return;
    if (sessionError) onQrResult?.(null); // không xác thực được (mất mạng / lỗi máy chủ)
    else if (session && session.qr_valid !== null) onQrResult?.(session.qr_valid);
  }, [qrCode, session, sessionError, onQrResult]);
  const { play, stop: handleStopSpeech, playback, seek, error: playbackError } = useNarration(currentLang, Boolean(catalogError), track, audioText);
  const [searchQuery, setSearchQuery] = useState('');
  const [catalogRegion, setCatalogRegion] = useState<VietnamRegion | 'all'>('all');
  const detailsRef = useRef<HTMLDialogElement>(null);
  const routeDialogRef = useRef<HTMLDialogElement>(null);
  const [selectedPoiDraft, setSelectedPoi] = useState<Poi | null>(null);
  const [detail, setDetail] = useState<{ poi: Poi; lang: string } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailError, setDetailError] = useState('');
  const selectedPoi = detail?.lang === currentLang && detail.poi.id === selectedPoiDraft?.id && detailOpen
    ? detail.poi : pois.find((poi) => poi.id === selectedPoiDraft?.id) ?? null;
  const openedLink = useRef<string | null>(null);
  const [isLocationTracking, setIsLocationTracking] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [location, setLocation] = useState<WebGeofenceLocation | null>(null);
  const [locationError, setLocationError] = useState('');
  const [geofenceArrivalPoiId, setGeofenceArrivalPoiId] = useState<string | null>(null);
  const geofenceState = useRef(createGeofenceRuntimeState());
  const lastVisitedPoi = useRef<string | null>(null);
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

  const visitorParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const pathPoiId = window.location.pathname.startsWith('/poi/') ? parsePoiQr(window.location.href)?.poiId : null;
  const managedPoi = session?.qr_valid && session.poi_id !== null
    ? pois.find((poi) => poi.backendId === session.poi_id) : undefined;
  const rawPoiId = qrCode === null ? visitorParams?.get('poi') ?? visitorParams?.get('story') ?? pathPoiId : null;
  const visitorPoiId = rawPoiId && /^\d+$/.test(rawPoiId) ? `poi-${rawPoiId}` : rawPoiId ?? null;
  const visitorMode = Boolean(session?.web_visits && visitorParams?.get('visit') === '1' && qrCode === null);
  const visitorPoi = pois.find(poi => poi.id === visitorPoiId) ?? null;
  const geofenceArrivalPoi = pois.find((poi) => poi.id === geofenceArrivalPoiId) ?? null;

  const t = uiText[uiLang];
  useEffect(() => {
    if (visitorMode && visitorPoi && lastVisitedPoi.current !== visitorPoi.id) {
      lastVisitedPoi.current = visitorPoi.id;
      track('view_poi', visitorPoi.backendId);
    }
  }, [track, visitorMode, visitorPoi]);

  useEffect(() => {
    const dialog = routeDialogRef.current;
    if (isRoutePickerOpen && dialog && !dialog.open) dialog.showModal();
    if (!isRoutePickerOpen && dialog?.open) dialog.close();
  }, [isRoutePickerOpen]);

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
        setLocationError('');
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
        setLocation(null);
        if (!('code' in error) || error.code === 1) {
          if (isAutoCheckoutEnabled) setIsAutoCheckoutEnabled(false);
          if (isLocationTracking) setIsLocationTracking(false);
        }
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
    setRoutePoiIds((current) =>
      current.includes(poiId)
        ? current.filter((id) => id !== poiId)
        : [...current, poiId],
    );
    setRouteSaved(false);
  };

  const toggleRouteRegion = (region: VietnamRegion) => {
    const regionPoiIds = pois
      .filter((poi) => getVietnamRegion(poi) === region)
      .map((poi) => poi.id);
    if (regionPoiIds.length === 0) return;

    setRoutePoiIds((current) => {
      const regionIsSelected = regionPoiIds.some((poiId) => current.includes(poiId));
      return regionIsSelected
        ? current.filter((poiId) => !regionPoiIds.includes(poiId))
        : [...current, ...regionPoiIds.filter((poiId) => !current.includes(poiId))];
    });
    setRouteSaved(false);
  };

  const beginDesktopRouteSelection = () => {
    setVisitorError('');
    setIsRoutePickerOpen(true);
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
    } catch (error) {
      setVisitorError(error instanceof Error ? error.message : t.clearRouteFailed);
    } finally {
      setIsClearingRoute(false);
    }
  };

  // Hàm kích hoạt giọng đọc trình duyệt (TTS) theo đúng ngôn ngữ hiện tại
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
    if (autoplay && !playback && !document.hidden) {
      setSelectedPoi(poi);
      void play(poi);
    }
  }, [autoplay, isLocationTracking, location, play, playback, pois]);

  const filteredPois = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const matches = pois.filter((poi) => {
      const content = poi.content;
      return content.name.toLowerCase().includes(query) || content.description.toLowerCase().includes(query);
    });
    if (location) matches.sort((a, b) => evaluatePoi(location, a).distanceMeters - evaluatePoi(location, b).distanceMeters);
    return matches;
  }, [currentLang, location, pois, searchQuery]);
  const visiblePois = useMemo(() => catalogRegion === 'all' ? filteredPois :
    filteredPois.filter((poi) => getVietnamRegion(poi) === catalogRegion), [catalogRegion, filteredPois]);

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
    const destination = `https://www.google.com/maps/search/?api=1&query=${poi.latitude},${poi.longitude}`;
    void Linking.openURL(destination);
  };


  const ui = explorerText[uiLang];
  const changeLanguage = (language: string) => {
    handleStopSpeech();
    saveLanguage(language);
    track('change_lang', undefined, language);
    setCurrentLang(language);
  };
  const poiName = (poi: Poi) => poi.content.name;
  const narration = (poi: Poi) => poi.content.description;
  const openPoi = useCallback((poi: Poi) => {
    handleStopSpeech();
    setSelectedPoi(poi);
    track('view_poi', poi.backendId);
    setDetailOpen(true);
    if (!detailsRef.current?.open) detailsRef.current?.showModal();
  }, [handleStopSpeech, track]);
  useEffect(() => {
    const linkedPoi = managedPoi || (!visitorMode && visitorPoi);
    if (!linkedPoi || openedLink.current === linkedPoi.id ||
        (visitorParams?.get('visit') === '1' && !session && !sessionError)) return;
    openedLink.current = linkedPoi.id;
    openPoi(linkedPoi);
  }, [managedPoi, openPoi, session, sessionError, visitorMode, visitorParams, visitorPoi]);

  const activeDetailId = detailOpen ? selectedPoiDraft?.backendId : undefined;
  useEffect(() => {
    if (activeDetailId === undefined || !navigator.onLine) return;
    let active = true;
    setDetailError('');
    void getPoiDetail(activeDetailId, currentLang).then((poi) => {
      if (active) setDetail({ poi, lang: currentLang });
    }).catch((error: unknown) => {
      if (active) setDetailError(error instanceof Error ? error.message : 'Không tải được chi tiết điểm tham quan.');
    });
    return () => { active = false; };
  }, [activeDetailId, currentLang]);

  const audioControl = (poi: Poi) => {
    const content = poi.content;
    const state = playback?.poiId === poi.id ? playback : null;
    const languageName = languages.find(({ code }) => code === content.lang)?.name ?? content.lang.toUpperCase();
    const mode = state?.mode === 'speech' ? audioText.speech : content.audio_url ? audioText.recording : media.noAudio;
    return <div className="heritage-narration">
      <AudioControl title={state?.playing ? audioText.pause : t.listen}
        subtitle={`${mode} · ${content.is_fallback ? `${audioText.fallback} · ` : ''}${languageName}`}
        playing={Boolean(state?.playing)} onPress={() => void play(poi)} />
      {state && <div className="heritage-narration-actions">
        {state.duration > 0 && <input type="range" aria-label={audioText.progress} min={0} max={state.duration}
          step={0.1} value={state.position} onChange={(event) => seek(event.currentTarget.valueAsNumber)} />}
        <button type="button" className="heritage-button" onClick={handleStopSpeech}>{t.stop}</button>
      </div>}
      {playbackError?.poiId === poi.id && <p role="alert" className="heritage-error">{playbackError.text}</p>}
    </div>;
  };
  const offlineControl = offline.supported && <div className="heritage-offline">
    <button className="heritage-button" type="button" disabled={offline.isDownloading} onClick={() => void offline.download()}>{audioText.offline}</button>
    {offline.status && <p role="status">{offline.status}</p>}
  </div>;
  const autoplayControl = <label className="heritage-visit-setting">
    {audioText.auto}
    <input type="checkbox" role="switch" checked={autoplay}
      onChange={(event) => { setAutoplay(event.currentTarget.checked); if (event.currentTarget.checked && !isLocationTracking) toggleLocationTracking(); }} />
  </label>;
  if (visitorMode) {
    return (

      <main className="heritage-visit" lang={currentLang}>
        <HeritageHeader>
          <LanguageSelect value={currentLang} languages={languages} onChange={changeLanguage} />
        </HeritageHeader>
        <View style={styles.visitorContent}>
          <section className="heritage-visit-feature">
            {visitorPoi?.images.length ? <div className="heritage-card-media"><PoiPhoto poi={visitorPoi} eager /></div> : null}
            <div className="heritage-visit-copy">
              {visitorStatus === 'inside' && <span className="heritage-visit-status">{ui.inside}</span>}
              <h1 className="heritage-title">{visitorPoi ? poiName(visitorPoi) : t.visitorTitle}</h1>
              {visitorPoi && <><p>{narration(visitorPoi)}</p>
                <p>{t.coordLabel} · {visitorPoi.latitude}, {visitorPoi.longitude}</p>
                {audioControl(visitorPoi)}</>}
              {visitorStatus === 'inside' && visitorPoi ? (
                <>
                  <p>{formatVisitTimestamp(visitorEnteredAt, uiLang)}</p>
                  <div className="heritage-visit-actions">
                    <button className="heritage-button" onClick={() => document.getElementById('visit-itinerary')?.scrollIntoView({ block: 'start' })}><Icon name="route" />{t.routeButton}</button>
                    <button className="heritage-button" onClick={() => openGoogleMaps(visitorPoi)}><Icon name="map" />{t.directions}</button>
                  </div>
                  <label className="heritage-visit-setting" title={t.autoExitHelp}>
                    {t.enableAutoExit}
                    <input type="checkbox" role="switch" checked={isAutoCheckoutEnabled} onChange={() => {
                      setVisitorError('');
                      setIsAutoCheckoutEnabled((enabled) => !enabled);
                    }} />
                  </label>
                  <details className="heritage-visit-help"><summary>GPS</summary><p>{t.autoExitHelp}</p></details>
                  <button className="heritage-button heritage-visit-exit" onClick={() => void handleVisitorAction('check-out')}>{t.visitorExit}</button>
                </>
              ) : (
                <p role="status">
                  {visitorStatus === 'loading' || isContentLoading
                    ? visitorRetryAction === 'check-out' ? t.visitorExitProgress : t.visitorCheckIn
                    : visitorStatus === 'exited' ? t.visitorExitSuccess
                    : visitorStatus === 'deleted' ? t.visitDeleted
                    : visitorError || t.visitorInvalidQr}
                </p>
              )}
            </div>
          </section>

          {catalogError && <p role="status">{catalogError}</p>}
          {offlineControl}
          {autoplayControl}
          {locationError && <p className="heritage-error" role="alert">{locationError}</p>}
          {visitorStatus === 'inside' && <button className="heritage-button" style={{ marginBottom: 12 }} aria-pressed={isLocationTracking} onClick={toggleLocationTracking}><Icon name="gps" />{isLocationTracking ? t.disableLocation : t.enableLocation}</button>}
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
                  {formatVisitTimestamp(visitorEnteredAt, uiLang) ??
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
                  {formatVisitTimestamp(visitorExitedAt, uiLang) ??
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
                      const regionPois = pois.filter((poi) => getVietnamRegion(poi) === region);
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
                            {poi.content.name}
                          </Text>
                          <Text style={styles.routeOptionDescription} numberOfLines={2}>
                            {poi.content.description}
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
                    {poiName(selectedPoi)}
                  </Text>
                  <Text style={styles.detailDescription}>
                    {narration(selectedPoi)}
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
                  {audioControl(selectedPoi)}
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

          <div id="visit-itinerary">
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
                    <Text style={styles.routeStopName}>{poi.content.name}</Text>
                    <TouchableOpacity
                      accessibilityLabel={t.directions}
                      style={styles.moveButton}
                      onPress={() => openGoogleMaps(poi)}
                    >
                      <Text style={styles.moveButtonText}>↗</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      accessibilityLabel={t.moveUp}
                      style={styles.moveButton}
                      disabled={visitorStatus !== 'inside'}
                      onPress={() => moveRouteStop(poiId, -1)}
                    >
                      <Text style={styles.moveButtonText}>↑</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      accessibilityLabel={t.moveDown}
                      style={styles.moveButton}
                      disabled={visitorStatus !== 'inside'}
                      onPress={() => moveRouteStop(poiId, 1)}
                    >
                      <Text style={styles.moveButtonText}>↓</Text>
                    </TouchableOpacity>
                  </View>
                );
              })
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

          </div>
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
        </View>
      </main>
    );
  }

  const featuredPoi = managedPoi || (pois[0] && !isContentLoading ? pois[0] : null);

  return (
    <div className="heritage-page" lang={currentLang}>
      <HeritageHeader>
        <nav className="heritage-nav" aria-label={ui.explore}>
          <span className="heritage-nav-current" aria-current="page">{ui.explore}</span>
          <button className="heritage-button" onClick={beginDesktopRouteSelection}><Icon name="route" />{t.routeButton}{routePoiIds.length ? ` · ${routePoiIds.length}` : ''}</button>
          <LanguageSelect value={currentLang} languages={languages} onChange={changeLanguage} />
          <a className="heritage-button heritage-primary" href={`/?scan=1&lang=${currentLang}`}><Icon name="qr" />{ui.qr}</a>
        </nav>
      </HeritageHeader>
      <main className="heritage-main">
        {qrCode !== null && <p role="status" className={sessionError || session?.qr_valid === false ? 'heritage-error' : undefined}>
          {sessionError ? audioText.qrUnavailable : !session || isContentLoading ? audioText.checkingQr
            : session.qr_valid ? managedPoi ? `${audioText.qrAccepted} ${managedPoi.content.name}`
              : session.poi_id === null ? audioText.qrAccepted : catalogError || media.qrPoiHidden : t.visitorInvalidQr}
        </p>}
        <section className="heritage-hero">
          <div className="heritage-copy">
            <span className="heritage-eyebrow">{ui.kicker}</span>
            <h1>{ui.title}<br /><span>{ui.subtitle}</span></h1>
            <p>{ui.intro}</p>
            {featuredPoi && narration(featuredPoi) && audioControl(featuredPoi)}
          </div>
          {featuredPoi?.images.length ? (
            <figure className="heritage-media">
              <PoiPhoto poi={featuredPoi} eager />
              <figcaption><Icon name="pin" />{poiName(featuredPoi)}</figcaption>
            </figure>
          ) : null}
        </section>
        {geofenceArrivalPoi && location && (
          <section className="heritage-detail" aria-live="polite">
            <strong>{t.geofenceArrival}: {poiName(geofenceArrivalPoi)}</strong>
            <p>{t.geofenceDistance}: {formatDistance(evaluatePoi(location, geofenceArrivalPoi).distanceMeters)}</p>
            {narration(geofenceArrivalPoi) && audioControl(geofenceArrivalPoi)}
          </section>
        )}
        {locationError && <p role="alert" className="heritage-error">{locationError}</p>}
        <section className="heritage-section" aria-labelledby="destination-list">
          <div className="heritage-section-heading">
            <div><h2 id="destination-list">{ui.places}</h2><p>{ui.help}</p></div>
            <label className="heritage-search">
              <Icon name="search" />
              <input type="search" aria-label={t.searchPlaceholder} placeholder={t.searchPlaceholder} value={searchQuery} onChange={(event) => setSearchQuery(event.currentTarget.value)} />
            </label>
          </div>
          <div className="heritage-filters">
            {(['all', ...regions.map(({ code }) => code).filter((code): code is VietnamRegion =>
              code === 'north' || code === 'central' || code === 'south')] as const).map((region) => (
              <button key={region} className="heritage-button" aria-pressed={catalogRegion === region} onClick={() => setCatalogRegion(region)}>
                {region === 'all' ? ui.all : t.regions[region]}
              </button>
            ))}
            <button className="heritage-button heritage-gps" aria-pressed={isLocationTracking} onClick={toggleLocationTracking}>
              <Icon name="gps" />{isLocationTracking ? t.disableLocation : t.enableLocation}
            </button>
            {autoplayControl}
          </div>
          {isLocationTracking && <p role="status">{location ? `${audioText.position} · ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : audioText.finding}</p>}
          {catalogError && <p role="status">{catalogError}</p>}
          {optionsError && <p role="status">{optionsError}</p>}
          {offlineControl}
          {isContentLoading && <p role="status">{ui.loading}</p>}
          {!isContentLoading && !visiblePois.length && (!catalogError || pois.length > 0) && <p role="status">{pois.length ? t.noDestinationsFound : media.noPois}</p>}
          <PoiMap pois={visiblePois} position={location} label={audioText.map} positionLabel={audioText.position} tileErrorLabel={media.noTiles} select={openPoi} />
          <div className="heritage-grid">
            {visiblePois.map((poi, index) => {
              const onRoute = routePoiIds.includes(poi.id);
              return (
                <article className="heritage-card" key={poi.id}>
                  {poi.images.length > 0 && <div className="heritage-card-media"><PoiPhoto poi={poi} eager={index < 3} /></div>}
                  <div className="heritage-card-body">
                    <div className="heritage-card-meta"><Icon name="pin" />
                      {regions.find(({ code }) => code === poi.regionCode)?.name_vi}
                      {location && ` · ${formatDistance(evaluatePoi(location, poi).distanceMeters)}`}
                    </div>
                    <h3>{poiName(poi)}</h3>
                    <div className="heritage-card-actions">
                      <button className="heritage-button heritage-link" onClick={() => openPoi(poi)}><Icon name="arrow" />{ui.details}</button>
                      <button className="heritage-button" aria-pressed={onRoute} onClick={() => toggleRoutePoi(poi.id)}>
                        <Icon name={onRoute ? 'check' : 'add'} />{onRoute ? t.removeStop : t.addStop}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
        <footer className="heritage-footer">
          <a href="/admin">{ui.admin}</a>
        </footer>
      </main>
      <dialog className="heritage-dialog" ref={detailsRef} aria-labelledby="destination-details" onClose={() => {
        handleStopSpeech();
        setDetailOpen(false);
        setDetailError('');
      }}>
        {selectedPoi && (
          <section className="heritage-detail">
            <h2 id="destination-details">{poiName(selectedPoi)}</h2>
            {detailError && <p role="alert" className="heritage-error">{detailError}</p>}
            {selectedPoi.images.length > 0 && <div className="heritage-detail-media"><PoiPhoto poi={selectedPoi} /></div>}
            <p lang={selectedPoi.content.lang}>{narration(selectedPoi)}</p>
            <p>{t.coordLabel}: {selectedPoi.latitude}, {selectedPoi.longitude} · {t.radiusLabel}: {selectedPoi.radiusMeters} {t.metersUnit}</p>
            {audioControl(selectedPoi)}
            <div className="heritage-card-actions">
              <button className="heritage-button" onClick={() => openGoogleMaps(selectedPoi)}><Icon name="map" />{t.directions}</button>
              <button className="heritage-button" onClick={() => detailsRef.current?.close()} aria-label={currentLang === 'vi' ? 'Đóng' : currentLang === 'en' ? 'Close' : '关闭'}>×</button>
            </div>
          </section>
        )}
      </dialog>
      <dialog className="heritage-dialog" ref={routeDialogRef} aria-label={t.routeTitle} onClose={() => setIsRoutePickerOpen(false)}>
          <div>
            <View style={styles.desktopRouteDialogHeader}>
              <View style={styles.routeOptionCopy}>
                <Text style={styles.routeTitle}>{t.routeTitle} · {routePoiIds.length}</Text>
                <Text style={styles.routeHelp}>{t.routeHelp}</Text>
              </View>
              <TouchableOpacity
                style={styles.moveButton}
                accessibilityRole="button"
                accessibilityLabel={t.closeRoutePicker}
                onPress={() => setIsRoutePickerOpen(false)}
              >
                <Text style={styles.moveButtonText}>×</Text>
              </TouchableOpacity>
            </View>
            <div className="heritage-dialog-body">
              <Text style={styles.routeHelp}>{t.regionHelp}</Text>
              {visitorStatus !== 'inside' && (
                <Text style={styles.routeControlHint}>{t.routeCanEditBeforeCheckIn}</Text>
              )}
              {(['south', 'north', 'central'] as VietnamRegion[]).map((region) => {
                const regionPois = pois.filter((poi) => getVietnamRegion(poi) === region);
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
                      <Text style={styles.routeOptionName}>{poi.content.name}</Text>
                      <Text style={styles.routeOptionDescription} numberOfLines={2}>
                        {poi.content.description}
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
                    <Text style={styles.routeStopName}>{poi.content.name}</Text>
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
            </div>
            <div className="heritage-dialog-footer">
              {routePoiIds.length > 0 && (
                <TouchableOpacity
                  style={styles.clearRouteButton}
                    disabled={isClearingRoute || isSavingRoute}
                  onPress={() => void handleClearRoute()}
                >
                  <Text style={styles.clearRouteButtonText}>
                    {isClearingRoute ? t.clearingRoute : t.clearRoute}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  (routePoiIds.length === 0 || isSavingRoute) && styles.buttonDisabled,
                ]}
                disabled={routePoiIds.length === 0 || isSavingRoute}
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
            </div>
          </div>
      </dialog>
    </div>
  );
}

const styles = StyleSheet.create({
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
  desktopRouteDialogHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#dedbd0',
  },
  poiIndex: {
    color: '#829281',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 8,
  },
  eyebrow: {
    color: '#738571',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  detailDescription: {
    fontSize: 15,
    color: '#546057',
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
    color: '#fffcf6',
    fontSize: 14,
    fontWeight: '800',
  },
  visitorContent: {
    width: '100%',
    maxWidth: 610,
    marginHorizontal: 'auto',
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 48,
  },
  visitRecordPanel: {
    backgroundColor: '#fffcf6',
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
    backgroundColor: '#fffcf6',
    borderWidth: 1,
    borderColor: '#dedbd0',
    borderRadius: 20,
    padding: 24,
    marginBottom: 16,
  },
  routeTitle: {
    color: '#202a23',
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
  routeOptionSelected: {
    borderColor: '#9bd9aa',
    backgroundColor: '#effaf2',
  },
  routeOptionCopy: {
    flex: 1,
  },
  visitorDestinationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#dedbd0',
    borderRadius: 13,
    padding: 13,
    marginBottom: 9,
    backgroundColor: '#fffcf6',
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
    backgroundColor: '#fffcf6',
    borderWidth: 1,
    borderColor: '#dedbd0',
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
  },
  visitorDetailTitle: {
    color: '#202a23',
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
    color: '#fffcf6',
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
});
