// KithLy - Zambia's Professional Gift Marketplace

import { RouterProvider } from 'react-router';
import { router } from './routes';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

export default function App() {
  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  );
}
