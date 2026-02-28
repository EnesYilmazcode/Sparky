import React, { useMemo } from 'react';
import { useCurrentFrame, interpolate } from 'remotion';

export const SparkEffect: React.FC<{
  burstFrame: number;
  x: number;
  y: number;
  color?: string;
  count?: number;
}> = ({ burstFrame, x, y, color = '#2563eb', count = 12 }) => {
  const frame = useCurrentFrame();

  const sparks = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 + (i * 0.3);
      const speed = 40 + (i % 3) * 25;
      const size = 2 + (i % 4);
      return { angle, speed, size };
    });
  }, [count]);

  const elapsed = frame - burstFrame;
  if (elapsed < 0 || elapsed > 25) return null;

  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      {sparks.map((s, i) => {
        const dist = interpolate(elapsed, [0, 20], [0, s.speed], { extrapolateRight: 'clamp' });
        const opacity = interpolate(elapsed, [0, 5, 20], [0, 1, 0], { extrapolateRight: 'clamp' });
        const sx = x + Math.cos(s.angle) * dist;
        const sy = y + Math.sin(s.angle) * dist;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: sx - s.size / 2,
              top: sy - s.size / 2,
              width: s.size,
              height: s.size,
              borderRadius: '50%',
              backgroundColor: color,
              opacity,
              boxShadow: `0 0 ${s.size * 2}px ${color}`,
            }}
          />
        );
      })}
    </div>
  );
};
