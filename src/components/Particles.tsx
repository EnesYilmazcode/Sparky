import React, { useMemo } from 'react';
import { useCurrentFrame } from 'remotion';
import { COLORS } from '../constants';

interface ParticleData {
  x: number;
  y: number;
  speed: number;
  size: number;
  opacity: number;
  drift: number;
}

export const Particles: React.FC<{
  count?: number;
  color?: string;
  baseOpacity?: number;
}> = ({ count = 40, color = COLORS.accent, baseOpacity = 0.4 }) => {
  const frame = useCurrentFrame();

  const particles = useMemo<ParticleData[]>(() => {
    const seed = (i: number) => {
      const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    return Array.from({ length: count }, (_, i) => ({
      x: seed(i) * 1920,
      y: seed(i + 50) * 1080,
      speed: 0.3 + seed(i + 100) * 0.8,
      size: 1.5 + seed(i + 150) * 3,
      opacity: (0.2 + seed(i + 200) * 0.6) * baseOpacity,
      drift: (seed(i + 250) - 0.5) * 0.5,
    }));
  }, [count, baseOpacity]);

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {particles.map((p, i) => {
        const y = ((p.y - frame * p.speed) % 1120 + 1120) % 1120 - 40;
        const x = p.x + Math.sin(frame * 0.02 + i) * 20 * p.drift;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: p.size,
              height: p.size,
              borderRadius: '50%',
              backgroundColor: color,
              opacity: p.opacity,
              filter: `blur(${p.size > 3 ? 1 : 0}px)`,
            }}
          />
        );
      })}
    </div>
  );
};
