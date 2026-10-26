import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, spacing } from '@/theme';
import { DeviceAnalyticsPanel } from '@/features/analytics/DeviceAnalyticsPanel';
import { loginAdmin, logoutAdmin, refreshAdminSession, type AdminSession } from './api';

export function AdminAccessPanel() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function handleLogin() {
    if (!username.trim() || !password) {
      setError('Vui lòng nhập tên đăng nhập và mật khẩu admin.');
      return;
    }
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const result = await loginAdmin(username.trim(), password);
      if (!result.user.is_active || !(result.user.permissions.includes('analytics:read') || result.user.permissions.includes('*'))) {
        setError('Tài khoản đăng nhập thành công nhưng không có quyền xem thống kê (analytics:read).');
        return;
      }
      setSession(result);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập admin thất bại.');
    } finally {
      setLoading(false);
    }
  }

  const renewSession = useCallback(async (): Promise<string | null> => {
    if (!session) return null;
    try {
      const refreshed = await refreshAdminSession(session.refresh_token);
      setSession((current) => current ? { ...current, ...refreshed } : current);
      return refreshed.access_token;
    } catch {
      setSession(null);
      setNotice('Phiên admin đã hết hạn. Vui lòng đăng nhập lại.');
      return null;
    }
  }, [session]);

  async function handleLogout() {
    if (session) {
      try {
        await logoutAdmin(session.access_token, session.refresh_token);
      } catch {
        // Clear local session even if the network is unavailable.
      }
    }
    setSession(null);
    setPassword('');
    setError('');
    setNotice('Đã đăng xuất admin.');
  }

  if (session) {
    return (
      <View style={styles.authenticated}>
        <View style={styles.sessionHeader}>
          <View style={styles.sessionInfo}>
            <Text style={styles.signedIn}>Đã đăng nhập: {session.user.username}</Text>
            <Text style={styles.small}>Vai trò: {session.user.role || 'admin'}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => void handleLogout()} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Đăng xuất</Text>
          </Pressable>
        </View>
        <DeviceAnalyticsPanel accessToken={session.access_token} onSessionExpired={renewSession} />
      </View>
    );
  }

  return (
    <View style={styles.form}>
      <Text style={styles.title}>Đăng nhập quản trị viên</Text>
      <Text style={styles.description}>Người dùng du lịch không cần đăng nhập. Chỉ admin đăng nhập để xem thống kê.</Text>
      <Text style={styles.label}>Tên đăng nhập</Text>
      <TextInput
        value={username}
        onChangeText={setUsername}
        placeholder="Nhập username admin"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
        style={styles.input}
      />
      <Text style={styles.label}>Mật khẩu</Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Nhập mật khẩu"
        placeholderTextColor={colors.muted}
        secureTextEntry
        autoCapitalize="none"
        editable={!loading}
        onSubmitEditing={() => void handleLogin()}
        style={styles.input}
      />
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {!!notice && <Text style={styles.notice}>{notice}</Text>}
      <Pressable accessibilityRole="button" disabled={loading} onPress={() => void handleLogin()} style={styles.loginButton}>
        {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.loginText}>Đăng nhập và xem thống kê</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.sm },
  title: { color: colors.text, fontSize: 21, fontWeight: '800' },
  description: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  label: { color: colors.text, fontWeight: '700', marginTop: spacing.xs },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11, color: colors.text, backgroundColor: colors.surface },
  loginButton: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.teal, borderRadius: 8, padding: 13, marginTop: spacing.sm, minHeight: 46 },
  loginText: { color: '#FFFFFF', fontWeight: '700' },
  error: { color: colors.error, fontSize: 13 },
  notice: { color: colors.teal, fontSize: 13 },
  authenticated: { flex: 1, gap: spacing.md },
  sessionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  sessionInfo: { flex: 1, gap: 3 },
  signedIn: { color: colors.text, fontWeight: '800' },
  small: { color: colors.muted, fontSize: 12 },
  logoutButton: { paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
  logoutText: { color: colors.primaryDark, fontWeight: '700' },
});
