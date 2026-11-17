import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { LinkButton, Loading, Notice } from './components/ui';
import { AccountForm } from './pages/AccountForm';
import { AccountProfile } from './pages/AccountProfile';
import { Accounts } from './pages/Accounts';
import { Cashier } from './pages/Cashier';
import { DailyReport } from './pages/DailyReport';
import { FindPayment } from './pages/FindPayment';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Settings } from './pages/Settings';
import { Users } from './pages/Users';
import { Profile } from './pages/Profile';
import { Products } from './pages/Products';
import { SalesReport } from './pages/SalesReport';
import { BillNotice } from './pages/BillNotice';
import { Overdue } from './pages/Overdue';
import { PrintBills } from './pages/PrintBills';
import { WaterRates } from './pages/WaterRates';
import { WaterReadings } from './pages/WaterReadings';
import type { Role } from './lib/types';

function Only({ roles, children }: { roles: Role[]; children: JSX.Element }) {
  const { can } = useAuth();
  return can(...roles) ? children : <Notice tone="warning">Your user account is not allowed to open this page.</Notice>;
}

function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-bold">This page was not found.</h1>
      <LinkButton to="/" variant="primary" className="mt-5">
        Go to Home
      </LinkButton>
    </div>
  );
}

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Login />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="accounts/new" element={<Only roles={['ADMIN', 'STAFF']}><AccountForm /></Only>} />
        <Route path="accounts/:id" element={<AccountProfile />} />
        <Route path="accounts/:id/edit" element={<Only roles={['ADMIN', 'STAFF']}><AccountForm /></Only>} />
        <Route path="accounts/:id/make-member" element={<Only roles={['ADMIN', 'STAFF']}><AccountForm makeMember /></Only>} />
        <Route path="water" element={<WaterReadings />} />
        <Route path="water/overdue" element={<Overdue />} />
        <Route path="water/print" element={<PrintBills />} />
        <Route path="water/bills/:id" element={<BillNotice />} />
        <Route path="settings/water-rates" element={<Only roles={['ADMIN']}><WaterRates /></Only>} />
        <Route path="cashier" element={<Cashier />} />
        <Route path="cashier/find" element={<FindPayment />} />
        <Route path="cashier/daily-report" element={<DailyReport />} />
        <Route path="cashier/sales-report" element={<SalesReport />} />
        <Route path="prices" element={<Products />} />
        <Route path="settings" element={<Only roles={['ADMIN']}><Settings /></Only>} />
        <Route path="settings/users" element={<Only roles={['ADMIN']}><Users /></Only>} />
        <Route path="profile" element={<Profile />} />
        <Route path="login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
