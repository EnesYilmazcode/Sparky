import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Particles } from '../components/Particles';
import { FeatureBadge } from '../components/FeatureBadge';
import { COLORS, FONTS } from '../constants';

const BADGES = [
  { label: 'No Install', dir: 'left' as const },
  { label: '3D Board', dir: 'right' as const },
  { label: 'AI Tutor', dir: 'left' as const },
  { label: 'Save & Load', dir: 'right' as const },
];

export const Closing: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });

  // Bouncy URL spring — low damping for overshoot/jiggle
  const urlSpring = spring({ frame: frame - 50, fps, config: { damping: 5, stiffness: 100, mass: 0.5 } });
  const urlScale = interpolate(urlSpring, [0, 0.5, 0.75, 1], [0.5, 1.1, 0.96, 1]);
  const urlY = interpolate(urlSpring, [0, 1], [30, 0]);

  // Bouncy tagline spring
  const tagSpring = spring({ frame: frame - 75, fps, config: { damping: 6, stiffness: 90, mass: 0.5 } });
  const tagY = interpolate(tagSpring, [0, 1], [18, 0]);

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bgDark, opacity: fadeIn }}>
      <Particles count={25} color={COLORS.accent} baseOpacity={0.2} />

      {/* Feature badges */}
      <div
        style={{
          position: 'absolute', top: 300, width: '100%',
          display: 'flex', justifyContent: 'center', gap: 20,
        }}
      >
        {BADGES.map((badge, i) => (
          <FeatureBadge key={i} label={badge.label} delay={15 + i * 6} fromDirection={badge.dir} />
        ))}
      </div>

      {/* URL — bouncy entrance */}
      <div
        style={{
          position: 'absolute', top: 430, width: '100%',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          transform: `translateY(${urlY}px) scale(${urlScale})`,
          opacity: urlSpring,
        }}
      >
        <span
          style={{
            fontSize: 72, fontFamily: FONTS.primary, fontWeight: 700,
            color: COLORS.textLight, letterSpacing: '-0.02em',
          }}
        >
          sparky.web.app
        </span>
      </div>

      {/* Tagline — bouncy entrance */}
      <div
        style={{
          position: 'absolute', top: 540, width: '100%',
          textAlign: 'center',
          transform: `translateY(${tagY}px)`,
          opacity: tagSpring,
        }}
      >
        <span style={{ fontSize: 26, fontFamily: FONTS.primary, fontWeight: 300, color: COLORS.textMuted }}>
          Get building today.
        </span>
      </div>

      {/* Vignette */}
      <div
        style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.4) 100%)',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
