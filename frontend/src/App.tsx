import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { Provider, useDispatch } from 'react-redux';
import { ClerkProvider } from '@clerk/clerk-react';
import { ThemeProvider } from './hooks/useTheme';
import { AnalyticsAuthProvider } from './hooks/useAnalyticsAuth';
import { useAuthenticatedApi } from './hooks/useAuthenticatedApi';
import { store, type AppDispatch } from './store';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { checkSession } from './store/endpointAuthSlice';
import AppRouter from './routes/AppRouter';

// Hero page styles
import './styles/hero.css';

function AppContent() {
  const dispatch = useDispatch<AppDispatch>();
  useAuthenticatedApi(); // Setup JWT interceptor

  // BUG FIX #1: Check session on app mount to persist authentication
  useEffect(() => {
    dispatch(checkSession());
  }, [dispatch]);

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
  return (
    <ClerkProvider
      publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}
      afterSignOutUrl="/"
    >
      <Provider store={store}>
        <AppContent />
      </Provider>
    </ClerkProvider>
  );
}
