import { Text, StyleSheet } from 'react-native';
import { Screen } from '@/components';
import { colors } from '@/theme';

export function HomeScreen() {
  return (
    <Screen>
      <Text style={styles.title}>Khám phá</Text>
      <Text style={styles.subtitle}>Điểm bắt đầu cho trải nghiệm thuyết minh du lịch.</Text>
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
