import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Particles } from '../components/Particles';
import { SparkEffect } from '../components/SparkEffect';
import { COLORS, FONTS } from '../constants';

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Everything happens fast — 20% compressed
  const boltDraw = interpolate(frame, [2, 14], [100, 0], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });
  const boltFill = interpolate(frame, [12, 18], [0, 0.9], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });

  // Bouncy title spring — low damping for overshoot/jiggle
  const titleSpring = spring({ frame: frame - 8, fps, config: { damping: 5, stiffness: 120, mass: 0.5 } });
  const titleY = interpolate(titleSpring, [0, 1], [40, 0]);
  const titleScale = interpolate(titleSpring, [0, 0.5, 0.75, 1], [0.6, 1.08, 0.97, 1]);

  // Bouncy tagline spring — slightly delayed, also jiggly
  const tagSpring = spring({ frame: frame - 22, fps, config: { damping: 6, stiffness: 100, mass: 0.5 } });
  const tagY = interpolate(tagSpring, [0, 1], [20, 0]);

  // Exit fast
  const exitScale = interpolate(frame, [64, 84], [1, 0.88], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });
  const exitOpacity = interpolate(frame, [68, 84], [1, 0], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bgDark }}>
      <Particles count={25} color={COLORS.accent} baseOpacity={0.25} />

      <div
        style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          transform: `scale(${exitScale})`,
          opacity: exitOpacity,
        }}
      >

        {/* Lightning bolt */}
        <svg width={72} height={72} viewBox="0 0 24 24" style={{ marginBottom: 14 }}>
          <defs>
            <filter id="bG">
              <feGaussianBlur stdDeviation="2" />
              <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <path
            d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
            fill="none" stroke={COLORS.accent} strokeWidth={1.5}
            strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray={100} strokeDashoffset={boltDraw}
            filter="url(#bG)"
          />
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill={COLORS.accent} opacity={boltFill} />
        </svg>

        {/* Title — bouncy entrance */}
        <h1
          style={{
            fontSize: 110, fontFamily: FONTS.primary, fontWeight: 700,
            color: COLORS.textLight, letterSpacing: '-0.04em', margin: 0,
            transform: `translateY(${titleY}px) scale(${titleScale})`,
            opacity: titleSpring,
          }}
        >
          Sparky
        </h1>

        <SparkEffect burstFrame={16} x={960} y={440} color={COLORS.accent} count={14} />

        {/* Tagline — bouncy entrance */}
        <p
          style={{
            fontSize: 32, fontFamily: FONTS.primary, fontWeight: 300,
            color: COLORS.textMuted, margin: 0, marginTop: 12,
            transform: `translateY(${tagY}px)`,
            opacity: tagSpring,
          }}
        >
          Build circuits. Get <span style={{ fontStyle: 'italic', color: COLORS.accentLight }}>AI</span> guidance.
        </p>
      </div>
    </AbsoluteFill>
  );
};
