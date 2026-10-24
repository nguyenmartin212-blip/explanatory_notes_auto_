// src/screens/MapScreen.web.tsx
import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, TextInput, Linking } from 'react-native';
import { mockPois } from '../features/poi/mockData';
import type { Poi } from '../features/poi/types';
import { apiPost } from '../services/apiClient';

type LanguageKey = 'vi' | 'en' | 'zh';
type VisitorStatus = 'idle' | 'loading' | 'inside' | 'exited' | 'error';
type VisitorResponse = {
  status: 'inside' | 'exited';
  entered_at: string;
  exited_at: string | null;
  saved_itinerary: { poi_ids: string[] } | null;
};

const VISITOR_ID_KEY = 'visitor_visit_id';
const VISITOR_POI_KEY = 'visitor_poi_id';

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
    qrDescription: 'Quét mã bằng điện thoại để ghi nhận thời gian vào. Khi rời đi, bấm nút trên điện thoại.',
    anonymousNotice: 'Chỉ lưu mã ẩn danh, địa điểm và thời gian; không thu thập tên hoặc số điện thoại.',
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
    visitorInvalidQr: 'Mã QR không hợp lệ hoặc không có địa điểm tham quan.',
    brand: 'GO TO HORIZON',
    webTitle: 'Chạm vào di sản Việt Nam',
    webSubtitle: 'Khám phá những điểm đến nổi bật và nghe câu chuyện phía sau mỗi địa danh.',
    locationLabel: 'ĐIỂM ĐẾN',
    detailsLabel: 'THÔNG TIN ĐIỂM ĐẾN',
    terminalQrHint: 'Mã QR mở web được in trong terminal khi chạy npm run web.',
    routeTitle: 'Lộ trình của bạn',
    routeHelp: 'Chọn các điểm muốn ghé. Thứ tự bạn thêm sẽ là thứ tự hành trình.',
    routeEmpty: 'Chưa chọn điểm dừng nào.',
    addStop: 'Thêm vào lộ trình',
    removeStop: 'Bỏ khỏi lộ trình',
    moveUp: 'Lên',
    moveDown: 'Xuống',
    saveRoute: 'Lưu lộ trình',
    savingRoute: 'Đang lưu lộ trình...',
    routeSaved: 'Đã lưu lộ trình vào hồ sơ lượt tham quan.',
    routeSaveFailed: 'Không thể lưu lộ trình. Vui lòng thử lại.',
    chooseStops: 'Chọn điểm dừng',
    visitStarted: 'Lượt tham quan đang hoạt động',
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
    qrDescription: 'Scan with your phone to record arrival. Tap the button on your phone when you leave.',
    anonymousNotice: 'Only an anonymous ID, location, and timestamps are stored; no name or phone number.',
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
    visitorInvalidQr: 'This QR code is invalid or does not identify a location.',
    brand: 'GO TO HORIZON',
    webTitle: 'Discover Vietnam’s heritage',
    webSubtitle: 'Explore remarkable places and hear the stories behind each destination.',
    locationLabel: 'DESTINATIONS',
    detailsLabel: 'DESTINATION DETAILS',
    terminalQrHint: 'The web QR code is printed in the terminal when you run npm run web.',
    routeTitle: 'Your itinerary',
    routeHelp: 'Choose places to visit. The order you add them becomes your route.',
    routeEmpty: 'No stops selected yet.',
    addStop: 'Add to itinerary',
    removeStop: 'Remove from itinerary',
    moveUp: 'Up',
    moveDown: 'Down',
    saveRoute: 'Save itinerary',
    savingRoute: 'Saving itinerary...',
    routeSaved: 'Your itinerary has been saved to this visit.',
    routeSaveFailed: 'Could not save the itinerary. Please try again.',
    chooseStops: 'Choose stops',
    visitStarted: 'Your visit is active',
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
    qrDescription: '使用手机扫码记录到达时间；离开时请点击手机上的按钮。',
    anonymousNotice: '仅保存匿名编号、地点和时间，不收集姓名或电话号码。',
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
    visitorInvalidQr: '二维码无效或未指定参观点。',
    brand: 'GO TO HORIZON',
    webTitle: '探索越南文化遗产',
    webSubtitle: '探索特色景点，聆听每个目的地背后的故事。',
    locationLabel: '目的地',
    detailsLabel: '目的地详情',
    terminalQrHint: '运行 npm run web 时，二维码会显示在终端中。',
    routeTitle: '您的行程',
    routeHelp: '选择要游览的地点，添加顺序就是行程顺序。',
    routeEmpty: '尚未选择地点。',
    addStop: '加入行程',
    removeStop: '移出行程',
    moveUp: '上移',
    moveDown: '下移',
    saveRoute: '保存行程',
    savingRoute: '正在保存行程...',
    routeSaved: '行程已保存至本次参观记录。',
    routeSaveFailed: '无法保存行程，请重试。',
    chooseStops: '选择地点',
    visitStarted: '参观记录已开启',
    directions: '导航',
  },
};

