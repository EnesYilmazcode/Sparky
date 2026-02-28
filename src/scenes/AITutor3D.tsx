import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { ThreeCanvas } from '@remotion/three';
import * as THREE from 'three';
import { Board3D } from '../components/Board3D';
import { Battery3D, Resistor3D, LED3D, Wire3D } from '../components/Components3D';
import { ChatMessage } from '../components/ChatMessage';
import { COLORS, FONTS } from '../constants';

const CHAT_W = 480;  // chat panel width in px
const BOARD_W_PX = 1920 - CHAT_W; // 3D canvas fills the rest exactly — no gap

const USER_MSG = 'How do I build a 3-LED parallel circuit?';
const AI_MSG = "I'll build a 3-LED parallel circuit for you — each LED gets its own 220\u2126 resistor for current limiting, all powered by a 9V battery.";

// ─── Cursor ─────────────────────────────────────────────
const Cursor: React.FC<{ x: number; y: number; opacity: number; clicking: boolean }> = ({ x, y, opacity, clicking }) => (
  <svg
    width={30} height={30} viewBox="0 0 24 24"
    style={{
      position: 'absolute', left: x, top: y, opacity,
      transform: clicking ? 'scale(0.8)' : 'scale(1)',
      filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.35))',
      pointerEvents: 'none', zIndex: 100,
    }}
  >
    <path d="M5 3l14 8-6 1.5 3.5 6.5-2.5 1.5L10.5 14 7 19z" fill="white" stroke="#333" strokeWidth={1} />
  </svg>
);

// ─── Click Ripple ───────────────────────────────────────
const ClickRipple: React.FC<{ x: number; y: number; frame: number; trigger: number; color?: string }> = ({ x, y, frame, trigger, color = COLORS.accent }) => {
  const t = frame - trigger;
  if (t < 0 || t > 20) return null;
  return (
    <div style={{
      position: 'absolute', left: x - 30, top: y - 30,
      width: 60, height: 60, borderRadius: '50%',
      border: `3px solid ${color}`,
      transform: `scale(${interpolate(t, [0, 20], [0.3, 2.5])})`,
      opacity: interpolate(t, [0, 5, 20], [0, 0.7, 0]),
      boxShadow: `0 0 20px ${color}40`,
      pointerEvents: 'none', zIndex: 99,
    }} />
  );
};

