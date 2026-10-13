import { Text, StyleSheet } from 'react-native';
import { AppCard } from '@/components';
import type { Poi } from '../types';
import { colors, spacing } from '@/theme';

type Props = {
  poi: Poi;
};

export function PoiCard({ poi }: Props) {
  return (
    <AppCard>
      <Text style={styles.title}>{poi.name.vi}</Text>
      <Text style={styles.description}>{poi.description.vi}</Text>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  description: {
    color: colors.muted,
    marginTop: spacing.sm,
  },
});
