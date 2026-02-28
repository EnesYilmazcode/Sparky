import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { BOARD3D } from '../constants';

const { COLS, HS, BOARD_W, BOARD_D, BOARD_THICK, ROW_Z } = BOARD3D;

const ALL_ROWS = ['tp', 'tn', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'bn', 'bp'];

/** Get world X for a column (0-indexed) */
export function colX(col: number): number {
  return (col - 24.5) * HS;
}

/** Get world Z for a row name */
export function rowZ(row: string): number {
  return ROW_Z[row] ?? 0;
}

/** Create the board top-face canvas texture */
function createBoardTexture(): HTMLCanvasElement {
  const W = 2048, H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Base
  ctx.fillStyle = '#e5e0d2';
  ctx.fillRect(0, 0, W, H);

  // Map world coords to canvas
  const wx = (x: number) => ((x + BOARD_W / 2) / BOARD_W) * W;
  const wz = (z: number) => ((z + BOARD_D / 2) / BOARD_D) * H;

  // Rail bands
  const bandH = (0.29 / BOARD_D) * H;
  const drawRailBand = (z: number, isPos: boolean) => {
    const cy = wz(z);
    ctx.fillStyle = isPos ? 'rgba(210,38,38,0.18)' : 'rgba(38,68,210,0.18)';
    ctx.fillRect(0, cy - bandH / 2, W, bandH);
    ctx.fillStyle = isPos ? 'rgba(195,28,28,0.35)' : 'rgba(28,58,198,0.35)';
    ctx.fillRect(0, cy - 1, W, 2);
  };
  drawRailBand(ROW_Z.tp, true);
  drawRailBand(ROW_Z.tn, false);
  drawRailBand(ROW_Z.bn, true);
  drawRailBand(ROW_Z.bp, false);

  // DIP channel
  const chTop = wz(-0.31), chBot = wz(0.31);
  const grad = ctx.createLinearGradient(0, chTop, 0, chBot);
  grad.addColorStop(0, '#9e9480');
  grad.addColorStop(0.5, '#877e6c');
  grad.addColorStop(1, '#9e9480');
  ctx.fillStyle = grad;
  ctx.fillRect(0, chTop, W, chBot - chTop);

  // Holes
  for (const row of ALL_ROWS) {
    const z = ROW_Z[row];
    for (let col = 0; col < COLS; col++) {
      const x = colX(col);
      const cx = wx(x);
      const cy = wz(z);
      // Brass rim
      const rimGrad = ctx.createRadialGradient(cx, cy, 3, cx, cy, 10);
      rimGrad.addColorStop(0, '#b8a050');
      rimGrad.addColorStop(0.6, '#a08830');
      rimGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = rimGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.fill();
      // Dark socket
      ctx.fillStyle = '#0d0b08';
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return canvas;
}

export const Board3D: React.FC<{ opacity?: number }> = ({ opacity = 1 }) => {
  const meshRef = useRef<THREE.Mesh>(null);

  const texture = useMemo(() => {
    const canvas = createBoardTexture();
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    return tex;
  }, []);

  const holeMesh = useMemo(() => {
    const geo = new THREE.CylinderGeometry(0.058, 0.046, BOARD_THICK + 0.04, 8);
    const mat = new THREE.MeshLambertMaterial({ color: 0x0c0a08 });
    const mesh = new THREE.InstancedMesh(geo, mat, COLS * ALL_ROWS.length);

    const dummy = new THREE.Object3D();
    let idx = 0;
    for (const row of ALL_ROWS) {
      const z = ROW_Z[row];
      for (let col = 0; col < COLS; col++) {
        dummy.position.set(colX(col), 0, z);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx++, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }, []);

  return (
    <group>
      {/* Ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.21, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshLambertMaterial color={0x9c9790} />
      </mesh>

      {/* Board body */}
      <mesh position={[0, -BOARD_THICK / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[BOARD_W, BOARD_THICK, BOARD_D]} />
        <meshLambertMaterial color={0xd8d4c8} transparent opacity={opacity} />
      </mesh>

      {/* Top face texture */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <planeGeometry args={[BOARD_W, BOARD_D]} />
        <meshBasicMaterial map={texture} transparent opacity={opacity} />
      </mesh>

      {/* Rail strips */}
      {[
        { z: ROW_Z.tp, color: 0xbb1e1e },
        { z: ROW_Z.tn, color: 0x1e30bb },
        { z: ROW_Z.bn, color: 0xbb1e1e },
        { z: ROW_Z.bp, color: 0x1e30bb },
      ].map((r, i) => (
        <mesh key={i} position={[0, 0.003, r.z]}>
          <boxGeometry args={[BOARD_W - 1.4, 0.005, 0.21]} />
          <meshLambertMaterial color={r.color} transparent opacity={0.5 * opacity} />
        </mesh>
      ))}

      {/* DIP channel groove */}
      <mesh position={[0, 0.002, 0]}>
        <boxGeometry args={[BOARD_W - 0.3, 0.01, 0.62]} />
        <meshLambertMaterial color={0x8c8270} transparent opacity={opacity} />
      </mesh>

      {/* Edge banding */}
      {[
        { pos: [0, -BOARD_THICK / 2, BOARD_D / 2 + 0.035] as [number, number, number], size: [BOARD_W + 0.12, BOARD_THICK + 0.05, 0.07] as [number, number, number] },
        { pos: [0, -BOARD_THICK / 2, -BOARD_D / 2 - 0.035] as [number, number, number], size: [BOARD_W + 0.12, BOARD_THICK + 0.05, 0.07] as [number, number, number] },
        { pos: [BOARD_W / 2 + 0.035, -BOARD_THICK / 2, 0] as [number, number, number], size: [0.07, BOARD_THICK + 0.05, BOARD_D + 0.14] as [number, number, number] },
        { pos: [-BOARD_W / 2 - 0.035, -BOARD_THICK / 2, 0] as [number, number, number], size: [0.07, BOARD_THICK + 0.05, BOARD_D + 0.14] as [number, number, number] },
      ].map((e, i) => (
        <mesh key={i} position={e.pos}>
          <boxGeometry args={e.size} />
          <meshLambertMaterial color={0xb4aca0} transparent opacity={opacity} />
        </mesh>
      ))}

      {/* Holes (instanced) */}
      <primitive object={holeMesh} />
    </group>
  );
};
