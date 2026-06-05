// KithLy Routes - React Router Configuration (route-level code splitting)

import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, useRouteError } from 'react-router';
import { Root } from './layouts/Root';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { Navigate } from 'react-router';

// Eager: auth surfaces + landing page (low latency to prevent CLS / FCP degradation)
import { ConsumerStorefront } from './pages/ConsumerStorefront';
import { SignUp } from './pages/public/SignUp';
import { Login } from './pages/public/Login';
import { GiftPage } from './pages/public/GiftPage';
import { NotFound } from './pages/NotFound';

const lazyPage = <T extends Record<string, any>>(
  loader: () => Promise<T>,
  name: keyof T,
) =>
  lazy(() =>
    loader().then((m) => ({
      default: m[name] as ComponentType<any>,
    })),
  );

const Confirmation = lazyPage(() => import('./pages/sender/Confirmation'), 'Confirmation');
const Checkout = lazyPage(() => import('./pages/Checkout'), 'Checkout');

const About = lazyPage(() => import('./pages/About'), 'About');
const Privacy = lazyPage(() => import('./pages/Privacy'), 'Privacy');
const Terms = lazyPage(() => import('./pages/Terms'), 'Terms');
const Support = lazyPage(() => import('./pages/Support'), 'Support');
const MerchantAgreement = lazyPage(() => import('./pages/MerchantAgreement'), 'MerchantAgreement');
const ShopDirectory = lazyPage(() => import('./pages/ShopDirectory'), 'ShopDirectory');

const ShopDetail = lazyPage(() => import('./pages/sender/ShopDetail'), 'ShopDetail');
const SendFlow = lazyPage(() => import('./pages/sender/SendFlow'), 'SendFlow');
const CustomerDashboard = lazyPage(() => import('./pages/sender/CustomerDashboard'), 'CustomerDashboard');
const OrderDetail = lazyPage(() => import('./pages/sender/OrderDetail'), 'OrderDetail');
const Settings = lazyPage(() => import('./pages/sender/Settings'), 'Settings');
const MerchantOnboarding = lazyPage(() => import('./pages/MerchantOnboarding'), 'MerchantOnboarding');
const MerchantDashboard = lazyPage(() => import('./pages/merchant/MerchantDashboard'), 'MerchantDashboard');
const MerchantFulfill = lazyPage(() => import('./pages/merchant/MerchantFulfill'), 'MerchantFulfill');
const AdminDashboard = lazyPage(() => import('./pages/admin/AdminDashboard'), 'AdminDashboard');
const AdminMerchandising = lazyPage(() => import('./pages/admin/AdminMerchandising'), 'AdminMerchandising');
const AdminShops = lazyPage(() => import('./pages/admin/AdminShops'), 'AdminShops');
const AdminShopForm = lazyPage(() => import('./pages/admin/AdminShopForm'), 'AdminShopForm');
const AdminItems = lazyPage(() => import('./pages/admin/AdminItems'), 'AdminItems');
const AdminItemForm = lazyPage(() => import('./pages/admin/AdminItemForm'), 'AdminItemForm');
const AdminMerchants = lazyPage(() => import('./pages/admin/AdminMerchants'), 'AdminMerchants');
const AdminOrders = lazyPage(() => import('./pages/admin/AdminOrders'), 'AdminOrders');
const AdminOrderDetail = lazyPage(() => import('./pages/admin/AdminOrderDetail'), 'AdminOrderDetail');
const PrintableReceipt = lazyPage(() => import('./pages/shared/PrintableReceipt'), 'PrintableReceipt');

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

