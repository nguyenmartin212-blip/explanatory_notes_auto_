import { Text, StyleSheet } from 'react-native';
import { Screen } from '@/components';
import { colors } from '@/theme';

export function MapScreen() {
  return (
    <Screen>
      <Text style={styles.title}>Bản đồ & POI</Text>
      <Text style={styles.subtitle}>Bước tiếp theo: tích hợp bản đồ, marker và vị trí hiện tại.</Text>
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
