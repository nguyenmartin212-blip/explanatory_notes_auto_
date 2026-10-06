import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '@/components';
import { NarrationButton } from '@/features/narration';
import { mockPois } from '@/features/poi';
import type { RootStackParamList } from '@/navigation';
import { colors, spacing } from '@/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'PoiDetail'>;

export function PoiDetailScreen({ route }: Props) {
  const poi = mockPois.find((item) => item.id === route.params.poiId);

  if (!poi) {
    return (
      <Screen>
        <Text>Không tìm thấy POI.</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.title}>{poi.name.vi}</Text>
      <Text style={styles.description}>{poi.description.vi}</Text>
      <View style={styles.actions}>
        <NarrationButton poiName={poi.name.vi} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
  },
  description: {
    color: colors.muted,
    fontSize: 16,
    marginTop: spacing.sm,
  },
  actions: {
    marginTop: spacing.lg,
  },
});
