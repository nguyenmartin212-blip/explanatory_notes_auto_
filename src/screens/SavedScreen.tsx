import { Text, StyleSheet } from 'react-native';
import { Screen } from '@/components';
import { colors } from '@/theme';

export function SavedScreen() {
  return (
    <Screen>
      <Text style={styles.title}>Đã lưu</Text>
      <Text style={styles.subtitle}>Các điểm đến và nội dung người dùng đã lưu.</Text>
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
