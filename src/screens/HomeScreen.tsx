import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '@/components';
import type { RootStackParamList } from '@/navigation';
import { colors, radius, spacing } from '@/theme';

export function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <Screen>
      <Text style={styles.eyebrow}>GO TO HORIZON</Text>
      <Text style={styles.title}>Khám phá</Text>
      <Text style={styles.subtitle}>Điểm bắt đầu cho trải nghiệm thuyết minh du lịch theo vị trí.</Text>

      <View style={styles.qrCard}>
        <View style={styles.qrIcon}><Text style={styles.qrIconText}>▦</Text></View>
        <View style={styles.qrCopy}>
          <Text style={styles.qrTitle}>QR Guide</Text>
          <Text style={styles.qrBody}>Quét mã tại điểm tham quan để mở nội dung và nghe thuyết minh ngay, không cần GPS.</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Quét QR điểm thuyết minh"
          style={styles.qrButton}
          onPress={() => navigation.navigate('QrScanner')}
        >
          <Text style={styles.qrButtonText}>Quét QR →</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: colors.primary, fontSize: 11, letterSpacing: 1.4, fontWeight: '800' },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', marginTop: 5 },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 23, marginTop: 8 },
  qrCard: { marginTop: spacing.xl, backgroundColor: '#FFFDF8', borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md },
  qrIcon: { width: 54, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E6EFE9' },
  qrIconText: { color: colors.teal, fontSize: 34, fontWeight: '800' },
  qrCopy: { marginTop: 13 },
  qrTitle: { color: colors.text, fontSize: 19, fontWeight: '800' },
  qrBody: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 6 },
  qrButton: { backgroundColor: colors.teal, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 16 },
  qrButtonText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
