import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';

import Navbar from './components/layout/Navbar';
import Footer from './components/layout/Footer';
import LandingPage from './pages/LandingPage';
import BuyerDashboard from './pages/BuyerDashboard';
import SellerDashboard from './pages/SellerDashboard';
import CheckoutPage from './pages/CheckoutPage';
import OrderTracking from './pages/OrderTracking';
import AdminDashboard from './pages/AdminDashboard';
import { useWallet } from './store/useWallet';
import { useToken } from './store/useToken';
import { useEscrows } from './store/useEscrows';

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

function AppContent() {
  const {
    wallet,
    connect,
    disconnect,
    switchToHardhatLocal,
    clearError,
    refresh: refreshWallet,
  } = useWallet();
  const { token, refresh: refreshToken } = useToken(wallet);
  const {
    orders,
    activities,
    loading: escrowsLoading,
    error: escrowError,
    refresh: refreshEscrows,
  } = useEscrows(wallet, token.decimals || 18);

  // After any transaction settles, re-read every balance and escrow from chain.
  const handleTransactionSettled = () => {
    void refreshEscrows();
    void refreshToken();
    void refreshWallet();
  };

  const chainError = escrowError ?? token.error;

  return (
    <div className="flex min-h-dvh flex-col bg-base text-ink">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <ScrollToTop />
      <Navbar
        wallet={wallet}
        token={token}
        onConnect={connect}
        onDisconnect={disconnect}
        onSwitchNetwork={switchToHardhatLocal}
        onDismissError={clearError}
      />

      {chainError && (
        <div className="container-page pt-4">
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-surface border border-danger/25 bg-danger/10 px-4 py-3 text-body-xs leading-5 text-danger-ink sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{chainError}</span>
            <button
              type="button"
              onClick={() => {
                void refreshEscrows();
                void refreshToken();
              }}
              className="btn btn-secondary btn-sm shrink-0 self-start sm:self-auto"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <Routes>
        <Route path="/" element={<LandingPage orders={orders} />} />
        <Route
          path="/buyer"
          element={
            <BuyerDashboard
              orders={orders}
              activities={activities}
              wallet={wallet}
              token={token}
              onConnect={connect}
              onRefresh={handleTransactionSettled}
            />
          }
        />
        <Route
          path="/seller"
          element={
            <SellerDashboard
              orders={orders}
              wallet={wallet}
              token={token}
              onRefresh={handleTransactionSettled}
            />
          }
        />
        <Route
          path="/checkout"
          element={
            <CheckoutPage
              wallet={wallet}
              token={token}
              onCreated={handleTransactionSettled}
            />
          }
        />
        <Route
          path="/order/:orderId"
          element={
            <OrderTracking orders={orders} wallet={wallet} loading={escrowsLoading} />
          }
        />
        <Route
          path="/admin"
          element={
            <AdminDashboard
              orders={orders}
              activities={activities}
              wallet={wallet}
              token={token}
              onRefresh={handleTransactionSettled}
            />
          }
        />
      </Routes>

      <Footer />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
