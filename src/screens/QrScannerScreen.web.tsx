// src/screens/QrScannerScreen.web.tsx
import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';

export default function QrScannerScreenWeb() {
  const navigation = useNavigation<any>();
  const [stationCode, setStationCode] = useState('');

  const handleActivate = () => {
    if (!stationCode.trim()) {
      alert('Vui lòng nhập mã trạm hoặc quét mã QR hợp lệ!');
      return;
    }
    // Lưu trạng thái kích hoạt trạm vào localStorage của trình duyệt
    localStorage.setItem('qr_activated_station', stationCode.trim());
    alert(`Đã kích hoạt thành công trạm: ${stationCode.trim()}`);
    navigation.replace('MainTabs');
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Trạm Ẩm Thực Quận 4 - Cổng Web</Text>
        <Text style={styles.subtitle}>
          Quét mã QR tại điểm đến hoặc nhập mã trạm bên dưới để bắt đầu hành trình trải nghiệm.
        </Text>

        <View style={styles.simulatedCameraBox}>
          <Text style={styles.cameraPlaceholderText}>📷 [Webcam QR Scanner Frame]</Text>
          <Text style={styles.cameraSub}>Trình duyệt hỗ trợ nhập mã thủ công nhanh</Text>
        </View>

        <TextInput
          style={styles.input}
          placeholder="Nhập mã trạm (VD: Q4-FOOD-01)"
          placeholderTextColor="#888"
          value={stationCode}
          onChangeText={setStationCode}
        />

        <TouchableOpacity style={styles.button} onPress={handleActivate}>
          <Text style={styles.buttonText}>Xác Nhận & Khám Phá</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#f8fafc',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 24,
  },
  simulatedCameraBox: {
    height: 180,
    borderWidth: 2,
    borderColor: '#38bdf8',
    borderStyle: 'dashed',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    backgroundColor: '#0f172a',
  },
  cameraPlaceholderText: {
    color: '#38bdf8',
    fontSize: 16,
    fontWeight: '600',
  },
  cameraSub: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 4,
  },
  input: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#f8fafc',
    fontSize: 16,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#f97316',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});