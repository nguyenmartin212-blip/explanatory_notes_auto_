import './design/heritage.css';
import { createRoot } from 'react-dom/client';
import { RootNavigator } from './navigation/RootNavigator.web';

const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');
createRoot(root).render(<RootNavigator />);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/service-worker.js').catch((error) => {
    console.warn('Không đăng ký được chế độ ngoại tuyến.', error);
  });
}
