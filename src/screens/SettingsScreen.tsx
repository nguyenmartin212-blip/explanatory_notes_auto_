import { ScrollView, StyleSheet, Text } from 'react-native';
import { Screen } from '@/components';
import { AdminAccessPanel } from '@/features/auth/AdminAccessPanel';
import { colors, spacing } from '@/theme';

export function SettingsScreen() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Cài đặt</Text>
        <Text style={styles.subtitle}>Ngôn ngữ, audio, vị trí và gói nội dung offline.</Text>
        <AdminAccessPanel />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, gap: spacing.lg, paddingBottom: spacing.xl },
  title: { color: colors.text, fontSize: 28, fontWeight: '800' },
  subtitle: { color: colors.muted, fontSize: 16, marginTop: -spacing.md },
});
