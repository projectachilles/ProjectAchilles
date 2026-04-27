import type { Appearance } from '@clerk/shared/types';

/**
 * Tactical Green Clerk theme.
 *
 * Mirrors the design tokens in `frontend/src/styles/index.css` so the
 * `<SignIn>`, `<SignUp>`, `<UserProfile>`, and `<UserButton>` widgets
 * blend with the rest of the AchillesShell.
 *
 * Variables drive Clerk's internal colour ramp; element overrides apply
 * Tactical-Green-specific surface, border, and typography rules that the
 * variable system can't express directly.
 *
 * Reference: https://clerk.com/docs/customization/themes
 */
export const clerkAppearance: Appearance = {
  variables: {
    // Brand
    colorPrimary: '#00e68a',
    colorDanger: '#ff3b5c',
    colorSuccess: '#00ffaa',
    colorWarning: '#ffc857',
    // Surfaces — match --bg-deep / --bg-card-solid / --bg-elevated
    colorBackground: '#050810',
    colorInputBackground: '#0d1326',
    colorInputText: '#f0f2f5',
    // Text
    colorText: '#f0f2f5',
    colorTextSecondary: 'rgba(240, 242, 245, 0.72)',
    colorTextOnPrimaryBackground: '#050810',
    colorNeutral: '#f0f2f5',
    // Type
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    fontFamilyButtons: 'Rajdhani, sans-serif',
    fontWeight: {
      normal: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
    },
    // Geometry
    borderRadius: '0.375rem',
    spacingUnit: '1rem',
  },
  elements: {
    // Outer wrapper / centering
    rootBox: 'mx-auto',
    // The card surface itself
    card: [
      'bg-[var(--bg-card-solid)]',
      'border border-[var(--line)]',
      'shadow-[0_8px_32px_rgba(0,0,0,0.45)]',
      'backdrop-blur-md',
    ].join(' '),
    cardBox: 'bg-transparent',
    // Header — Orbitron headline + Rajdhani sub
    headerTitle: [
      'font-[var(--font-display,Orbitron)]',
      'tracking-[0.12em]',
      'text-[var(--text-primary)]',
      'text-lg',
    ].join(' '),
    headerSubtitle: 'text-[var(--text-muted)]',
    // Social / OAuth buttons
    socialButtonsBlockButton: [
      'border border-[var(--line)]',
      'bg-[var(--bg-elevated)]',
      'text-[var(--text-primary)]',
      'hover:border-[var(--accent-dim)]',
      'hover:text-[var(--accent-bright)]',
    ].join(' '),
    socialButtonsBlockButtonText: 'font-medium',
    // Dividers
    dividerLine: 'bg-[var(--line)]',
    dividerText: 'text-[var(--text-muted)] uppercase tracking-[0.2em] text-[10px]',
    // Form labels / inputs
    formFieldLabel: [
      'font-[var(--font-mono,monospace)]',
      'text-[10px]',
      'uppercase',
      'tracking-[0.2em]',
      'text-[var(--text-muted)]',
    ].join(' '),
    formFieldInput: [
      'bg-[var(--bg-card-solid)]',
      'border border-[var(--line)]',
      'text-[var(--text-primary)]',
      'focus:border-[var(--accent-dim)]',
      'focus:ring-2',
      'focus:ring-[var(--accent-bg)]',
    ].join(' '),
    formFieldInputShowPasswordButton: 'text-[var(--text-muted)] hover:text-[var(--accent-bright)]',
    // Primary CTA — accent green wash, dark text
    formButtonPrimary: [
      'bg-[var(--accent)]',
      'text-[#050810]',
      'font-[var(--font-tactical,Rajdhani)]',
      'font-semibold',
      'tracking-[0.12em]',
      'uppercase',
      'border border-[var(--accent)]',
      'hover:bg-[var(--accent-bright)]',
      'hover:shadow-[0_0_16px_var(--accent-glow)]',
      'transition-all',
    ].join(' '),
    // Secondary / footer links
    footerActionLink: 'text-[var(--accent-bright)] hover:text-[var(--accent)] hover:underline',
    footerActionText: 'text-[var(--text-muted)]',
    identityPreviewEditButton: 'text-[var(--accent-bright)] hover:text-[var(--accent)]',
    formResendCodeLink: 'text-[var(--accent-bright)] hover:text-[var(--accent)]',
    // OTP / code input
    otpCodeFieldInput: [
      'bg-[var(--bg-card-solid)]',
      'border border-[var(--line)]',
      'text-[var(--text-primary)]',
      'focus:border-[var(--accent-dim)]',
    ].join(' '),
    // Alerts
    alertText: 'text-[var(--danger)]',
    formFieldErrorText: 'text-[var(--danger)] font-[var(--font-mono,monospace)] text-[11px]',
    // Avatar / user button
    avatarBox: 'border border-[var(--accent-dim)] hover:border-[var(--accent-bright)] transition-colors',
    userButtonAvatarBox: 'w-8 h-8 rounded-full border border-[var(--accent-dim)]',
    userButtonPopoverCard: 'bg-[var(--bg-card-solid)] border border-[var(--line)]',
    userButtonPopoverActionButton: 'text-[var(--text-secondary)] hover:bg-[var(--accent-bg)] hover:text-[var(--accent-bright)]',
    userButtonPopoverActionButtonText: 'text-[var(--text-secondary)]',
    userButtonPopoverFooter: 'border-t border-[var(--line)]',
    // UserProfile navbar / sidebar
    navbar: 'bg-[var(--bg-deep)] border-r border-[var(--line)]',
    navbarButton: 'text-[var(--text-secondary)] hover:bg-[var(--accent-bg)] hover:text-[var(--accent-bright)]',
    navbarButtonText: 'font-[var(--font-tactical,Rajdhani)] tracking-[0.08em] uppercase text-[12px]',
    profileSectionTitle: 'text-[var(--text-primary)] font-[var(--font-display,Orbitron)] tracking-[0.12em]',
    profileSectionTitleText: 'text-[var(--text-primary)]',
    badge: 'bg-[var(--accent-bg)] text-[var(--accent-bright)] border border-[var(--accent-dim)]',
  },
};

/**
 * UserButton-specific overrides — small surface, only needs the avatar
 * and popover bits theming. Keeps TopBar.tsx readable.
 */
export const clerkUserButtonAppearance: Appearance = {
  variables: clerkAppearance.variables,
  elements: {
    avatarBox: 'w-8 h-8 rounded-full border border-[var(--accent-dim)] hover:border-[var(--accent-bright)] transition-colors',
    userButtonPopoverCard: 'bg-[var(--bg-card-solid)] border border-[var(--line)]',
    userButtonPopoverActionButton: 'text-[var(--text-secondary)] hover:bg-[var(--accent-bg)] hover:text-[var(--accent-bright)]',
    userButtonPopoverFooter: 'border-t border-[var(--line)]',
  },
};
