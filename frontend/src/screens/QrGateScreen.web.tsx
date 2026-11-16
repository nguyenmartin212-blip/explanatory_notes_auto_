import { useState } from 'react';
import { getUrlLanguage, HeritageHeader, Icon, interfaceLanguage, LanguageSelect, saveLanguage } from '../design/Heritage';
import { useVisitorOptions } from '@/features/content/web-hooks';

const messages = {
  vi: { title: 'Quét mã QR để bắt đầu', body: 'Hãy quét mã QR đặt tại điểm tham quan để mở bản đồ và nghe thuyết minh.', invalid: 'Mã QR không hợp lệ hoặc đã bị tắt. Hãy thử quét lại mã khác.', offline: 'Không xác thực được mã QR. Hãy kiểm tra kết nối mạng rồi quét lại.', scan: 'Quét mã QR', retry: 'Thử lại', checking: 'Đang xác thực mã QR…' },
  en: { title: 'Scan a QR code to begin', body: 'Scan the QR code at the destination to open the map and hear the audio guide.', invalid: 'This QR code is invalid or disabled. Please try another code.', offline: 'Could not verify the QR code. Check your connection and scan again.', scan: 'Scan QR code', retry: 'Try again', checking: 'Checking QR code…' },
  zh: { title: '扫码开始', body: '请扫描景点处的二维码，打开地图并收听讲解。', invalid: '二维码无效或已停用，请尝试其他二维码。', offline: '无法验证二维码。请检查网络后重新扫描。', scan: '扫描二维码', retry: '重试', checking: '正在验证二维码…' },
};

export type GateState = 'idle' | 'checking' | 'invalid' | 'offline';

export default function QrGateScreen({ state = 'idle' }: { state?: GateState }) {
  const { languages } = useVisitorOptions();
  const [lang, setLang] = useState(getUrlLanguage);
  const t = messages[interfaceLanguage(lang)];
  return (
    <main className="heritage-scanner" lang={lang}>
      <HeritageHeader><LanguageSelect value={lang} languages={languages} onChange={(value) => {
        saveLanguage(value);
        setLang(value);
      }} /></HeritageHeader>
      <section className="heritage-scan-body">
        <h1 className="heritage-title">{t.title}</h1>
        <p>{t.body}</p>
        {state === 'checking' && <p role="status">{t.checking}</p>}
        {state === 'invalid' && <p className="heritage-error" role="alert">{t.invalid}</p>}
        {state === 'offline' && <p className="heritage-error" role="alert">{t.offline}</p>}
        {state !== 'checking' && (
          <a className="heritage-button heritage-primary" href={`/?scan=1&lang=${lang}`}>
            <Icon name="qr" />{state === 'offline' ? t.retry : t.scan}
          </a>
        )}
      </section>
    </main>
  );
}
