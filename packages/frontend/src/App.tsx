import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import DisputesPage from './pages/DisputesPage';
import DisputeDetailPage from './pages/DisputeDetailPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/disputes" replace />} />
        <Route path="/disputes" element={<DisputesPage />} />
        <Route path="/disputes/:id" element={<DisputeDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
