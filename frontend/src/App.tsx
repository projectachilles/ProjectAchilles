import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { ClerkProvider } from '@clerk/clerk-react';
import { ThemeProvider } from './hooks/useTheme';
import { AnalyticsAuthProvider } from './hooks/useAnalyticsAuth';
import { useAuthenticatedApi } from './hooks/useAuthenticatedApi';
import { store } from './store';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import AppRouter from './routes/AppRouter';

// Hero page styles
import './styles/hero.css';

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
