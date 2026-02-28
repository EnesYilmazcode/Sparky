import React from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { FONTS } from '../constants';

export const FeatureBadge: React.FC<{
  label: string;
  delay: number;
  fromDirection?: 'left' | 'right';
}> = ({ label, delay, fromDirection = 'left' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({
    frame: frame - delay,
    fps,
    config: { damping: 12, stiffness: 80, mass: 0.8 },
  });

  const translateX = (1 - progress) * (fromDirection === 'left' ? -250 : 250);
  const opacity = progress;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '12px 28px',
        borderRadius: 30,
        border: '1px solid rgba(255,255,255,0.15)',
        background: 'rgba(255,255,255,0.06)',
        backdropFilter: 'blur(8px)',
        color: '#ffffff',
        fontSize: 18,
        fontWeight: 500,
        fontFamily: FONTS.primary,
        letterSpacing: '0.02em',
        transform: `translateX(${translateX}px)`,
        opacity,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </div>
  );
};