function GlobalErrorBoundary() {
  const error = useRouteError() as Error;

  // If Vite fails to fetch a JS chunk (usually because a new version was deployed to Vercel),
  // automatically force a hard reload to fetch the new index.html and manifest.
  if (error?.message?.includes('Failed to fetch dynamically imported module')) {
    window.location.reload();
    return <PageFallback />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="mb-2 text-2xl font-bold text-slate-900">Something went wrong</h1>
        <p className="mb-6 text-sm text-slate-500">
          {error?.message || 'An unexpected error occurred while loading the page.'}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-full bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
        >
          Reload Page
        </button>
      </div>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Root,
    errorElement: <GlobalErrorBoundary />,
    children: [
      { index: true, Component: ConsumerStorefront },

      {
        path: 'dashboard',
        element: (
          <ProtectedRoute allowedRoles={['sender', 'merchant', 'admin']}>
            <Lazy><CustomerDashboard /></Lazy>
          </ProtectedRoute>
        ),
      },

      { path: 'signup', Component: SignUp },
      { path: 'login', Component: Login },
      { path: 'gift/:claimCode', Component: GiftPage },
      { path: 'about', element: <Lazy><About /></Lazy> },
      { path: 'privacy', element: <Lazy><Privacy /></Lazy> },
      { path: 'terms', element: <Lazy><Terms /></Lazy> },
      { path: 'support', element: <Lazy><Support /></Lazy> },
      { path: 'merchant-agreement', element: <Lazy><MerchantAgreement /></Lazy> },
      { path: 'shops', element: <Lazy><ShopDirectory /></Lazy> },

      {
        path: 'shop/:shopId',
        element: (
          <ProtectedRoute allowedRoles={['sender', 'merchant', 'admin']}>
            <Lazy><ShopDetail /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: 'send/:itemId',
        element: (
          <ProtectedRoute allowedRoles={['sender']}>
            <Lazy><SendFlow /></Lazy>
          </ProtectedRoute>
        ),
      },
      { path: 'summary', element: <Navigate to="/checkout" replace /> },
      {
        path: 'confirmation/:orderId',
        element: (
          <ProtectedRoute allowedRoles={['sender']}>
            <Lazy><Confirmation /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: 'orders',
        element: (
          <ProtectedRoute allowedRoles={['sender']}>
            <Lazy><CustomerDashboard /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: 'orders/:orderId',
        element: (
          <ProtectedRoute allowedRoles={['sender']}>
            <Lazy><OrderDetail /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: 'receipt/:transactionId',
        element: (
          <ProtectedRoute allowedRoles={['sender', 'merchant', 'admin']}>
            <Lazy><PrintableReceipt /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: 'settings',
        element: (
          <ProtectedRoute allowedRoles={['sender', 'merchant', 'admin']}>
            <Lazy><Settings /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: 'become-merchant',
        element: (
          <ProtectedRoute allowedRoles={['sender']}>
            <Lazy><MerchantOnboarding /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: 'checkout',
        element: (
          <ProtectedRoute allowedRoles={['sender']}>
            <Lazy><Checkout /></Lazy>
          </ProtectedRoute>
        ),
      },

      {
        path: 'merchant',
        element: (
          <ProtectedRoute allowedRoles={['merchant']}>
            <Lazy><MerchantDashboard /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: 'merchant/fulfill',
        element: (
          <ProtectedRoute allowedRoles={['merchant']}>
            <Lazy><MerchantFulfill /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: 'merchant/items/new',
        element: (
          <ProtectedRoute allowedRoles={['merchant']}>
            <Lazy><AdminItemForm /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: 'merchant/items/:itemId/edit',
        element: (
          <ProtectedRoute allowedRoles={['merchant']}>
            <Lazy><AdminItemForm /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: 'merchant/shop/edit',
        element: (
          <ProtectedRoute allowedRoles={['merchant']}>
            <Lazy><AdminShopForm /></Lazy>
          </ProtectedRoute>
        ),
      },

      {
        path: 'admin-merch',
        element: (
          <ProtectedRoute allowedRoles={['admin']}>
            <Lazy><AdminMerchandising /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin',
        element: (
          <ProtectedRoute allowedRoles={['admin']}>
            <Lazy><AdminDashboard /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/shops',
        element: (
          <ProtectedRoute allowedRoles={['admin']}>
            <Lazy><AdminShops /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/shops/new',
        element: (
          <ProtectedRoute allowedRoles={['admin']}>
            <Lazy><AdminShopForm /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/shops/:shopId/edit',
        element: (
          <ProtectedRoute allowedRoles={['admin']}>
            <Lazy><AdminShopForm /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/shops/:shopId/items',
        element: (
          <ProtectedRoute allowedRoles={['admin']}>
            <Lazy><AdminItems /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/shops/:shopId/items/new',
        element: (
          <ProtectedRoute allowedRoles={['admin']}>
            <Lazy><AdminItemForm /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/items/:itemId/edit',
        element: (
          <ProtectedRoute allowedRoles={['admin']}>
            <Lazy><AdminItemForm /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/merchants',
        element: (
          <ProtectedRoute allowedRoles={['admin']}>
            <Lazy><AdminMerchants /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/orders',
        element: (
          <ProtectedRoute allowedRoles={['admin']}>
            <Lazy><AdminOrders /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/orders/:orderId',
        element: (
          <ProtectedRoute allowedRoles={['admin']}>
            <Lazy><AdminOrderDetail /></Lazy>
          </ProtectedRoute>
        ),
      },

      { path: '*', Component: NotFound },
    ],
  },
]);
