// KithLy Routes - React Router Configuration

import { createBrowserRouter } from 'react-router';
import { Root } from './layouts/Root';
import { ProtectedRoute } from '../components/ProtectedRoute';

// Public Pages
import { Landing } from './pages/public/Landing';
import { SignUp } from './pages/public/SignUp';
import { Login } from './pages/public/Login';
import { GiftPage } from './pages/public/GiftPage';

// Sender Pages
import { Home } from './pages/sender/Home';
import { ShopDetail } from './pages/sender/ShopDetail';
import { SendFlow } from './pages/sender/SendFlow';
import { OrderSummary } from './pages/sender/OrderSummary';
import { Confirmation } from './pages/sender/Confirmation';
import { OrderDashboard } from './pages/sender/OrderDashboard';
import { OrderDetail } from './pages/sender/OrderDetail';
import { Settings } from './pages/sender/Settings';
import { CustomerDashboard } from './pages/sender/CustomerDashboard';

// Merchant Pages
import { MerchantDashboard } from './pages/merchant/MerchantDashboard';
import { MerchantFulfill } from './pages/merchant/MerchantFulfill';
import { MerchantOnboarding } from './pages/MerchantOnboarding';

// Admin Pages
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminShops } from './pages/admin/AdminShops';
import { AdminShopForm } from './pages/admin/AdminShopForm';
import { AdminItems } from './pages/admin/AdminItems';
import { AdminItemForm } from './pages/admin/AdminItemForm';
import { AdminMerchants } from './pages/admin/AdminMerchants';
import { AdminOrders } from './pages/admin/AdminOrders';
import { AdminOrderDetail } from './pages/admin/AdminOrderDetail';

import { NotFound } from './pages/NotFound';

// Footer Pages
import { About } from './pages/About';
import { Privacy } from './pages/Privacy';
import { Terms } from './pages/Terms';
import { Support } from './pages/Support';
import { MerchantAgreement } from './pages/MerchantAgreement';
import { ShopDirectory } from './pages/ShopDirectory';

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Root,
    children: [
      // Public routes
      { index: true, Component: Landing },
      { path: 'signup', Component: SignUp },
      { path: 'login', Component: Login },
      { path: 'gift/:code', Component: GiftPage },
      { path: 'about', Component: About },
      { path: 'privacy', Component: Privacy },
      { path: 'terms', Component: Terms },
      { path: 'support', Component: Support },
      { path: 'merchant-agreement', Component: MerchantAgreement },
      { path: 'shops', Component: ShopDirectory },

      // Sender routes
      {
        path: 'home',
        element: <ProtectedRoute allowedRoles={['sender']}><Home /></ProtectedRoute>
      },
      {
        path: 'shop/:shopId',
        element: <ProtectedRoute allowedRoles={['sender']}><ShopDetail /></ProtectedRoute>
      },
      {
        path: 'send/:itemId',
        element: <ProtectedRoute allowedRoles={['sender']}><SendFlow /></ProtectedRoute>
      },
      {
        path: 'summary',
        element: <ProtectedRoute allowedRoles={['sender']}><OrderSummary /></ProtectedRoute>
      },
      {
        path: 'confirmation/:orderId',
        element: <ProtectedRoute allowedRoles={['sender']}><Confirmation /></ProtectedRoute>
      },
      {
        path: 'orders',
        element: <ProtectedRoute allowedRoles={['sender']}><OrderDashboard /></ProtectedRoute>
      },
      {
        path: 'orders/:orderId',
        element: <ProtectedRoute allowedRoles={['sender']}><OrderDetail /></ProtectedRoute>
      },
      {
        path: 'settings',
        element: <ProtectedRoute allowedRoles={['sender']}><Settings /></ProtectedRoute>
      },
      {
        path: 'dashboard',
        element: <ProtectedRoute allowedRoles={['sender']}><CustomerDashboard /></ProtectedRoute>
      },
      {
        // Any authenticated sender can access this to upgrade to merchant
        path: 'become-merchant',
        element: <ProtectedRoute allowedRoles={['sender']}><MerchantOnboarding /></ProtectedRoute>
      },

      // Merchant routes
      {
        path: 'merchant',
        element: <ProtectedRoute allowedRoles={['merchant']}><MerchantDashboard /></ProtectedRoute>
      },
      {
        path: 'merchant/fulfill',
        element: <ProtectedRoute allowedRoles={['merchant']}><MerchantFulfill /></ProtectedRoute>
      },
      {
        path: 'merchant/items/new',
        element: <ProtectedRoute allowedRoles={['merchant']}><AdminItemForm /></ProtectedRoute>
      },
      {
        path: 'merchant/items/:itemId/edit',
        element: <ProtectedRoute allowedRoles={['merchant']}><AdminItemForm /></ProtectedRoute>
      },

      // Admin routes
      {
        path: 'admin',
        element: <ProtectedRoute allowedRoles={['admin']}><AdminDashboard /></ProtectedRoute>
      },
      {
        path: 'admin/shops',
        element: <ProtectedRoute allowedRoles={['admin']}><AdminShops /></ProtectedRoute>
      },
      {
        path: 'admin/shops/new',
        element: <ProtectedRoute allowedRoles={['admin']}><AdminShopForm /></ProtectedRoute>
      },
      {
        path: 'admin/shops/:shopId/edit',
        element: <ProtectedRoute allowedRoles={['admin']}><AdminShopForm /></ProtectedRoute>
      },
      {
        path: 'admin/shops/:shopId/items',
        element: <ProtectedRoute allowedRoles={['admin']}><AdminItems /></ProtectedRoute>
      },
      {
        path: 'admin/shops/:shopId/items/new',
        element: <ProtectedRoute allowedRoles={['admin']}><AdminItemForm /></ProtectedRoute>
      },
      {
        path: 'admin/items/:itemId/edit',
        element: <ProtectedRoute allowedRoles={['admin']}><AdminItemForm /></ProtectedRoute>
      },
      {
        path: 'admin/merchants',
        element: <ProtectedRoute allowedRoles={['admin']}><AdminMerchants /></ProtectedRoute>
      },
      {
        path: 'admin/orders',
        element: <ProtectedRoute allowedRoles={['admin']}><AdminOrders /></ProtectedRoute>
      },
      {
        path: 'admin/orders/:orderId',
        element: <ProtectedRoute allowedRoles={['admin']}><AdminOrderDetail /></ProtectedRoute>
      },

      { path: '*', Component: NotFound },
    ],
  },
]);
