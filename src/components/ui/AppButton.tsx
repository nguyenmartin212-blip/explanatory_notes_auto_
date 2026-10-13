import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radius, spacing } from '@/theme';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary';
};

export function AppButton({ label, onPress, variant = 'primary' }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.base, variant === 'secondary' && styles.secondary]}
    >
      <Text style={[styles.label, variant === 'secondary' && styles.secondaryLabel]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  secondaryLabel: {
    color: colors.text,
  },
});
