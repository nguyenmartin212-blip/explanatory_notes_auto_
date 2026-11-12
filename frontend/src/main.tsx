import { createRoot } from 'react-dom/client';
import { RootNavigator } from './navigation/RootNavigator.web';

const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');
createRoot(root).render(<RootNavigator />);
