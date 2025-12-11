import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { Provider, useDispatch } from 'react-redux';
import { ThemeProvider } from './hooks/useTheme';
import { AnalyticsAuthProvider } from './hooks/useAnalyticsAuth';
import { store, type AppDispatch } from './store';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { checkSession } from './store/endpointAuthSlice';
import AppRouter from './routes/AppRouter';

function AppContent() {
  const dispatch = useDispatch<AppDispatch>();

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
    <Provider store={store}>
      <AppContent />
    </Provider>
  );
}
