import { Text, StyleSheet } from 'react-native';
import { Screen } from '@/components';
import { colors } from '@/theme';

export function ItineraryScreen() {
  return (
    <Screen>
      <Text style={styles.title}>Lịch trình</Text>
      <Text style={styles.subtitle}>Đồng bộ logic số người và sở thích từ website.</Text>
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
