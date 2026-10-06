import { Text, StyleSheet } from 'react-native';
import { Screen } from '@/components';
import { colors } from '@/theme';

export function SettingsScreen() {
  return (
    <Screen>
      <Text style={styles.title}>Cài đặt</Text>
      <Text style={styles.subtitle}>Ngôn ngữ, audio, vị trí và gói nội dung offline.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 16,
    marginTop: 8,
  },
});
