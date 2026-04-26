import { lazy, Suspense } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { ClerkProvider } from '@clerk/clerk-react';
import { AnalyticsAuthProvider } from './hooks/useAnalyticsAuth';
import { useAuthenticatedApi } from './hooks/useAuthenticatedApi';
import { store } from './store';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import AppRouter from './routes/AppRouter';
import { isMarketingMode } from './lib/siteMode';

// Marketing mode: lazy-loaded landing page — no Clerk, no Redux, no Router
const Landing = lazy(() => import('./pages/landing/Landing'));

function AppContent() {
  useAuthenticatedApi(); // Setup JWT interceptor

  return (
    <AnalyticsAuthProvider>
      <ErrorBoundary>
        <BrowserRouter>
          <AppRouter />
        </BrowserRouter>
      </ErrorBoundary>
    </AnalyticsAuthProvider>
  );
}

export default function App() {
  if (isMarketingMode) {
    return <Suspense fallback={null}><Landing /></Suspense>;
  }

  return (
    <ClerkProvider
      publishableKey={window.__env__?.VITE_CLERK_PUBLISHABLE_KEY || import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}
      afterSignOutUrl="/"
    >
      <Provider store={store}>
        <AppContent />
      </Provider>
    </ClerkProvider>
  );
}
