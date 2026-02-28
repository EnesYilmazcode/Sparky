import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { colX, rowZ } from './Board3D';
import { BOARD3D } from '../constants';

const HS = BOARD3D.HS;

// ─── BATTERY ────────────────────────────────────────────
export const Battery3D: React.FC<{
  worldX?: number;
  worldZ?: number;
  opacity?: number;
  scale?: number;
}> = ({ worldX = 12.5, worldZ = 0, opacity = 1, scale = 1 }) => {
  return (
    <group position={[worldX, 0, worldZ]} scale={[scale, scale, scale]}>
      {/* Body */}
      <mesh position={[0, 1.3, 0]} castShadow>
        <boxGeometry args={[2.0, 2.6, 1.4]} />
        <meshLambertMaterial color={0x111111} transparent opacity={opacity} />
      </mesh>
      {/* Snap connector */}
      <mesh position={[0, 2.71, 0]}>
        <boxGeometry args={[1.3, 0.22, 0.77]} />
        <meshLambertMaterial color={0x333333} transparent opacity={opacity} />
      </mesh>
      {/* Positive terminal */}
      <mesh position={[-0.32, 2.97, 0]}>
        <cylinderGeometry args={[0.13, 0.13, 0.30, 14]} />
        <meshLambertMaterial color={0xff3333} emissive={0x880000} emissiveIntensity={0.5} transparent opacity={opacity} />
      </mesh>
      <mesh position={[-0.32, 3.15, 0]}>
        <cylinderGeometry args={[0.19, 0.19, 0.07, 16]} />
        <meshLambertMaterial color={0xff1111} emissive={0xaa0000} emissiveIntensity={0.6} transparent opacity={opacity} />
      </mesh>
      {/* Positive halo */}
      <mesh position={[-0.32, 2.83, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.26, 0.04, 8, 20]} />
        <meshLambertMaterial color={0xff2222} emissive={0xcc0000} emissiveIntensity={0.9} transparent opacity={opacity} />
      </mesh>
      {/* Negative terminal */}
      <mesh position={[0.32, 2.70, 0]}>
        <cylinderGeometry args={[0.28, 0.28, 0.10, 18]} />
        <meshLambertMaterial color={0x2244cc} emissive={0x001166} emissiveIntensity={0.4} transparent opacity={opacity} />
      </mesh>
      <mesh position={[0.32, 2.84, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.24, 0.09, 9, 18]} />
        <meshLambertMaterial color={0x3366ff} emissive={0x001188} emissiveIntensity={0.5} transparent opacity={opacity} />
      </mesh>
      {/* Negative halo */}
      <mesh position={[0.32, 2.83, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.36, 0.04, 8, 20]} />
        <meshLambertMaterial color={0x2255ff} emissive={0x0033cc} emissiveIntensity={0.9} transparent opacity={opacity} />
      </mesh>
    </group>
  );
};

// ─── RESISTOR ───────────────────────────────────────────
export const Resistor3D: React.FC<{
  colA: number;
  rowA: string;
  colB: number;
  rowB: string;
  opacity?: number;
  scale?: number;
}> = ({ colA, rowA, colB, rowB, opacity = 1, scale = 1 }) => {
  const ax = colX(colA), az = rowZ(rowA);
  const bx = colX(colB), bz = rowZ(rowB);
  const cx = (ax + bx) / 2, cz = (az + bz) / 2;
  const dx = bx - ax, dz = bz - az;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const angle = Math.atan2(dx, dz);
  const bodyLen = dist * 0.56;
  const LEAD_H = 0.72;
  const bands = [0xf87171, 0xfb923c, 0xfbbf24, 0xa3e635];

  return (
    <group scale={[scale, scale, scale]}>
      {/* Vertical leads */}
      {[[ax, az], [bx, bz]].map(([x, z], i) => (
        <mesh key={i} position={[x, LEAD_H / 2, z]}>
          <cylinderGeometry args={[0.022, 0.022, LEAD_H, 7]} />
          <meshLambertMaterial color={0xc0c0c0} transparent opacity={opacity} />
        </mesh>
      ))}
      {/* Body */}
      <mesh position={[cx, LEAD_H, cz]} rotation={[0, angle, Math.PI / 2]}>
        <cylinderGeometry args={[0.10, 0.10, bodyLen, 14]} />
        <meshLambertMaterial color={0xd4a96a} transparent opacity={opacity} />
      </mesh>
      {/* Color bands */}
      {bands.map((color, i) => {
        const t = (i - 1.5) / 4;
        const bx2 = cx + Math.sin(angle) * bodyLen * t;
        const bz2 = cz + Math.cos(angle) * bodyLen * t;
        return (
          <mesh key={i} position={[bx2, LEAD_H, bz2]} rotation={[0, angle, Math.PI / 2]}>
            <cylinderGeometry args={[0.104, 0.104, bodyLen * 0.08, 14]} />
            <meshLambertMaterial color={color} transparent opacity={opacity} />
          </mesh>
        );
      })}
    </group>
  );
};

