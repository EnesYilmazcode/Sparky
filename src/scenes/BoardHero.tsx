import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { ThreeCanvas } from '@remotion/three';
import * as THREE from 'three';
import { Board3D } from '../components/Board3D';
import { Battery3D, Resistor3D, LED3D, Wire3D } from '../components/Components3D';
import { COLORS, FONTS } from '../constants';

export const BoardHero: React.FC = () => {
  const frame = useCurrentFrame();

  // Camera orbit animation
  const orbitAngle = interpolate(frame, [0, 330], [0.3, -0.5], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });
  const camDist = interpolate(frame, [0, 60, 200], [38, 28, 26], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });
  const camHeight = interpolate(frame, [0, 60, 200], [26, 20, 18], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });
  const fadeIn = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });

  const camX = Math.sin(orbitAngle) * camDist;
  const camZ = Math.cos(orbitAngle) * camDist;

  // Simulation trigger at frame 150
  const simActive = frame >= 150;
  const glowIntensity = interpolate(frame, [150, 190], [0, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });

  // Simulate button
  const btnOpacity = interpolate(frame, [80, 100], [0, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });
  const btnScale = frame >= 140 && frame <= 155
    ? interpolate(frame, [140, 147, 155], [1, 0.92, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' })
    : 1;

  // Label
  const labelOpacity = interpolate(frame, [200, 230], [0, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bgCanvas }}>
      <div style={{ width: '100%', height: '100%', opacity: fadeIn }}>
        <ThreeCanvas
          width={1920}
          height={1080}
          camera={{
            fov: 42,
            position: new THREE.Vector3(camX, camHeight, camZ),
            near: 0.1,
            far: 300,
          }}
          style={{ width: '100%', height: '100%' }}
        >
          {/* Lighting */}
          <ambientLight intensity={0.70} color={0xffffff} />
          <directionalLight
            position={[18, 35, 22]}
            intensity={1.05}
            color={0xfffaf0}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
          />
          <directionalLight position={[-12, 8, -8]} intensity={0.35} color={0xd0e8ff} />

          {/* Board */}
          <Board3D />

          {/* Pre-placed circuit: battery + resistor + LED + wires */}
          <Battery3D worldX={12.5} worldZ={0} />
          <Resistor3D colA={8} rowA="c" colB={12} rowB="c" />
          <LED3D
            colA={14} rowA="c" colB={13} rowB="c"
            glowing={simActive}
            glowIntensity={glowIntensity}
            color={0xff2222}
          />

          {/* Wires */}
          <Wire3D fromCol={5} fromRow="tp" toCol={5} toRow="a" color={0xef4444} />
          <Wire3D fromCol={8} fromRow="a" toCol={8} toRow="c" color={0xef4444} />
          <Wire3D fromCol={15} fromRow="c" toCol={15} toRow="tn" color={0x333333} />
        </ThreeCanvas>
      </div>

      {/* Simulate button overlay */}
      <div
        style={{
          position: 'absolute', top: 40, left: '50%',
          transform: `translateX(-50%) scale(${btnScale})`,
          opacity: btnOpacity,
        }}
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: simActive ? '#16a34a' : COLORS.accent,
            color: 'white', padding: '10px 24px', borderRadius: 10,
            fontSize: 16, fontFamily: FONTS.primary, fontWeight: 600,
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          }}
        >
          <span style={{ fontSize: 18 }}>{simActive ? '\u25A0' : '\u25B6'}</span>
          {simActive ? 'Simulating...' : 'Run Simulation'}
        </div>
      </div>

      {/* Bottom label */}
      <div
        style={{
          position: 'absolute', bottom: 50, width: '100%', textAlign: 'center',
          opacity: labelOpacity,
        }}
      >
        <span style={{ fontSize: 22, fontFamily: FONTS.primary, fontWeight: 600, color: COLORS.textPrimary }}>
          Interactive 3D Breadboard
        </span>
        <span style={{ fontSize: 16, fontFamily: FONTS.primary, fontWeight: 300, color: COLORS.textMuted, marginLeft: 14 }}>
          830 holes &middot; Real-time simulation &middot; No install required
        </span>
      </div>
    </AbsoluteFill>
  );
};