export default function MapScreenWeb() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPoi, setSelectedPoi] = useState<Poi | null>(mockPois[0] || null);
  const [currentLang, setCurrentLang] = useState<LanguageKey>('vi');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [visitorStatus, setVisitorStatus] = useState<VisitorStatus>('idle');
  const [visitorVisitId, setVisitorVisitId] = useState<string | null>(null);
  const [visitorEnteredAt, setVisitorEnteredAt] = useState<string | null>(null);
  const [visitorExitedAt, setVisitorExitedAt] = useState<string | null>(null);
  const [visitorError, setVisitorError] = useState('');
  const [visitorRetryAction, setVisitorRetryAction] = useState<'check-in' | 'check-out'>('check-in');
  const [routePoiIds, setRoutePoiIds] = useState<string[]>([]);
  const [routeSaved, setRouteSaved] = useState(false);
  const [isSavingRoute, setIsSavingRoute] = useState(false);

  const visitorParams = typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search);
  const visitorMode = visitorParams?.get('visit') === '1';
  const visitorPoiId = visitorParams?.get('poi') ?? null;
  const visitorPoi = mockPois.find(poi => poi.id === visitorPoiId) ?? null;

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
    if (!visitorMode) return;

    const visitPoi = mockPois.find(poi => poi.id === visitorPoiId) ?? null;
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
  }, [visitorMode, visitorPoiId, t.visitorCheckInFailed, t.visitorInvalidQr]);

  const handleVisitorAction = async (action: 'check-in' | 'check-out') => {
    if (!visitorVisitId || !visitorPoi) return;

    setVisitorRetryAction(action);
    setVisitorStatus('loading');
    setVisitorError('');
    try {
      const visit = await apiPost<VisitorResponse>(`/api/visitors/${action}`, {
        visit_id: visitorVisitId,
        ...(action === 'check-in' ? { poi_id: visitorPoi.id } : {}),
      });

      setVisitorEnteredAt(visit.entered_at);
      setVisitorExitedAt(visit.exited_at);
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
    if (!visitorVisitId || routePoiIds.length === 0) return;

    setIsSavingRoute(true);
    setVisitorError('');
    try {
      await apiPost('/api/visitors/itinerary', {
        visit_id: visitorVisitId,
        poi_ids: routePoiIds,
      });
      setRouteSaved(true);
    } catch (error) {
      setVisitorError(error instanceof Error ? error.message : t.routeSaveFailed);
      setRouteSaved(false);
    } finally {
      setIsSavingRoute(false);
    }
  };

  // Hàm kích hoạt giọng đọc trình duyệt (TTS) theo đúng ngôn ngữ hiện tại
  const handleSpeak = (text?: string) => {
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
  };

  const handleStopSpeech = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  };

  const filteredPois = mockPois.filter(item => {
    const nameText = item.name?.[currentLang]?.toLowerCase() || item.name?.vi?.toLowerCase() || '';
    const descText = item.description?.[currentLang]?.toLowerCase() || item.description?.vi?.toLowerCase() || '';
    const query = searchQuery.toLowerCase();
    return nameText.includes(query) || descText.includes(query);
  });

  const openGoogleMaps = (mapUrl?: string) => {
    if (mapUrl) {
      Linking.openURL(mapUrl);
    }
  };

  if (visitorMode) {
    return (
      <View style={styles.visitorContainer}>
        <View style={styles.visitorHeader}>
          <Text style={styles.brand}>{t.brand}</Text>
          <Text style={styles.visitorStatus}>
            {visitorStatus === 'inside'
              ? t.recordActive
              : visitorStatus === 'exited'
                ? t.recordComplete
                : visitorStatus === 'loading'
                  ? t.visitorCheckIn
                  : t.visitorTitle}
          </Text>
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
                    : visitorError || t.visitorInvalidQr}
            </Text>
            <Text style={styles.visitorNotice}>{t.anonymousNotice}</Text>
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
                <Text style={styles.visitRecordLabel}>{t.checkOutRecord}</Text>
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
          </View>

          {visitorStatus === 'inside' && (
            <>
              <View style={styles.routePanel}>
                <Text style={styles.routeTitle}>{t.routeTitle}</Text>
                <Text style={styles.routeHelp}>{t.routeHelp}</Text>
                <Text style={styles.sectionLabel}>{t.chooseStops}</Text>
                {mockPois.map((poi) => {
                  const selected = routePoiIds.includes(poi.id);
                  return (
                    <TouchableOpacity
                      key={poi.id}
                      style={[styles.routeOption, selected && styles.routeOptionSelected]}
                      onPress={() => toggleRoutePoi(poi.id)}
                    >
                      <View style={[styles.routeCheckbox, selected && styles.routeCheckboxSelected]}>
                        <Text style={styles.routeCheckboxText}>{selected ? '✓' : '+'}</Text>
                      </View>
                      <View style={styles.routeOptionCopy}>
                        <Text style={styles.routeOptionName}>{poi.name?.[currentLang] || poi.name?.vi}</Text>
                        <Text style={styles.routeOptionDescription} numberOfLines={2}>
                          {poi.description?.[currentLang] || poi.description?.vi}
                        </Text>
                      </View>
                      <Text style={styles.routeAction}>{selected ? t.removeStop : t.addStop}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.routePanel}>
                <Text style={styles.routeTitle}>{t.routeTitle} · {routePoiIds.length}</Text>
                {routePoiIds.length === 0 ? (
                  <Text style={styles.routeHelp}>{t.routeEmpty}</Text>
                ) : (
                  routePoiIds.map((poiId, index) => {
                    const poi = mockPois.find((item) => item.id === poiId);
                    if (!poi) return null;
                    return (
                      <View key={poiId} style={styles.routeStop}>
                        <Text style={styles.routeStopNumber}>{String(index + 1).padStart(2, '0')}</Text>
                        <Text style={styles.routeStopName}>{poi.name?.[currentLang] || poi.name?.vi}</Text>
                        <TouchableOpacity
                          accessibilityLabel={t.moveUp}
                          style={styles.moveButton}
                          onPress={() => moveRouteStop(poiId, -1)}
                        >
                          <Text style={styles.moveButtonText}>↑</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          accessibilityLabel={t.moveDown}
                          style={styles.moveButton}
                          onPress={() => moveRouteStop(poiId, 1)}
                        >
                          <Text style={styles.moveButtonText}>↓</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })
                )}
                <TouchableOpacity
                  style={[styles.primaryButton, (routePoiIds.length === 0 || isSavingRoute) && styles.buttonDisabled]}
                  disabled={routePoiIds.length === 0 || isSavingRoute}
                  onPress={() => void handleSaveRoute()}
                >
                  <Text style={styles.primaryButtonText}>
                    {isSavingRoute ? t.savingRoute : t.saveRoute}
                  </Text>
                </TouchableOpacity>
                {routeSaved && <Text style={styles.successMessage}>{t.routeSaved}</Text>}
                {visitorError && <Text style={styles.errorMessage}>{visitorError}</Text>}
              </View>
            </>
          )}

          {visitorStatus === 'inside' && (
            <TouchableOpacity style={styles.exitButton} onPress={() => void handleVisitorAction('check-out')}>
              <Text style={styles.exitButtonText}>{t.visitorExit}</Text>
            </TouchableOpacity>
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
        <View style={styles.languageDock}>
          {(['vi', 'en', 'zh'] as LanguageKey[]).map((lang) => (
            <TouchableOpacity
              key={lang}
              style={[styles.languageButton, currentLang === lang && styles.languageButtonActive]}
              onPress={() => setCurrentLang(lang)}
            >
              <Text style={[styles.languageText, currentLang === lang && styles.languageTextActive]}>
                {lang.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
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
      <View style={styles.contentRow}>
        <View style={styles.sidebar}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>{t.locationLabel}</Text>
        </View>

        <TextInput
          style={styles.searchInput}
          placeholder={t.searchPlaceholder}
          placeholderTextColor="#888"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />

        <ScrollView style={styles.poiScroll}>
          {filteredPois.map((poi, index) => {
            const isSelected = selectedPoi?.id === poi.id;
            return (
              <TouchableOpacity 
                key={poi.id} 
                style={[styles.poiCard, isSelected && styles.poiCardSelected]}
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
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

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
              onPress={() => openGoogleMaps(selectedPoi.mapUrl)}
            >
              <Text style={styles.mapButtonText}>↗  {t.directions}</Text>
            </TouchableOpacity>
            <View style={styles.terminalHint}>
              <Text style={styles.terminalHintIcon}>▦</Text>
              <Text style={styles.terminalHintText}>{t.terminalQrHint}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.mapMockup}>
            <Text style={styles.mapMockupText}>{t.selectPrompt}</Text>
          </View>
        )}
      </View>
      </View>
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
    gap: 24,
    paddingHorizontal: 48,
    paddingVertical: 28,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2ebf4',
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
    width: 360,
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
  poiScroll: {
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
  terminalHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#edf7ff',
  },
  terminalHintIcon: {
    color: '#388557',
    fontSize: 22,
    fontWeight: '800',
  },
  terminalHintText: {
    flex: 1,
    color: '#758075',
    fontSize: 12,
    lineHeight: 18,
  },
  visitorContainer: {
    flex: 1,
    backgroundColor: '#f2f8ff',
  },
  visitorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 32,
    paddingVertical: 20,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2ebf4',
  },
  visitorStatus: {
    color: '#287548',
    fontSize: 12,
    fontWeight: '800',
    backgroundColor: '#e5f5e9',
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  visitorScroll: {
    flex: 1,
  },
  visitorContent: {
    width: '100%',
    maxWidth: 820,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 30,
    paddingBottom: 48,
  },
  visitorIntro: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e3edf5',
    borderRadius: 20,
    padding: 28,
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
    marginBottom: 14,
  },
  visitorNotice: {
    color: '#718397',
    fontSize: 12,
    lineHeight: 18,
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
    color: '#ffffff',
    fontSize: 14,
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
  languageDock: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    padding: 12,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2ebf4',
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