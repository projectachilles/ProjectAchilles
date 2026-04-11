import { lazy, Suspense } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { ThemeProvider } from './hooks/useTheme';
import { AnalyticsAuthProvider } from './hooks/useAnalyticsAuth';
import { store } from './store';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import AppRouter from './routes/AppRouter';
import { isMarketingMode } from './lib/siteMode';
import { AuthProvider } from './contexts/AuthContext';

// Marketing mode: lazy-loaded landing page — no auth, no Redux, no Router
const HeroPage = lazy(() => import('./pages/HeroPage'));

/** Shared app shell — used by ALL auth modes */
function AppShell() {
  return (
    <ThemeProvider defaultTheme="dark">
      <AnalyticsAuthProvider>
        <ErrorBoundary>
          <BrowserRouter>
            <AppRouter />
          </BrowserRouter>
        </ErrorBoundary>
      </AnalyticsAuthProvider>
    </ThemeProvider>
  );
}

export default function App() {
  if (isMarketingMode) {
    return <Suspense fallback={null}><HeroPage /></Suspense>;
  }

  // AuthProvider is ALWAYS the auth layer.
  // Clerk, Azure AD, Google all flow through AuthContext.
  return (
    <AuthProvider>
      <Provider store={store}>
        <AppShell />
      </Provider>
    </AuthProvider>
  );
}
