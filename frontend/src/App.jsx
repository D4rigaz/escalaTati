import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/layout/Sidebar.jsx';
import ToastContainer from './components/layout/Toast.jsx';
import NotificationBell from './components/layout/NotificationBell.jsx';
import SchedulePage from './pages/SchedulePage.jsx';
import EmployeesPage from './pages/EmployeesPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <header className="h-10 bg-white border-b border-gray-200 flex items-center justify-end px-4 shrink-0">
            <NotificationBell />
          </header>
          <main className="flex-1 flex flex-col overflow-hidden">
            <Routes>
              <Route path="/" element={<SchedulePage />} />
              <Route path="/funcionarios" element={<EmployeesPage />} />
              <Route path="/configuracoes" element={<SettingsPage />} />
            </Routes>
          </main>
        </div>
      </div>
      <ToastContainer />
    </BrowserRouter>
  );
}
