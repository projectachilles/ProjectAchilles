import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock Clerk globally for all frontend tests
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({
    isSignedIn: true,
    isLoaded: true,
    userId: 'test-user-001',
    getToken: vi.fn().mockResolvedValue('test-jwt-token'),
  }),
  useUser: () => ({
    user: { id: 'test-user-001', firstName: 'Test', lastName: 'User' },
    isLoaded: true,
    isSignedIn: true,
  }),
  useClerk: () => ({
    signOut: vi.fn(),
  }),
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  SignedIn: ({ children }: { children: React.ReactNode }) => children,
  SignedOut: () => null,
  RedirectToSignIn: () => null,
}));
