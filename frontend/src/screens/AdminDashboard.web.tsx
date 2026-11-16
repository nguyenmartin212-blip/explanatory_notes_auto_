import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native-web';
import { Brand, Icon, type IconName } from '../design/Heritage';
import { useBrowserPois } from '@/features/content/web-hooks';
import { ADMIN_PERMISSION_GROUPS, hasAdminPermission } from '@/features/admin/permissions';
import { DeviceUsagePanel } from '@/features/admin/DeviceUsagePanel';
import { AdminPoiPanel, AdminQrPanel, CreateAccountForm, VisitorStats } from '@/features/admin/ContentManagement';
import { useDeviceHeartbeat } from '@/features/admin/useDeviceHeartbeat';
import type { Poi } from '@/features/poi/types';
import {
  AdminApiError,
  adminLogin,
  adminLogout,
  assignUserRole,
  deleteAdminAccount,
  getAdminMe,
  getAdminRoles,
  getAdminUsers,
  getVisitorVisits,
  resetAccountPassword,
  setAccountActive,
  updateAdminRole,
  type AdminRole,
  type AdminUser,
  type VisitorVisit,
} from '@/services/adminApi';

type AdminTab = 'overview' | 'users' | 'roles' | 'visitors' | 'devices' | 'pois' | 'qr';
const PAGE_SIZE = 20;
const tabIcons: Record<AdminTab, IconName> = { overview: 'grid', users: 'users', roles: 'shield', visitors: 'qr', devices: 'chart', pois: 'pin', qr: 'qr' };

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function getPoiName(poi: Poi | undefined) {
  return poi?.content.name ?? poi?.id ?? 'Không rõ điểm đến';
}

