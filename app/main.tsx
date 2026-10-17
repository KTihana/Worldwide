import {createRoot} from 'react-dom/client';
import AccountApp from './account';
import './globals.css';
import ConnectionGate from './connection';
import {installNativeTransport} from './native';
installNativeTransport();
createRoot(document.getElementById('root')!).render(<ConnectionGate><AccountApp/></ConnectionGate>);