// ─── LED ────────────────────────────────────────────────
export const LED3D: React.FC<{
  colA: number; // cathode
  rowA: string;
  colB: number; // anode
  rowB: string;
  color?: number;
  glowing?: boolean;
  glowIntensity?: number;
  opacity?: number;
  scale?: number;
}> = ({ colA, rowA, colB, rowB, color = 0xff2222, glowing = false, glowIntensity = 0, opacity = 1, scale = 1 }) => {
  const ax = colX(colA), az = rowZ(rowA);
  const bx = colX(colB), bz = rowZ(rowB);
  const cx = (ax + bx) / 2, cz = (az + bz) / 2;
  const LEAD_H = 0.88;
  const emissiveI = glowing ? 2.2 * glowIntensity : 0.45;

  return (
    <group scale={[scale, scale, scale]}>
      {/* Leads */}
      {[[ax, az], [bx, bz]].map(([x, z], i) => (
        <mesh key={i} position={[x, LEAD_H / 2, z]}>
          <cylinderGeometry args={[0.023, 0.023, LEAD_H, 7]} />
          <meshLambertMaterial color={0xc0c0c0} transparent opacity={opacity} />
        </mesh>
      ))}
      {/* Collar */}
      <mesh position={[cx, LEAD_H - 0.04, cz]}>
        <cylinderGeometry args={[0.185, 0.185, 0.11, 18]} />
        <meshLambertMaterial color={0x2a2a2a} transparent opacity={opacity} />
      </mesh>
      {/* Dome */}
      <mesh position={[cx, LEAD_H + 0.04, cz]}>
        <sphereGeometry args={[0.185, 22, 11, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        <meshLambertMaterial
          color={color}
          emissive={color}
          emissiveIntensity={emissiveI}
          transparent
          opacity={glowing ? 0.95 * opacity : 0.7 * opacity}
        />
      </mesh>
      {/* Point light when glowing */}
      {glowing && glowIntensity > 0.1 && (
        <pointLight
          position={[cx, LEAD_H + 0.3, cz]}
          color={color}
          intensity={3 * glowIntensity}
          distance={6}
          decay={2}
        />
      )}
    </group>
  );
};

// ─── WIRE ───────────────────────────────────────────────
export const Wire3D: React.FC<{
  fromCol?: number;
  fromRow?: string;
  toCol?: number;
  toRow?: string;
  fromWorld?: [number, number, number];
  toWorld?: [number, number, number];
  color: number;
  opacity?: number;
}> = ({ fromCol, fromRow, toCol, toRow, fromWorld, toWorld, color, opacity = 1 }) => {
  const tube = useMemo(() => {
    // Resolve endpoints: world coords override col/row
    const fx = fromWorld ? fromWorld[0] : colX(fromCol!);
    const fy = fromWorld ? fromWorld[1] : 0.05;
    const fz = fromWorld ? fromWorld[2] : rowZ(fromRow!);
    const tx = toWorld ? toWorld[0] : colX(toCol!);
    const ty = toWorld ? toWorld[1] : 0.05;
    const tz = toWorld ? toWorld[2] : rowZ(toRow!);

    const mx = (fx + tx) / 2, mz = (fz + tz) / 2;
    const maxY = Math.max(fy, ty);
    const rise = maxY + 0.7;

    const points = [
      new THREE.Vector3(fx, fy, fz),
      new THREE.Vector3(fx, fy + (rise - fy) * 0.3, fz + (mz - fz) * 0.2),
      new THREE.Vector3(mx, rise, mz),
      new THREE.Vector3(tx, ty + (rise - ty) * 0.3, tz + (mz - tz) * 0.2),
      new THREE.Vector3(tx, ty, tz),
    ];
    const curve = new THREE.CatmullRomCurve3(points);
    return new THREE.TubeGeometry(curve, 32, 0.06, 8, false);
  }, [fromCol, fromRow, toCol, toRow, fromWorld?.[0], fromWorld?.[1], fromWorld?.[2], toWorld?.[0], toWorld?.[1], toWorld?.[2]]);

  return (
    <mesh geometry={tube}>
      <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} transparent opacity={opacity} />
    </mesh>
  );
};