// ─── Main Scene ─────────────────────────────────────────
export const AITutor3D: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // ── Timeline ──
  const USER_START = 15;
  const USER_END = 55;
  const TYPING_START = 60;
  const TYPING_END = 80;
  const AI_START = 80;
  const AI_END = 135;
  const GHOST_APPEAR = 140;      // ghost components appear on board (transparent)
  const PENDING_BAR = 150;       // accept/decline bar slides up
  const CURSOR_TO_ACCEPT = 165;
  const ACCEPT_CLICK = 192;
  const SOLIDIFY_START = 197;    // ghosts become opaque
  const SOLIDIFY_END = 235;
  const SIM_BTN_APPEAR = 248;
  const CURSOR_TO_SIM = 265;
  const SIM_CLICK = 290;
  const GLOW_START = 295;

  const fadeIn = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });
  const fadeOut = interpolate(frame, [330, 345], [1, 0], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });
  const sceneOpacity = fadeIn * fadeOut;

  // ── Chat ──
  const userChars = Math.floor(interpolate(frame, [USER_START, USER_END], [0, USER_MSG.length], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' }));
  const showTyping = frame >= TYPING_START && frame < TYPING_END;
  const aiWords = AI_MSG.split(' ');
  const visibleAiWords = Math.floor(interpolate(frame, [AI_START, AI_END], [0, aiWords.length], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' }));
  const aiText = aiWords.slice(0, visibleAiWords).join(' ');

  // ── Ghost phase: transparent components on board ──
  const ghostVisible = frame >= GHOST_APPEAR;
  // Before accept: 0.42 opacity (matching real product). After accept: transition to 1.0
  const compOpacity = frame < SOLIDIFY_START
    ? (ghostVisible ? 0.42 : 0)
    : interpolate(frame, [SOLIDIFY_START, SOLIDIFY_END], [0.42, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });

  // Wires: same ghost opacity
  const wireOpacity = frame < SOLIDIFY_START
    ? (ghostVisible ? 0.42 : 0)
    : interpolate(frame, [SOLIDIFY_START, SOLIDIFY_END], [0.42, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });

  // ── Pending bar ──
  const pendingBarY = spring({ frame: frame - PENDING_BAR, fps, config: { damping: 14, stiffness: 80 } });
  const showPendingBar = frame >= PENDING_BAR && frame < ACCEPT_CLICK + 20;
  const accepted = frame >= ACCEPT_CLICK;

  // ── System message after accept ──
  const systemMsgOpacity = interpolate(frame, [ACCEPT_CLICK + 5, ACCEPT_CLICK + 15], [0, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });

  // ── Simulate button ──
  const simBtnSpring = spring({ frame: frame - SIM_BTN_APPEAR, fps, config: { damping: 10, stiffness: 90, mass: 0.7 } });
  const simClicked = frame >= SIM_CLICK;

  // ── Glow ──
  const glowIntensity = interpolate(frame, [GLOW_START, GLOW_START + 30], [0, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });

  // ── Cursor positions ──
  // Accept button: inside chat panel pending bar. Chat starts at x=BOARD_W_PX.
  // Accept btn is roughly at x = BOARD_W_PX + 60, y = 1080 - 70
  const ACCEPT_BTN_X = BOARD_W_PX + 100;
  const ACCEPT_BTN_Y = 985;
  const SIM_BTN_X = BOARD_W_PX / 2; // center of board area
  const SIM_BTN_Y = 48;

  let cursorX = BOARD_W_PX + 250, cursorY = 500;
  let cursorOpacity = 0;
  let cursorClicking = false;

  if (frame >= CURSOR_TO_ACCEPT && frame < ACCEPT_CLICK + 10) {
    cursorX = interpolate(frame, [CURSOR_TO_ACCEPT, ACCEPT_CLICK - 5], [BOARD_W_PX + 250, ACCEPT_BTN_X], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });
    cursorY = interpolate(frame, [CURSOR_TO_ACCEPT, ACCEPT_CLICK - 5], [500, ACCEPT_BTN_Y], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });
    cursorOpacity = interpolate(frame, [CURSOR_TO_ACCEPT, CURSOR_TO_ACCEPT + 8], [0, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });
    cursorClicking = frame >= ACCEPT_CLICK && frame < ACCEPT_CLICK + 5;
  } else if (frame >= CURSOR_TO_SIM && frame < SIM_CLICK + 12) {
    cursorX = interpolate(frame, [CURSOR_TO_SIM, SIM_CLICK - 5], [ACCEPT_BTN_X, SIM_BTN_X], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });
    cursorY = interpolate(frame, [CURSOR_TO_SIM, SIM_CLICK - 5], [ACCEPT_BTN_Y, SIM_BTN_Y], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });
    cursorOpacity = 1;
    cursorClicking = frame >= SIM_CLICK && frame < SIM_CLICK + 5;
  }

  // ── Camera (slow orbit) ──
  const camAngle = interpolate(frame, [0, 345], [0.25, -0.1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });
  const camDist = 24;
  const camX = Math.sin(camAngle) * camDist;
  const camZ = Math.cos(camAngle) * camDist;

  // ── Component positions ──
  const ledPositions = [
    { colA: 14, colB: 13, row: 'c' },
    { colA: 22, colB: 21, row: 'c' },
    { colA: 30, colB: 29, row: 'c' },
  ];
  const resistorPositions = [
    { colA: 8, colB: 12, row: 'c' },
    { colA: 16, colB: 20, row: 'c' },
    { colA: 24, colB: 28, row: 'c' },
  ];

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bgCanvas, opacity: sceneOpacity }}>
      {/* ─── LEFT: 3D Board — fills exactly up to chat panel ─── */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: BOARD_W_PX, height: 1080 }}>
        <ThreeCanvas
          width={BOARD_W_PX}
          height={1080}
          camera={{
            fov: 38,
            position: new THREE.Vector3(camX, 16, camZ),
            near: 0.1,
            far: 300,
          }}
          style={{ width: '100%', height: '100%' }}
        >
          <ambientLight intensity={0.75} />
          <directionalLight position={[18, 35, 22]} intensity={1.1} color={0xfffaf0} castShadow />
          <directionalLight position={[-12, 8, -8]} intensity={0.35} color={0xd0e8ff} />

          <Board3D />

          {/* Battery — placed beside board, visible from camera */}
          {ghostVisible && (
            <Battery3D worldX={-5} worldZ={-5.5} opacity={compOpacity} />
          )}

          {/* Resistors */}
          {ghostVisible && resistorPositions.map((r, i) => (
            <Resistor3D key={`r${i}`} colA={r.colA} rowA={r.row} colB={r.colB} rowB={r.row} opacity={compOpacity} />
          ))}

          {/* LEDs */}
          {ghostVisible && ledPositions.map((l, i) => (
            <LED3D
              key={`l${i}`}
              colA={l.colA} rowA={l.row} colB={l.colB} rowB={l.row}
              color={0xff2222}
              glowing={glowIntensity > 0.3}
              glowIntensity={glowIntensity}
              opacity={compOpacity}
            />
          ))}

          {/* Wires — all ghost-transparent, solidify on accept */}
          {ghostVisible && (
            <>
              {/* Battery positive terminal → tp rail (red) */}
              <Wire3D fromWorld={[-5.32, 2.97, -5.5]} toCol={0} toRow="tp" color={0xef4444} opacity={wireOpacity} />
              {/* Battery negative terminal → tn rail (black) */}
              <Wire3D fromWorld={[-4.68, 2.70, -5.5]} toCol={0} toRow="tn" color={0x333333} opacity={wireOpacity} />
              {/* Board wires */}
              <Wire3D fromCol={0} fromRow="tp" toCol={5} toRow="tp" color={0xef4444} opacity={wireOpacity} />
              <Wire3D fromCol={5} fromRow="tp" toCol={5} toRow="a" color={0xef4444} opacity={wireOpacity} />
              <Wire3D fromCol={5} fromRow="a" toCol={8} toRow="a" color={0xef4444} opacity={wireOpacity} />
              <Wire3D fromCol={8} fromRow="a" toCol={16} toRow="a" color={0xef4444} opacity={wireOpacity} />
              <Wire3D fromCol={16} fromRow="a" toCol={24} toRow="a" color={0xef4444} opacity={wireOpacity} />
              <Wire3D fromCol={15} fromRow="c" toCol={15} toRow="tn" color={0x333333} opacity={wireOpacity} />
              <Wire3D fromCol={23} fromRow="c" toCol={23} toRow="tn" color={0x333333} opacity={wireOpacity} />
              <Wire3D fromCol={31} fromRow="c" toCol={31} toRow="tn" color={0x333333} opacity={wireOpacity} />
              <Wire3D fromCol={0} fromRow="tn" toCol={15} toRow="tn" color={0x333333} opacity={wireOpacity} />
            </>
          )}
        </ThreeCanvas>
      </div>

      {/* ─── RIGHT: Chat Panel — flush against 3D canvas ─── */}
      <div
        style={{
          position: 'absolute', left: BOARD_W_PX, top: 0, bottom: 0,
          width: CHAT_W, background: '#ffffff',
          borderLeft: `2px solid ${COLORS.chatAiBorder}`,
          display: 'flex', flexDirection: 'column',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.1)',
          opacity: interpolate(frame, [5, 18], [0, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' }),
        }}
      >
        {/* Header */}
        <div style={{
          padding: '22px 22px 16px',
          borderBottom: `2px solid ${COLORS.chatAiBorder}`,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <svg width={32} height={32} viewBox="0 0 24 24">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill={COLORS.accent} />
          </svg>
          <div>
            <div style={{ fontSize: 21, fontWeight: 700, fontFamily: FONTS.primary, color: COLORS.textPrimary }}>
              Sparky AI
            </div>
            <div style={{ fontSize: 13, fontFamily: FONTS.primary, color: COLORS.textMuted }}>
              Circuit design assistant
            </div>
          </div>
        </div>

        {/* Messages */}
        <div style={{
          flex: 1, padding: '18px 16px',
          display: 'flex', flexDirection: 'column', gap: 14,
          overflow: 'hidden',
        }}>
          {frame >= USER_START && (
            <ChatMessage role="user" text={USER_MSG} visibleChars={userChars} />
          )}
          {showTyping && <ChatMessage role="typing" text="" />}
          {frame >= AI_START && (
            <ChatMessage role="ai" text={aiText} />
          )}
          {/* System message after accept */}
          {frame >= ACCEPT_CLICK + 5 && (
            <div style={{
              alignSelf: 'center',
              fontSize: 14, fontFamily: FONTS.primary,
              color: '#16a34a', fontWeight: 600,
              opacity: systemMsgOpacity,
            }}>
              ✓ Applied 7 changes to your circuit.
            </div>
          )}
        </div>

        {/* ─── Pending Bar (Accept / Decline) — matches real product ─── */}
        {showPendingBar && (
          <div style={{
            padding: '14px 16px',
            background: '#fffbeb',
            borderTop: '2px solid #fcd34d',
            display: 'flex', gap: 10,
            transform: `translateY(${(1 - pendingBarY) * 60}px)`,
            opacity: pendingBarY,
          }}>
            <div style={{
              flex: 1, textAlign: 'center',
              padding: '11px 0', borderRadius: 8,
              background: accepted ? '#15803d' : '#16a34a',
              color: 'white', fontSize: 16, fontWeight: 700,
              fontFamily: FONTS.primary,
              transform: accepted ? 'scale(0.96)' : 'scale(1)',
              boxShadow: accepted ? '0 0 16px rgba(22,163,74,0.35)' : 'none',
            }}>
              {accepted ? '✓ Accepted' : 'Accept'}
            </div>
            <div style={{
              flex: 1, textAlign: 'center',
              padding: '11px 0', borderRadius: 8,
              background: 'transparent',
              border: `1.5px solid ${COLORS.chatAiBorder}`,
              color: COLORS.textMuted, fontSize: 16, fontWeight: 600,
              fontFamily: FONTS.primary,
              opacity: accepted ? 0.3 : 1,
            }}>
              Decline
            </div>
          </div>
        )}

        {/* IBM badge */}
        <div style={{
          padding: '12px 22px',
          borderTop: `1px solid ${COLORS.chatAiBorder}`,
          textAlign: 'center',
          fontSize: 12, fontFamily: FONTS.primary, color: COLORS.textDim,
        }}>
          Powered by <span style={{ color: COLORS.ibmBlue, fontWeight: 700 }}>IBM watsonx</span>
        </div>
      </div>

      {/* ─── Simulate Button (after accept) ─── */}
      {frame >= SIM_BTN_APPEAR && (
        <div style={{
          position: 'absolute', top: 28,
          left: BOARD_W_PX / 2,
          transform: `translateX(-50%) scale(${simBtnSpring * (simClicked ? 0.92 : 1)})`,
          opacity: simBtnSpring,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: simClicked ? '#16a34a' : COLORS.accent,
            color: 'white', padding: '12px 28px', borderRadius: 12,
            fontSize: 19, fontFamily: FONTS.primary, fontWeight: 700,
            boxShadow: simClicked
              ? '0 0 24px rgba(22,163,74,0.4), 0 4px 16px rgba(0,0,0,0.15)'
              : '0 4px 20px rgba(37,99,235,0.3)',
          }}>
            <span style={{ fontSize: 20 }}>{simClicked ? '\u25A0' : '\u25B6'}</span>
            {simClicked ? 'Simulating...' : 'Run Simulation'}
          </div>
        </div>
      )}

      {/* ─── Cursor ─── */}
      <Cursor x={cursorX} y={cursorY} opacity={cursorOpacity} clicking={cursorClicking} />

      {/* ─── Click Ripples ─── */}
      <ClickRipple x={ACCEPT_BTN_X + 15} y={ACCEPT_BTN_Y + 15} frame={frame} trigger={ACCEPT_CLICK} color="#22c55e" />
      <ClickRipple x={SIM_BTN_X + 15} y={SIM_BTN_Y + 15} frame={frame} trigger={SIM_CLICK} color={COLORS.accent} />

      {/* ─── Ambient glow during simulation ─── */}
      {glowIntensity > 0.1 && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `radial-gradient(ellipse at 30% 50%, rgba(255,34,34,${0.08 * glowIntensity}) 0%, transparent 60%)`,
        }} />
      )}
    </AbsoluteFill>
  );
};
