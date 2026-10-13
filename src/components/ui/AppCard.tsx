import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@/theme';

export function AppCard({ children }: PropsWithChildren) {
  return <View style={styles.card}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
});
