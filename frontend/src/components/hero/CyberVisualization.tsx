import { useEffect, useRef } from 'react';

/**
 * Animated cyber security visualization for the hero section.
 * Features a central hexagonal shield with radiating network connections,
 * pulsing nodes, and scanning effects.
 */
export default function CyberVisualization() {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    // Add slight parallax effect on mouse move
    const handleMouseMove = (e: MouseEvent) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const deltaX = (e.clientX - centerX) / 50;
      const deltaY = (e.clientY - centerY) / 50;
      svgRef.current.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <div className="cyber-viz-container">
      <svg
        ref={svgRef}
        viewBox="0 0 400 400"
        className="cyber-viz"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Glow filter */}
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Strong glow for accents */}
          <filter id="glowStrong" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Gradient for shield */}
          <linearGradient id="shieldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--hero-accent)" stopOpacity="0.3" />
            <stop offset="50%" stopColor="var(--hero-accent)" stopOpacity="0.1" />
            <stop offset="100%" stopColor="var(--hero-accent)" stopOpacity="0.2" />
          </linearGradient>

          {/* Radial gradient for center */}
          <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--hero-accent)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--hero-accent)" stopOpacity="0" />
          </radialGradient>

          {/* Line gradient */}
          <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--hero-accent)" stopOpacity="0" />
            <stop offset="50%" stopColor="var(--hero-accent)" stopOpacity="0.8" />
            <stop offset="100%" stopColor="var(--hero-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Background glow */}
        <circle cx="200" cy="200" r="150" fill="url(#centerGlow)" className="cyber-bg-glow" />

        {/* Outer rotating ring */}
        <g className="cyber-outer-ring">
          <circle
            cx="200"
            cy="200"
            r="160"
            fill="none"
            stroke="var(--hero-accent)"
            strokeWidth="0.5"
            strokeOpacity="0.3"
            strokeDasharray="10 20"
          />
        </g>

        {/* Middle dashed ring */}
        <circle
          cx="200"
          cy="200"
          r="130"
          fill="none"
          stroke="var(--hero-accent)"
          strokeWidth="1"
          strokeOpacity="0.2"
          strokeDasharray="4 8"
          className="cyber-middle-ring"
        />

        {/* Network connection lines */}
        <g className="cyber-network-lines" filter="url(#glow)">
          {/* Radiating lines from center */}
          {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((angle, i) => {
            const rad = (angle * Math.PI) / 180;
            const x1 = 200 + Math.cos(rad) * 40;
            const y1 = 200 + Math.sin(rad) * 40;
            const x2 = 200 + Math.cos(rad) * 140;
            const y2 = 200 + Math.sin(rad) * 140;
            return (
              <line
                key={angle}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="var(--hero-accent)"
                strokeWidth="1"
                strokeOpacity="0.3"
                className={`cyber-line cyber-line-${i}`}
              />
            );
          })}
        </g>

        {/* Outer nodes */}
        <g className="cyber-nodes" filter="url(#glow)">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => {
            const rad = (angle * Math.PI) / 180;
            const x = 200 + Math.cos(rad) * 140;
            const y = 200 + Math.sin(rad) * 140;
            return (
              <g key={angle} className={`cyber-node cyber-node-${i}`}>
                <circle cx={x} cy={y} r="6" fill="var(--hero-bg-deep)" stroke="var(--hero-accent)" strokeWidth="1.5" />
                <circle cx={x} cy={y} r="3" fill="var(--hero-accent)" className="cyber-node-core" />
              </g>
            );
          })}
        </g>

        {/* Inner hexagon shield */}
        <g className="cyber-shield" filter="url(#glowStrong)">
          <polygon
            points="200,120 269,160 269,240 200,280 131,240 131,160"
            fill="url(#shieldGradient)"
            stroke="var(--hero-accent)"
            strokeWidth="2"
          />
          {/* Inner hexagon */}
          <polygon
            points="200,145 247,172 247,228 200,255 153,228 153,172"
            fill="none"
            stroke="var(--hero-accent)"
            strokeWidth="1"
            strokeOpacity="0.5"
          />
        </g>

        {/* Center shield icon */}
        <g className="cyber-center-icon" filter="url(#glow)">
          {/* Shield shape */}
          <path
            d="M200,160 L230,175 L230,210 C230,230 200,245 200,245 C200,245 170,230 170,210 L170,175 Z"
            fill="var(--hero-accent)"
            fillOpacity="0.2"
            stroke="var(--hero-accent)"
            strokeWidth="2"
          />
          {/* Checkmark */}
          <path
            d="M185,200 L195,210 L215,185"
            fill="none"
            stroke="var(--hero-accent)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="cyber-checkmark"
          />
        </g>

        {/* Scanning arc */}
        <g className="cyber-scan-arc">
          <path
            d="M200,200 L200,60 A140,140 0 0,1 340,200 Z"
            fill="var(--hero-accent)"
            fillOpacity="0.05"
          />
        </g>

        {/* Data particles */}
        <g className="cyber-particles">
          {[0, 1, 2, 3, 4].map((i) => (
            <circle
              key={i}
              r="2"
              fill="var(--hero-accent)"
              className={`cyber-particle cyber-particle-${i}`}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
