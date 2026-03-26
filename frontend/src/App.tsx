import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { ClerkProvider } from '@clerk/clerk-react';
import { ThemeProvider } from './hooks/useTheme';
import { AnalyticsAuthProvider } from './hooks/useAnalyticsAuth';
import { useAuthenticatedApi } from './hooks/useAuthenticatedApi';
import { store } from './store';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import AppRouter from './routes/AppRouter';
import { isMarketingMode } from './lib/siteMode';

// Hero page styles
import './styles/hero.css';

// Marketing mode: static landing page — no Clerk, no Redux, no Router
import HeroPage from './pages/HeroPage';

function AppContent() {
  useAuthenticatedApi(); // Setup JWT interceptor

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
    return <HeroPage />;
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
