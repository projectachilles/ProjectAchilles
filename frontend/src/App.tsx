import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { ThemeProvider } from './hooks/useTheme';
import { AnalyticsAuthProvider } from './hooks/useAnalyticsAuth';
import { store } from './store';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import AppRouter from './routes/AppRouter';

export default function App() {
  return (
    <Provider store={store}>
      <ThemeProvider defaultTheme="dark">
        <AnalyticsAuthProvider>
          <ErrorBoundary>
            <BrowserRouter>
              <AppRouter />
            </BrowserRouter>
          </ErrorBoundary>
        </AnalyticsAuthProvider>
      </ThemeProvider>
    </Provider>
  );
}
