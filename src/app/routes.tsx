// KithLy Routes - React Router Configuration (route-level code splitting)

import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter } from 'react-router';
import { Root } from './layouts/Root';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { Navigate } from 'react-router';

// Eager: auth surfaces + payment return path (low latency)
import { ConsumerStorefront } from './pages/ConsumerStorefront';
import { SignUp } from './pages/public/SignUp';
import { Login } from './pages/public/Login';
import { GiftPage } from './pages/public/GiftPage';
import { Confirmation } from './pages/sender/Confirmation';
import { Checkout } from './pages/Checkout';
import { DashboardHub } from './pages/sender/DashboardHub';
import { NotFound } from './pages/NotFound';
import { About } from './pages/About';
import { Privacy } from './pages/Privacy';
import { Terms } from './pages/Terms';
import { Support } from './pages/Support';
import { MerchantAgreement } from './pages/MerchantAgreement';
import { ShopDirectory } from './pages/ShopDirectory';

const lazyPage = <T extends Record<string, ComponentType<unknown>>>(
  loader: () => Promise<T>,
  name: keyof T,
) =>
  lazy(() =>
    loader().then((m) => ({
      default: m[name] as ComponentType<unknown>,
    })),
  );

const ShopDetail = lazyPage(() => import('./pages/sender/ShopDetail'), 'ShopDetail');
const SendFlow = lazyPage(() => import('./pages/sender/SendFlow'), 'SendFlow');
const OrderDashboard = lazyPage(() => import('./pages/sender/OrderDashboard'), 'OrderDashboard');
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

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Root,
    children: [
      { index: true, Component: ConsumerStorefront },

      {
        path: 'dashboard',
        element: (
          <ProtectedRoute allowedRoles={['sender', 'merchant', 'admin']}>
            <DashboardHub />
          </ProtectedRoute>
        ),
      },

      { path: 'signup', Component: SignUp },
      { path: 'login', Component: Login },
      { path: 'gift/:code', Component: GiftPage },
      { path: 'about', Component: About },
      { path: 'privacy', Component: Privacy },
      { path: 'terms', Component: Terms },
      { path: 'support', Component: Support },
      { path: 'merchant-agreement', Component: MerchantAgreement },
      { path: 'shops', Component: ShopDirectory },

      {
        path: 'shop/:shopId',
        element: (
          <ProtectedRoute allowedRoles={['sender']}>
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
            <Confirmation />
          </ProtectedRoute>
        ),
      },
      {
        path: 'orders',
        element: (
          <ProtectedRoute allowedRoles={['sender']}>
            <Lazy><OrderDashboard /></Lazy>
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
        path: 'settings',
        element: (
          <ProtectedRoute allowedRoles={['sender']}>
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
            <Checkout />
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
