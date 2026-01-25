/**
 * ACHILLES text logo component with tactical styling.
 * Uses Orbitron font to match the hero page aesthetic.
 */

interface AchillesLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export default function AchillesLogo({ className = '', size = 'md' }: AchillesLogoProps) {
  const sizeClasses = {
    sm: 'text-lg tracking-wider',
    md: 'text-xl tracking-wider',
    lg: 'text-2xl tracking-widest',
  };

  return (
    <span
      className={`achilles-logo font-bold ${sizeClasses[size]} ${className}`}
      style={{
        fontFamily: "'Orbitron', sans-serif",
        color: 'var(--hero-text-primary)',
        letterSpacing: '0.15em',
      }}
    >
      <span className="achilles-logo-bracket" style={{ color: 'var(--hero-accent)', opacity: 0.7 }}>[</span>
      ACHILLES
      <span className="achilles-logo-bracket" style={{ color: 'var(--hero-accent)', opacity: 0.7 }}>]</span>
    </span>
  );
}