function responseMessage(error: unknown) {
  if (error instanceof AdminApiError) {
    if (error.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    if (error.status === 403) return 'Tài khoản hiện tại không có quyền thực hiện thao tác này.';
  }
  return error instanceof Error ? error.message : 'Đã xảy ra lỗi. Vui lòng thử lại.';
}

export default function AdminDashboardWeb() {
  const { pois } = useBrowserPois();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [statsRevision, setStatsRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersPage, setUsersPage] = useState(0);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [visits, setVisits] = useState<VisitorVisit[]>([]);
  const [visitsTotal, setVisitsTotal] = useState(0);
  const [allVisitsTotal, setAllVisitsTotal] = useState(0);
  const [visitsPage, setVisitsPage] = useState(0);
  const [poiSearch, setPoiSearch] = useState('');
  const [selectedPoiId, setSelectedPoiId] = useState('');
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isLoadingRoles, setIsLoadingRoles] = useState(false);
  const [isLoadingVisits, setIsLoadingVisits] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [changingUserId, setChangingUserId] = useState('');
  const [passwordResetId, setPasswordResetId] = useState('');
  const [editingRoleName, setEditingRoleName] = useState('');
  const [draftPermissions, setDraftPermissions] = useState<string[]>([]);
  const [draftDescription, setDraftDescription] = useState('');
  const [isSavingRole, setIsSavingRole] = useState(false);
  const [isCompact, setIsCompact] = useState(() => window.innerWidth < 760);

  const permissions = user?.permissions ?? [];
  const canReadUsers = hasAdminPermission(permissions, 'user:read');
  const canUpdateUsers = hasAdminPermission(permissions, 'user:update');
  const canReadRoles = hasAdminPermission(permissions, 'role:read');
  const canUpdateRoles = user?.features?.roles !== false && hasAdminPermission(permissions, 'role:update');
  const canReadVisitors = user?.features?.visits !== false && hasAdminPermission(permissions, 'visitor:read');
  const canReadStats = hasAdminPermission(permissions, 'analytics:read');
  const canReadDeviceUsage = user?.features?.device_usage !== false && canReadStats;
  const canManageContent = user?.role === 'admin' || user?.role === 'super_admin';
  useDeviceHeartbeat(user?.features?.device_usage === false ? undefined : user?.user_id);

  const availableTabs = useMemo(() => {
    const tabs: { id: AdminTab; label: string }[] = [{ id: 'overview', label: 'Tổng quan' }];
    if (canManageContent) tabs.push({ id: 'pois', label: 'Điểm tham quan' }, { id: 'qr', label: 'Mã QR' });
    if (canReadUsers) tabs.push({ id: 'users', label: 'Tài khoản' });
    if (canReadRoles) tabs.push({ id: 'roles', label: 'Vai trò & quyền' });
    if (canReadVisitors) tabs.push({ id: 'visitors', label: 'Lượt khách QR' });
    if (canReadDeviceUsage) tabs.push({ id: 'devices', label: 'Thống kê thiết bị' });
    return tabs;
  }, [canManageContent, canReadRoles, canReadUsers, canReadVisitors, canReadDeviceUsage]);

  useEffect(() => {
    let cancelled = false;
    void getAdminMe().then((currentUser) => {
      if (!cancelled) setUser(currentUser);
    }).catch(() => {
      if (!cancelled) setUser(null);
    }).finally(() => {
      if (!cancelled) setIsCheckingSession(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const updateLayout = () => setIsCompact(window.innerWidth < 760);
    window.addEventListener('resize', updateLayout);
    return () => window.removeEventListener('resize', updateLayout);
  }, []);

  const loadUsers = useCallback(async (page: number) => {
    if (!canReadUsers) return;
    setIsLoadingUsers(true);
    setRequestError('');
    try {
      const result = await getAdminUsers(PAGE_SIZE, page * PAGE_SIZE);
      setUsers(result.items);
      setUsersTotal(result.total);
    } catch (error) {
      setRequestError(responseMessage(error));
    } finally {
      setIsLoadingUsers(false);
    }
  }, [canReadUsers]);

  const loadRoles = useCallback(async () => {
    if (!canReadRoles) return;
    setIsLoadingRoles(true);
    setRequestError('');
    try {
      setRoles(await getAdminRoles());
    } catch (error) {
      setRequestError(responseMessage(error));
    } finally {
      setIsLoadingRoles(false);
    }
  }, [canReadRoles]);

  const loadVisits = useCallback(async (page: number, poiId: string) => {
    if (!canReadVisitors) return;
    setIsLoadingVisits(true);
    setRequestError('');
    try {
      const result = await getVisitorVisits(PAGE_SIZE, page * PAGE_SIZE, poiId || undefined);
      setVisits(result.items);
      setVisitsTotal(result.total);
      if (!poiId) setAllVisitsTotal(result.total);
    } catch (error) {
      setRequestError(responseMessage(error));
    } finally {
      setIsLoadingVisits(false);
    }
  }, [canReadVisitors]);

  useEffect(() => {
    if (!user) return;
    if (canReadUsers && (activeTab === 'overview' || activeTab === 'users')) {
      void loadUsers(activeTab === 'users' ? usersPage : 0);
    }
    if (canReadRoles && (activeTab === 'overview' || activeTab === 'roles')) void loadRoles();
    if (canReadVisitors && (activeTab === 'overview' || activeTab === 'visitors')) {
      void loadVisits(visitsPage, selectedPoiId);
    }
  }, [
    user,
    activeTab,
    usersPage,
    visitsPage,
    selectedPoiId,
    canReadUsers,
    canReadRoles,
    canReadVisitors,
    loadUsers,
    loadRoles,
    loadVisits,
  ]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setLoginError('');
    try {
      const result = await adminLogin(username.trim(), password);
      setUser(result.user);
      setPassword('');
      setNotice('Đăng nhập thành công.');
    } catch (error) {
      setLoginError(responseMessage(error));
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await adminLogout();
    } catch (error) {
      setNotice(responseMessage(error));
    } finally {
      setUser(null);
      setUsers([]);
      setRoles([]);
      setVisits([]);
      setAllVisitsTotal(0);
      setSelectedPoiId('');
      setPoiSearch('');
      setVisitsPage(0);
      setActiveTab('overview');
    }
  };

  const handleAssignRole = async (target: AdminUser, roleName: string) => {
    if (target.role === roleName || !window.confirm(`Đổi vai trò của ${target.username} thành "${roleName}"?`)) {
      return;
    }
    setChangingUserId(target.user_id);
    setRequestError('');
    try {
      const updatedUser = await assignUserRole(target.user_id, roleName);
      setUsers((current) => current.map((item) =>
        item.user_id === updatedUser.user_id ? { ...item, ...updatedUser } : item,
      ));
      setNotice(`Đã cập nhật vai trò cho ${target.username}.`);
    } catch (error) {
      setRequestError(responseMessage(error));
    } finally {
      setChangingUserId('');
    }
  };

  const startRoleEdit = useCallback((role: AdminRole) => {
    setEditingRoleName(role.name);
    setDraftPermissions(role.permissions.includes('*') ? [] : [...role.permissions]);
    setDraftDescription(role.description);
  }, []);

  useEffect(() => {
    if (activeTab !== 'roles' || !canReadRoles || !roles.length || editingRoleName) return;
    startRoleEdit(roles.find((role) => role.name === 'admin') ?? roles[0]!);
  }, [activeTab, canReadRoles, editingRoleName, roles, startRoleEdit]);

  const togglePermission = (permission: string) => {
    setDraftPermissions((current) => current.includes(permission)
      ? current.filter((item) => item !== permission)
      : [...current, permission].sort(),
    );
  };

  const saveRole = async () => {
    if (!editingRoleName) return;
    setIsSavingRole(true);
    setRequestError('');
    try {
      const updated = await updateAdminRole(editingRoleName, {
        permissions: draftPermissions,
        description: draftDescription,
      });
      setRoles((current) => current.map((role) => role.name === updated.name ? updated : role));
      setEditingRoleName('');
      setNotice(`Đã lưu quyền cho vai trò ${updated.name}.`);
    } catch (error) {
      setRequestError(responseMessage(error));
    } finally {
      setIsSavingRole(false);
    }
  };

  const matchingPois = useMemo(() => {
    const query = poiSearch.trim().toLocaleLowerCase();
    if (!query) return [];
    return pois
      .filter((poi) =>
        poi.id.toLocaleLowerCase().includes(query) ||
        getPoiName(poi).toLocaleLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [poiSearch, pois]);

  const selectedPoi = pois.find((poi) => poi.id === selectedPoiId);
  const selectedPoiLabel = selectedPoi ? getPoiName(selectedPoi) : selectedPoiId;
  const applyPoiFilter = (poiId: string) => {
    setSelectedPoiId(poiId);
    setPoiSearch('');
    setVisitsPage(0);
  };
  const visitorPageCount = Math.max(1, Math.ceil(visitsTotal / PAGE_SIZE));
  const userPageCount = Math.max(1, Math.ceil(usersTotal / PAGE_SIZE));

  if (isCheckingSession) {
    return (
      <View style={styles.loadingPage}>
        <ActivityIndicator size="large" color={palette.green} />
        <Text style={styles.mutedText}>Đang xác thực phiên quản trị…</Text>
      </View>
    );
  }

  if (!user) {
    return (
      <View style={[styles.loginPage, isCompact && styles.loginPageCompact]}>
        <View style={[styles.loginAside, isCompact && styles.loginAsideCompact]}>
          <Brand />
          <Text style={[styles.loginHeadline, isCompact && styles.loginHeadlineCompact]}>Quản trị Go to Horizon</Text>
          {!isCompact ? <Text style={styles.loginAsideCopy}>
            Quản lý tài khoản, phân quyền truy cập và theo dõi lượt khách tại các điểm tham quan.
          </Text> : null}
        </View>
        <View style={[styles.loginFormWrap, isCompact && styles.loginFormWrapCompact]}>
          <View style={styles.loginCard}>
            <Text style={styles.eyebrow}>CỔNG QUẢN TRỊ</Text>
            <Text style={styles.loginTitle}>Đăng nhập</Text>
            <Text style={styles.mutedText}>Dùng tài khoản quản trị do hệ thống cấp.</Text>
            <Text style={styles.fieldLabel}>Tên đăng nhập</Text>
            <TextInput
              autoCapitalize="none"
              autoComplete="username"
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="Nhập tên đăng nhập"
              placeholderTextColor={palette.muted}
            />
            <Text style={styles.fieldLabel}>Mật khẩu</Text>
            <TextInput
              secureTextEntry
              autoComplete="current-password"
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={() => void handleLogin()}
              placeholder="Nhập mật khẩu"
              placeholderTextColor={palette.muted}
            />
            {loginError ? <Text accessibilityRole="alert" style={styles.errorText}>{loginError}</Text> : null}
            <Pressable
              accessibilityRole="button"
              disabled={isLoggingIn || !username.trim() || !password}
              style={[styles.primaryButton, (isLoggingIn || !username.trim() || !password) && styles.disabledButton]}
              onPress={() => void handleLogin()}
            >
              <Text style={styles.primaryButtonText}>{isLoggingIn ? 'Đang đăng nhập…' : 'Đăng nhập an toàn'}</Text>
            </Pressable>
            <Text style={styles.loginFootnote}>Phiên đăng nhập được quản lý bằng cookie bảo mật, không lưu mật khẩu trên thiết bị.</Text>
          </View>
        </View>
      </View>
    );
  }

  const hasAnyAdminRead = canManageContent || canReadUsers || canReadRoles || canReadVisitors || canReadStats;
  const changeAccount = async (account: AdminUser, operation: () => Promise<unknown>, message: string) => {
    setChangingUserId(account.user_id);
    setRequestError('');
    setNotice('');
    try {
      await operation();
      setNotice(message);
      setPasswordResetId('');
      if (users.length === 1 && usersPage > 0) setUsersPage(0);
      else await loadUsers(usersPage);
    } catch (error) {
      setRequestError(responseMessage(error));
    } finally {
      setChangingUserId('');
    }
  };

  return (
    <View style={styles.appShell}>
      <View style={[styles.bodyLayout, isCompact && styles.bodyLayoutCompact]}>
        <View style={[styles.sidebar, isCompact && styles.sidebarCompact]}>
          <Brand />
          <Text style={[styles.sidebarLabel, isCompact && styles.sidebarLabelCompact]}>Quản trị</Text>
          <View style={[styles.navList, isCompact && styles.navListCompact]}>
            {availableTabs.map((tab) => (
              <Pressable
                key={tab.id}
                accessibilityRole="button"
                style={[styles.navItem, isCompact && styles.navItemCompact, activeTab === tab.id && styles.navItemActive]}
                onPress={() => setActiveTab(tab.id)}
              >
                <span className="admin-nav-icon"><Icon name={tabIcons[tab.id]} /></span>
                <Text style={[styles.navItemText, activeTab === tab.id && styles.navItemTextActive]}>{tab.label}</Text>
              </Pressable>
            ))}
          </View>
          <a className="admin-back" href="/"><Icon name="back" />Về trang khám phá</a>
        </View>
        <View style={styles.adminWorkspace}>
          <View style={[styles.topbar, isCompact && styles.topbarCompact]}>
            <Text style={styles.topbarCaption}>Quản trị / {availableTabs.find((tab) => tab.id === activeTab)?.label}</Text>
        <View style={[styles.accountBlock, isCompact && styles.accountBlockCompact]}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{user.username.slice(0, 1).toUpperCase()}</Text></View>
          <View style={[styles.accountCopy, isCompact && styles.accountCopyCompact]}>
            <Text style={styles.accountName}>{user.username}</Text>
            <Text style={styles.accountRole}>{user.role}</Text>
          </View>
          <Pressable accessibilityRole="button" style={[styles.logoutButton, isCompact && styles.logoutButtonCompact]} onPress={() => void handleLogout()}>
            <Text style={styles.logoutText}>Đăng xuất</Text>
          </Pressable>
        </View>
      </View>

        <ScrollView style={styles.mainScroll} contentContainerStyle={[styles.mainContent, isCompact && styles.mainContentCompact]}>
          <View style={[styles.pageHeader, isCompact && styles.pageHeaderCompact]}>
            <View>
              <Text style={styles.pageTitle}>{activeTab === 'overview' ? 'Tổng quan hoạt động' : availableTabs.find((tab) => tab.id === activeTab)?.label}</Text>
              {activeTab === 'overview' && <Text style={styles.sectionSubtitle}>Theo dõi lượt tham quan QR, tài khoản và thiết bị đăng nhập.</Text>}
            </View>
            {activeTab !== 'devices' && activeTab !== 'pois' && activeTab !== 'qr' && <Pressable
              accessibilityRole="button"
              style={styles.refreshButton}
              onPress={() => {
                if (activeTab === 'users') void loadUsers(usersPage);
                if (activeTab === 'roles') void loadRoles();
                if (activeTab === 'visitors') void loadVisits(visitsPage, selectedPoiId);
                if (activeTab === 'overview') {
                  setStatsRevision((revision) => revision + 1);
                  if (canReadUsers) void loadUsers(0);
                  if (canReadRoles) void loadRoles();
                  if (canReadVisitors) void loadVisits(visitsPage, selectedPoiId);
                }
              }}
            >
              <Text style={styles.refreshButtonText}>↻ Làm mới</Text>
            </Pressable>}
          </View>

          {notice ? (
            <Pressable style={styles.noticeBanner} onPress={() => setNotice('')}>
              <Text style={styles.noticeText}>{notice} ×</Text>
            </Pressable>
          ) : null}
          {requestError ? (
            <View accessibilityRole="alert" style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{requestError}</Text>
              <Pressable onPress={() => setRequestError('')}><Text style={styles.dismissText}>Đóng</Text></Pressable>
            </View>
          ) : null}

          {!hasAnyAdminRead ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Chưa được cấp quyền quản trị</Text>
              <Text style={styles.mutedText}>Tài khoản đăng nhập thành công nhưng chưa có quyền truy cập các mục quản trị.</Text>
            </View>
          ) : null}

          {activeTab === 'overview' && hasAnyAdminRead ? (
            <View>
              {canReadStats && <VisitorStats revision={statsRevision} />}
              <View style={[styles.metricGrid, isCompact && styles.metricGridCompact]}>
                {canReadUsers ? (
                  <MetricCard label="Tài khoản" value={usersTotal} detail="Tài khoản trong hệ thống" accent="blue" />
                ) : null}
                {canReadRoles ? (
                  <MetricCard label="Vai trò" value={roles.length} detail="Vai trò đã cấu hình" accent="amber" />
                ) : null}
                {canReadVisitors ? (
                  <MetricCard label="Lượt khách QR" value={allVisitsTotal} detail="Tổng lượt được phép tra cứu" accent="green" />
                ) : null}
              </View>
              {canReadDeviceUsage && <View style={styles.card}><DeviceUsagePanel compact /></View>}
            </View>
          ) : null}
          {activeTab === 'pois' && canManageContent && <AdminPoiPanel audioQueue={user.features?.audio_queue !== false} />}
          {activeTab === 'qr' && canManageContent && <AdminQrPanel />}

          {activeTab === 'users' && canReadUsers ? (
            <View style={styles.card}>
              <View style={styles.sectionHeadingInline}>
                <View>
                  <Text style={styles.sectionTitle}>Tài khoản hệ thống</Text>
                  <Text style={styles.sectionSubtitle}>{usersTotal} tài khoản · phân trang {PAGE_SIZE} mục</Text>
                </View>
              </View>
              {isLoadingUsers ? <LoadingLine /> : users.length === 0 ? <EmptyMessage text="Chưa có tài khoản trong danh sách." /> : users.map((account) => (
                <View key={account.user_id} style={[styles.userRow, isCompact && styles.userRowCompact]}>
                  <View style={styles.userIdentity}>
                    <View style={styles.userAvatar}><Text style={styles.userAvatarText}>{account.username.slice(0, 1).toUpperCase()}</Text></View>
                    <View style={styles.userInfo}>
                      <Text style={styles.userName}>{account.username}</Text>
                      <Text style={styles.userMeta}>{account.email || account.user_id}</Text>
                      <Text style={styles.userMeta}>Đăng nhập gần nhất: {formatDate(account.last_login_at)}</Text>
                    </View>
                  </View>
                  <View style={[styles.userRoleArea, isCompact && styles.userRoleAreaCompact]}>
                    <View style={[styles.statusBadge, account.is_active ? styles.statusActive : styles.statusInactive]}>
                      <Text style={[styles.statusText, account.is_active ? styles.statusActiveText : styles.statusInactiveText]}>
                        {account.is_active ? 'Đang hoạt động' : 'Đã vô hiệu hóa'}
                      </Text>
                    </View>
                    <Text style={styles.roleBadge}>{account.role}</Text>
                    {canUpdateUsers && canReadRoles && account.user_id !== user.user_id ? (
                      <View style={styles.roleOptions}>
                        {roles.filter((role) => role.name !== account.role).map((role) => (
                          <Pressable
                            key={role.name}
                            disabled={changingUserId === account.user_id}
                            style={styles.roleOption}
                            onPress={() => void handleAssignRole(account, role.name)}
                          >
                            <Text style={styles.roleOptionText}>
                              {changingUserId === account.user_id ? 'Đang lưu…' : `Đổi thành ${role.name}`}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                    {user.role === 'super_admin' && account.user_id !== user.user_id && (
                      <div className="admin-workflow-actions">
                        <button className="heritage-button" disabled={Boolean(changingUserId)} onClick={() => {
                          const label = account.is_active ? 'Vô hiệu hóa' : 'Bật lại';
                          if (window.confirm(`${label} tài khoản “${account.username}”?`)) void changeAccount(account,
                            () => setAccountActive(account.user_id, !account.is_active), 'Đã cập nhật trạng thái.');
                        }}>{account.is_active ? 'Vô hiệu hóa' : 'Bật lại'}</button>
                        <button className="heritage-button" disabled={Boolean(changingUserId)}
                          onClick={() => setPasswordResetId(account.user_id === passwordResetId ? '' : account.user_id)}>Đặt lại mật khẩu</button>
                        <button className="heritage-button" disabled={Boolean(changingUserId)} onClick={() => {
                          if (window.confirm(`Xóa tài khoản “${account.username}”?`)) void changeAccount(account,
                            () => deleteAdminAccount(account.user_id), 'Đã xóa tài khoản.');
                        }}>Xóa tài khoản</button>
                        {passwordResetId === account.user_id && <form className="admin-workflow" onSubmit={(event) => {
                          event.preventDefault();
                          const newPassword = String(new FormData(event.currentTarget).get('password'));
                          if (window.confirm(`Đặt lại mật khẩu của “${account.username}”?`)) void changeAccount(account,
                            () => resetAccountPassword(account.user_id, newPassword), 'Đã đặt lại mật khẩu.');
                        }}>
                          <label>Mật khẩu mới<input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} /></label>
                          <button className="heritage-button" disabled={Boolean(changingUserId)}>Lưu mật khẩu mới</button>
                        </form>}
                      </div>
                    )}
                  </View>
                </View>
              ))}
              {canReadUsers ? (
                <Pagination
                  page={usersPage}
                  pageCount={userPageCount}
                  total={usersTotal}
                  onChange={(page) => {
                    setUsersPage(page);
                  }}
                />
              ) : null}
              {user.role === 'super_admin' && <CreateAccountForm changed={() => {
                if (usersPage === 0) void loadUsers(0);
                else setUsersPage(0);
              }} />}
            </View>
          ) : null}

          {activeTab === 'roles' && canReadRoles ? (
            <View style={[styles.roleLayout, isCompact && styles.roleLayoutCompact]}>
              <View style={[styles.roleListCard, isCompact && styles.roleListCardCompact]}>
                <View style={styles.sectionHeading}>
                  <Text style={styles.sectionTitle}>Vai trò</Text>
                  <Text style={styles.sectionSubtitle}>{roles.length} vai trò hiện có</Text>
                </View>
                {isLoadingRoles ? <LoadingLine /> : roles.map((role) => (
                  <Pressable
                    key={role.name}
                    style={[styles.roleListItem, editingRoleName === role.name && styles.roleListItemSelected]}
                    onPress={() => startRoleEdit(role)}
                  >
                    <View style={styles.roleListCopy}>
                      <Text style={styles.roleListName}>{role.name}</Text>
                      <Text style={styles.roleListDescription} numberOfLines={2}>{role.description}</Text>
                      <Text style={styles.roleListMeta}>{role.permissions.includes('*') ? 'Toàn quyền' : `${role.permissions.length} quyền`}{role.is_default ? ' · Mặc định' : ''}</Text>
                    </View>
                    {canUpdateRoles && role.name !== 'super_admin' ? <Text style={styles.editMark}>›</Text> : null}
                  </Pressable>
                ))}
              </View>
              <View style={styles.permissionEditorCard}>
                {editingRoleName ? (
                  <>
                    <View style={styles.sectionHeading}>
                      <Text style={styles.sectionTitle}>Quyền vai trò: {editingRoleName}</Text>
                      <Text style={styles.sectionSubtitle}>
                        {editingRoleName === 'super_admin'
                          ? 'Vai trò super_admin được bảo vệ, không thể chỉnh sửa.'
                          : 'Máy chủ sẽ xác minh quyền cấp quyền trước khi lưu.'}
                      </Text>
                    </View>
                    <Text style={styles.fieldLabel}>Mô tả</Text>
                    <TextInput
                      editable={canUpdateRoles && editingRoleName !== 'super_admin'}
                      style={styles.input}
                      value={draftDescription}
                      onChangeText={setDraftDescription}
                      maxLength={500}
                    />
                    <ScrollView style={styles.permissionList} nestedScrollEnabled>
                      {ADMIN_PERMISSION_GROUPS.map((group) => (
                        <View key={group.name} style={styles.permissionGroup}>
                          <Text style={styles.permissionGroupTitle}>{group.name}</Text>
                          {group.permissions.map(([permission, label]) => {
                            const selected = draftPermissions.includes(permission);
                            return (
                              <Pressable
                                key={permission}
                                disabled={!canUpdateRoles || editingRoleName === 'super_admin'}
                                style={styles.permissionOption}
                                onPress={() => togglePermission(permission)}
                              >
                                <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                                  {selected ? <Text style={styles.checkboxTick}>✓</Text> : null}
                                </View>
                                <View style={styles.permissionOptionCopy}>
                                  <Text style={styles.permissionOptionLabel}>{label}</Text>
                                  <Text style={styles.permissionCode}>{permission}</Text>
                                </View>
                              </Pressable>
                            );
                          })}
                        </View>
                      ))}
                    </ScrollView>
                    {canUpdateRoles && editingRoleName !== 'super_admin' ? (
                      <Pressable
                        disabled={isSavingRole}
                        style={[styles.primaryButton, isSavingRole && styles.disabledButton]}
                        onPress={() => void saveRole()}
                      >
                        <Text style={styles.primaryButtonText}>{isSavingRole ? 'Đang lưu quyền…' : 'Lưu thay đổi quyền'}</Text>
                      </Pressable>
                    ) : null}
                    {!canUpdateRoles ? <Text style={styles.footnote}>Bạn có quyền xem, nhưng không được phép chỉnh sửa vai trò.</Text> : null}
                  </>
                ) : (
                  <EmptyMessage text="Chọn một vai trò để xem danh sách quyền." />
                )}
              </View>
            </View>
          ) : null}

          {activeTab === 'devices' && canReadDeviceUsage && <DeviceUsagePanel />}

          {(activeTab === 'overview' || activeTab === 'visitors') && canReadVisitors ? (
            <View style={styles.card}>
              <View style={styles.sectionHeadingInline}>
                <View>
                  <Text style={styles.sectionTitle}>Lịch sử lượt khách QR</Text>
                  <Text style={styles.sectionSubtitle}>Tra cứu lượt vào, trạng thái rời điểm và lộ trình đã lưu.</Text>
                </View>
                <Text style={styles.totalBadge}>{visitsTotal.toLocaleString('vi-VN')} lượt</Text>
              </View>

              <Text style={styles.fieldLabel}>Lọc theo điểm tham quan</Text>
              <TextInput
                style={styles.input}
                value={poiSearch}
                onChangeText={setPoiSearch}
                placeholder="Tìm theo tên hoặc mã POI"
                placeholderTextColor={palette.muted}
                onSubmitEditing={() => {
                  const poiId = poiSearch.trim();
                  if (/^[A-Za-z0-9][A-Za-z0-9-]{1,80}$/.test(poiId)) applyPoiFilter(poiId);
                }}
              />
              {matchingPois.length > 0 ? (
                <View style={styles.poiSuggestions}>
                  {matchingPois.map((poi) => (
                    <Pressable
                      key={poi.id}
                      style={styles.poiSuggestion}
                      onPress={() => applyPoiFilter(poi.id)}
                    >
                      <Text style={styles.poiSuggestionName}>{getPoiName(poi)}</Text>
                      <Text style={styles.poiSuggestionId}>{poi.id}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
                {poiSearch.trim() && matchingPois.length === 0 &&
                /^[A-Za-z0-9][A-Za-z0-9-]{1,80}$/.test(poiSearch.trim()) ? (
                  <Pressable style={styles.poiSuggestion} onPress={() => applyPoiFilter(poiSearch.trim())}>
                    <Text style={styles.poiSuggestionName}>Tra cứu theo mã POI</Text>
                    <Text style={styles.poiSuggestionId}>{poiSearch.trim()}</Text>
                  </Pressable>
                ) : null}
              <View style={styles.filterRow}>
                <Pressable
                  style={[styles.filterChip, !selectedPoiId && styles.filterChipSelected]}
                  onPress={() => {
                    setSelectedPoiId('');
                    setVisitsPage(0);
                  }}
                >
                  <Text style={[styles.filterChipText, !selectedPoiId && styles.filterChipTextSelected]}>Tất cả điểm</Text>
                </Pressable>
                {selectedPoiId ? (
                  <Pressable
                    style={[styles.filterChip, styles.filterChipSelected]}
                    onPress={() => {
                      setSelectedPoiId('');
                      setVisitsPage(0);
                    }}
                  >
                    <Text style={styles.filterChipTextSelected}>{selectedPoiLabel} ×</Text>
                  </Pressable>
                ) : null}
              </View>

              <View style={[styles.visitorTableHeader, isCompact && styles.visitorTableHeaderCompact]}>
                <Text style={[styles.tableHeaderText, styles.visitColumn]}>LƯỢT / ĐIỂM</Text>
                <Text style={[styles.tableHeaderText, styles.timeColumn]}>THỜI GIAN VÀO</Text>
                <Text style={[styles.tableHeaderText, styles.timeColumn]}>THỜI GIAN RA</Text>
                <Text style={[styles.tableHeaderText, styles.statusColumn]}>TRẠNG THÁI</Text>
              </View>
              {isLoadingVisits ? <LoadingLine /> : visits.length === 0 ? <EmptyMessage text="Không có lượt khách phù hợp bộ lọc." /> : visits.map((visit) => (
                <View key={visit.visit_id} style={[styles.visitRow, isCompact && styles.visitRowCompact]}>
                  <View style={[styles.visitIdentity, isCompact && styles.visitIdentityCompact]}>
                    <Text style={styles.visitPoi}>{getPoiName(pois.find((poi) => poi.id === visit.poi_id))}</Text>
                    <Text style={styles.visitId}>Mã lượt: {visit.visit_id}</Text>
                    <Text style={styles.visitId}>POI: {visit.poi_id}</Text>
                    {visit.saved_itinerary?.poi_ids.length ? (
                      <Text style={styles.visitItinerary}>Lộ trình: {visit.saved_itinerary.poi_ids.join(' → ')}</Text>
                    ) : null}
                  </View>
                  <Text style={[styles.visitTime, isCompact && styles.visitTimeCompact]}>{formatDate(visit.entered_at)}</Text>
                  <View style={[styles.visitExit, isCompact && styles.visitExitCompact]}>
                    <Text style={styles.visitTime}>{formatDate(visit.exited_at)}</Text>
                    {visit.exit_method ? <Text style={styles.visitId}>{visit.exit_method === 'geofence' ? 'Tự động qua GPS' : 'Kết thúc thủ công'}</Text> : null}
                  </View>
                  <View style={[styles.visitStatusCell, isCompact && styles.visitStatusCellCompact]}>
                    <View style={[styles.statusBadge, visit.status === 'inside' ? styles.statusInside : styles.statusActive]}>
                      <Text style={[styles.statusText, visit.status === 'inside' ? styles.statusInsideText : styles.statusActiveText]}>
                        {visit.status === 'inside' ? 'Đang tham quan' : 'Đã kết thúc'}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
              <Pagination
                page={visitsPage}
                pageCount={visitorPageCount}
                total={visitsTotal}
                onChange={(page) => {
                  setVisitsPage(page);
                }}
              />
              <Text style={styles.footnote}>Lượt khách được lưu ẩn danh; dữ liệu backend tự hết hạn sau 90 ngày.</Text>
            </View>
          ) : null}

        </ScrollView>
        </View>
      </View>
    </View>
  );
}

function MetricCard({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: number;
  detail: string;
  accent: 'green' | 'blue' | 'amber';
}) {
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricHeader}><Text style={styles.metricLabel}>{label}</Text><span className="admin-metric-icon"><Icon name={accent === 'blue' ? 'users' : accent === 'amber' ? 'shield' : 'qr'} /></span></View>
      <Text style={styles.metricValue}>{value.toLocaleString('vi-VN')}</Text>
      <Text style={styles.metricDetail}>{detail}</Text>
    </View>
  );
}

function PermissionChip({ label }: { label: string }) {
  return <View style={styles.permissionChip}><Text style={styles.permissionChipText}>{label}</Text></View>;
}

function LoadingLine() {
  return (
    <View style={styles.loadingLine}>
      <ActivityIndicator color={palette.green} />
      <Text style={styles.mutedText}>Đang tải dữ liệu…</Text>
    </View>
  );
}

function EmptyMessage({ text }: { text: string }) {
  return <View style={styles.emptyState}><Text style={styles.mutedText}>{text}</Text></View>;
}

function Pagination({
  page,
  pageCount,
  total,
  onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <View style={styles.pagination}>
      <Text style={styles.paginationInfo}>
        {total === 0 ? 'Không có kết quả' : `Trang ${page + 1}/${pageCount} · ${total.toLocaleString('vi-VN')} mục`}
      </Text>
      <View style={styles.paginationButtons}>
        <Pressable
          disabled={page === 0}
          style={[styles.pageButton, page === 0 && styles.disabledPageButton]}
          onPress={() => onChange(page - 1)}
        >
          <Text style={styles.pageButtonText}>← Trước</Text>
        </Pressable>
        <Pressable
          disabled={page + 1 >= pageCount}
          style={[styles.pageButton, page + 1 >= pageCount && styles.disabledPageButton]}
          onPress={() => onChange(page + 1)}
        >
          <Text style={styles.pageButtonText}>Sau →</Text>
        </Pressable>
      </View>
    </View>
  );
}

const palette = {
  green: '#20372c',
  deep: '#20372c',
  text: '#202a23',
  muted: '#546057',
  border: '#dedbd0',
  background: '#f7f4ec',
  white: '#fffcf6',
};

const styles = StyleSheet.create({
  loadingPage: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.background, gap: 14 },
  loginPage: { flex: 1, minHeight: 600, flexDirection: 'row', backgroundColor: palette.white },
  loginPageCompact: { flexDirection: 'column' },
  loginAside: { color: '#ffffff', flex: 1, minWidth: 280, justifyContent: 'center', paddingHorizontal: 56, backgroundColor: palette.deep },
  loginAsideCompact: { flex: 0, minWidth: 0, paddingHorizontal: 22, paddingVertical: 18 },
  loginHeadline: { fontFamily: 'var(--serif)', maxWidth: 500, color: '#fffcf6', fontSize: 42, lineHeight: 51, fontWeight: '800', marginTop: 26 },
  loginHeadlineCompact: { fontSize: 21, lineHeight: 27, marginTop: 10 },
  loginAsideCopy: { maxWidth: 430, color: '#C2D6CB', fontSize: 16, lineHeight: 26, marginTop: 16 },
  loginFormWrap: { flex: 1, minWidth: 360, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#f7f4ec' },
  loginFormWrapCompact: { flex: 1, minWidth: 0, justifyContent: 'flex-start', padding: 16 },
  loginCard: { width: '100%', maxWidth: 430, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.border, borderRadius: 22, padding: 34, shadowColor: '#193B2C', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.06, shadowRadius: 24, elevation: 3 },
  eyebrow: { color: '#32835F', fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  loginTitle: { color: palette.deep, fontSize: 30, fontWeight: '800', marginTop: 10 },
  mutedText: { color: palette.muted, fontSize: 13, lineHeight: 20 },
  fieldLabel: { color: palette.text, fontSize: 12, fontWeight: '800', marginTop: 19, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#dedbd0', borderRadius: 11, backgroundColor: '#fffcf6', color: palette.text, minHeight: 46, paddingHorizontal: 13, paddingVertical: 11, fontSize: 14 },
  errorText: { color: '#B42318', fontSize: 12, marginTop: 12 },
  primaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.green, borderRadius: 11, paddingHorizontal: 18, paddingVertical: 13, marginTop: 20 },
  primaryButtonText: { color: '#fffcf6', fontSize: 13, fontWeight: '800' },
  disabledButton: { opacity: 0.5 },
  loginFootnote: { color: '#89968E', fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 18 },
  appShell: { flex: 1, minWidth: 0, backgroundColor: palette.background },
  topbar: { minHeight: 76, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 30, backgroundColor: palette.white, borderBottomWidth: 1, borderBottomColor: palette.border },
  topbarCompact: { paddingHorizontal: 14 },
  topbarCaption: { color: palette.text, fontSize: 13, fontWeight: '700' },
  accountBlock: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  accountBlockCompact: { gap: 6 },
  avatar: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: '#e4eadf' },
  avatarText: { color: palette.green, fontSize: 15, fontWeight: '900' },
  accountCopy: { minWidth: 100 },
  accountCopyCompact: { minWidth: 0 },
  accountName: { color: palette.text, fontSize: 12, fontWeight: '800' },
  accountRole: { color: palette.muted, fontSize: 10, marginTop: 3 },
  logoutButton: { paddingHorizontal: 13, paddingVertical: 9, borderWidth: 1, borderColor: palette.border, borderRadius: 9, marginLeft: 8 },
  logoutButtonCompact: { paddingHorizontal: 8, marginLeft: 2 },
  logoutText: { color: '#51645A', fontSize: 11, fontWeight: '700' },
  bodyLayout: { flex: 1, flexDirection: 'row' },
  bodyLayoutCompact: { flexDirection: 'column', overflowY: 'auto' },
  sidebar: { width: 233, paddingHorizontal: 16, paddingVertical: 23, backgroundColor: '#1e332a', color: '#edf0e8' },
  sidebarCompact: { width: '100%', paddingHorizontal: 10, paddingTop: 10, paddingBottom: 6, borderRightWidth: 0, borderBottomWidth: 1, borderBottomColor: palette.border },
  navList: { flexGrow: 1 },
  navListCompact: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  sidebarLabel: { color: '#bbcabc', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginHorizontal: 9, marginTop: 28, marginBottom: 9 },
  sidebarLabelCompact: { marginTop: 12, marginBottom: 7 },
  navItem: { minHeight: 45, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: 8, marginBottom: 5 },
  navItemCompact: { minHeight: 44, paddingHorizontal: 8, marginBottom: 0 },
  navItemActive: { backgroundColor: '#3a5144' },
  navItemText: { color: '#edf0e8', fontSize: 12, fontWeight: '700' },
  navItemTextActive: { color: '#ffffff' },
  adminWorkspace: { flex: 1, minWidth: 0, minHeight: 0 },
  mainScroll: { flex: 1 },
  mainContent: { width: '100%', maxWidth: 1480, alignSelf: 'center', padding: 30 },
  mainContentCompact: { padding: 14 },
  pageHeader: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  pageHeaderCompact: { marginBottom: 15 },
  pageTitle: { color: palette.text, fontFamily: 'var(--serif)', fontSize: 36, fontWeight: '600', marginTop: 5 },
  refreshButton: { backgroundColor: '#fffcf6', borderWidth: 1, borderColor: palette.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  refreshButtonText: { color: '#52645A', fontSize: 11, fontWeight: '800' },
  noticeBanner: { backgroundColor: '#E9F5ED', borderRadius: 9, padding: 12, marginBottom: 14 },
  noticeText: { color: '#276344', fontSize: 12, fontWeight: '700' },
  errorBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFF0EF', borderWidth: 1, borderColor: '#F3CFCC', borderRadius: 9, padding: 12, marginBottom: 14 },
  errorBannerText: { flex: 1, color: '#9B2C24', fontSize: 12 },
  dismissText: { color: '#9B2C24', fontSize: 11, fontWeight: '800', marginLeft: 14 },
  metricHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 16 },
  metricGridCompact: { gap: 8 },
  metricCard: { flexGrow: 1, flexBasis: 165, minHeight: 104, overflow: 'hidden', borderWidth: 1, borderColor: palette.border, borderRadius: 15, backgroundColor: '#fffcf6', padding: 18 },
  metricLabel: { color: palette.text, fontSize: 13, fontWeight: '700' },
  metricValue: { color: palette.deep, fontSize: 28, fontWeight: '900', marginTop: 10 },
  metricDetail: { color: palette.muted, fontSize: 11, marginTop: 3 },
  sectionHeading: { marginBottom: 13 },
  sectionHeadingInline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle: { color: palette.deep, fontSize: 17, fontWeight: '800' },
  sectionSubtitle: { color: palette.muted, fontSize: 11, marginTop: 5 },
  card: { borderWidth: 1, borderColor: palette.border, borderRadius: 15, backgroundColor: '#fffcf6', padding: 20, marginBottom: 16 },
  permissionChip: { backgroundColor: '#F0F5F1', borderRadius: 30, paddingHorizontal: 10, paddingVertical: 7 },
  permissionChipText: { color: '#456354', fontSize: 10, fontWeight: '700' },
  readOnlyTag: { color: '#58816A', backgroundColor: '#EDF5EF', fontSize: 9, fontWeight: '900', letterSpacing: 0.8, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7 },
  userRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 20, borderTopWidth: 1, borderTopColor: '#e8e4d9', paddingVertical: 16 },
  userRowCompact: { flexDirection: 'column', alignItems: 'stretch', gap: 12 },
  userIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 200 },
  userAvatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF3EF', borderRadius: 20 },
  userAvatarText: { color: '#557263', fontSize: 14, fontWeight: '900' },
  userInfo: { flex: 1 },
  userName: { color: palette.text, fontSize: 13, fontWeight: '800' },
  userMeta: { color: palette.muted, fontSize: 10, marginTop: 4 },
  userRoleArea: { alignItems: 'flex-end', gap: 7 },
  userRoleAreaCompact: { alignItems: 'flex-start' },
  statusBadge: { alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5 },
  statusActive: { backgroundColor: '#E8F4EB' },
  statusInactive: { backgroundColor: '#FDEDEC' },
  statusInside: { backgroundColor: '#e4eadf' },
  statusText: { fontSize: 11, fontWeight: '800' },
  statusActiveText: { color: '#2C7049' },
  statusInactiveText: { color: '#A83C36' },
  statusInsideText: { color: '#324a36' },
  roleBadge: { color: '#455B4E', fontSize: 11, fontWeight: '800', backgroundColor: '#F2F5F2', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  roleOptions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 5, maxWidth: 350 },
  roleOption: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7, backgroundColor: '#f2eee4' },
  roleOptionText: { color: '#537060', fontSize: 9, fontWeight: '700' },
  footnote: { color: '#849188', fontSize: 10, lineHeight: 16, marginTop: 12 },
  roleLayout: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  roleLayoutCompact: { flexDirection: 'column' },
  roleListCard: { width: 300, borderWidth: 1, borderColor: palette.border, borderRadius: 15, backgroundColor: '#fffcf6', padding: 17 },
  roleListCardCompact: { width: '100%' },
  roleListItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#e8e4d9', paddingVertical: 13, paddingHorizontal: 8, borderRadius: 8 },
  roleListItemSelected: { backgroundColor: '#EFF6F1' },
  roleListCopy: { flex: 1 },
  roleListName: { color: palette.deep, fontSize: 12, fontWeight: '800' },
  roleListDescription: { color: palette.muted, fontSize: 10, lineHeight: 15, marginTop: 4 },
  roleListMeta: { color: '#5E826B', fontSize: 9, fontWeight: '700', marginTop: 6 },
  editMark: { color: palette.green, fontSize: 24, marginLeft: 8 },
  permissionEditorCard: { flex: 1, minWidth: 300, borderWidth: 1, borderColor: palette.border, borderRadius: 15, backgroundColor: '#fffcf6', padding: 20 },
  permissionList: { maxHeight: 540, marginTop: 14 },
  permissionGroup: { marginBottom: 15 },
  permissionGroupTitle: { color: '#557361', fontSize: 10, fontWeight: '900', letterSpacing: 0.6, marginBottom: 5 },
  permissionOption: { minHeight: 39, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  checkbox: { width: 17, height: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#CAD8CE', borderRadius: 4 },
  checkboxSelected: { backgroundColor: palette.green, borderColor: palette.green },
  checkboxTick: { color: '#fffcf6', fontSize: 11, fontWeight: '900' },
  permissionOptionCopy: { flex: 1 },
  permissionOptionLabel: { color: palette.text, fontSize: 11, fontWeight: '700' },
  permissionCode: { color: '#94A097', fontSize: 9, marginTop: 2 },
  totalBadge: { color: '#39734F', backgroundColor: '#EAF4ED', fontSize: 11, fontWeight: '900', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
  poiSuggestions: { borderWidth: 1, borderColor: palette.border, borderRadius: 10, overflow: 'hidden', marginTop: 6 },
  poiSuggestion: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e8e4d9' },
  poiSuggestionName: { color: palette.text, fontSize: 11, fontWeight: '700' },
  poiSuggestionId: { color: palette.muted, fontSize: 10 },
  filterRow: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 14 },
  filterChip: { borderWidth: 1, borderColor: palette.border, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 7, backgroundColor: '#fffcf6' },
  filterChipSelected: { borderColor: '#C7DFCF', backgroundColor: '#EDF6EF' },
  filterChipText: { color: '#607268', fontSize: 10, fontWeight: '700' },
  filterChipTextSelected: { color: '#286744', fontSize: 10, fontWeight: '800' },
  visitorTableHeader: { flexDirection: 'row', paddingVertical: 10, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#e8e4d9' },
  visitorTableHeaderCompact: { display: 'none' },
  tableHeaderText: { color: '#8A978E', fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  visitColumn: { flex: 2 },
  timeColumn: { flex: 1.1 },
  statusColumn: { width: 130 },
  visitRow: { flexDirection: 'row', alignItems: 'center', minHeight: 82, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#e8e4d9' },
  visitRowCompact: { flexDirection: 'column', alignItems: 'stretch', gap: 7, paddingVertical: 14 },
  visitIdentity: { flex: 2, paddingRight: 10 },
  visitIdentityCompact: { flex: 0, paddingRight: 0 },
  visitPoi: { color: palette.text, fontSize: 12, fontWeight: '800' },
  visitId: { color: palette.muted, fontSize: 9, marginTop: 4 },
  visitItinerary: { color: '#51715E', fontSize: 9, lineHeight: 14, marginTop: 5 },
  visitTime: { flex: 1.1, color: '#53635A', fontSize: 10, paddingRight: 8 },
  visitTimeCompact: { flex: 0, paddingRight: 0 },
  visitExit: { flex: 1.1 },
  visitExitCompact: { flex: 0 },
  visitStatusCell: { width: 130 },
  visitStatusCellCompact: { width: 'auto' },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 },
  paginationInfo: { color: palette.muted, fontSize: 10 },
  paginationButtons: { flexDirection: 'row', gap: 8 },
  pageButton: { borderWidth: 1, borderColor: palette.border, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 8 },
  disabledPageButton: { opacity: 0.4 },
  pageButtonText: { color: '#53665B', fontSize: 10, fontWeight: '700' },
  loadingLine: { minHeight: 100, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyCard: { borderWidth: 1, borderColor: palette.border, borderRadius: 14, backgroundColor: '#fffcf6', padding: 24 },
  emptyTitle: { color: palette.deep, fontSize: 16, fontWeight: '800', marginBottom: 8 },
  emptyState: { minHeight: 120, alignItems: 'center', justifyContent: 'center', padding: 20 },
});
