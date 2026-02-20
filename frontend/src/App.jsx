import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/layout/Sidebar.jsx';
import ToastContainer from './components/layout/Toast.jsx';
import SchedulePage from './pages/SchedulePage.jsx';
import EmployeesPage from './pages/EmployeesPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden">
          <Routes>
            <Route path="/" element={<SchedulePage />} />
            <Route path="/funcionarios" element={<EmployeesPage />} />
            <Route path="/configuracoes" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
      <ToastContainer />
    </BrowserRouter>
  );
}
