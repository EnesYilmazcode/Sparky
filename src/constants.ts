export const COLORS = {
  accent: '#2563eb',
  accentDark: '#1d4ed8',
  accentLight: '#3b82f6',

  bgDark: '#0a0a12',
  bgCanvas: '#dcdad4',
  bgBoard: '#e5e0d2',

  textPrimary: '#111111',
  textMuted: '#888888',
  textDim: '#aaaaaa',
  textLight: '#ffffff',

  railPos: '#dc2626',
  railNeg: '#2563eb',

  wireRed: '#ef4444',
  wireOrange: '#f97316',
  wireYellow: '#fbbf24',
  wireGreen: '#22c55e',
  wireBlue: '#3b82f6',
  wireBlack: '#333333',

  resistorBody: '#d4a96a',
  resistorBands: ['#f87171', '#fb923c', '#fbbf24', '#a3e635'],
  ledRed: '#ff2222',
  ledGreen: '#22c55e',
  ledAmber: '#fbbf24',
  batteryBody: '#111111',
  buzzerBody: '#222222',
  buttonCap: '#e5e5e5',
  leadSilver: '#c0c0c0',

  ibmBlue: '#0f62fe',

  chatUser: '#eff5ff',
  chatUserBorder: 'rgba(0,117,255,0.18)',
  chatUserText: '#1a3a7a',
  chatAi: '#f5f4f1',
  chatAiBorder: '#e0ddd8',
} as const;

export const FONTS = {
  primary: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'Courier New', 'Consolas', monospace",
} as const;

// 20 seconds = 600 frames at 30fps
export const SCENES = {
  hook:     { from: 0,   duration: 84 },    // 0-2.8s  (20% faster)
  aiTutor:  { from: 84,  duration: 345 },   // 2.8-14.3s
  closing:  { from: 429, duration: 171 },   // 14.3-20s
} as const;

// 3D board dimensions (matches circuit3d/js/breadboard.js)
export const BOARD3D = {
  COLS: 50,
  HS: 0.40,
  MARGIN_X: 0.90,
  BOARD_W: 21.4,
  BOARD_D: 7.9,
  BOARD_THICK: 0.38,
  ROW_Z: {
    tp: -3.35, tn: -2.95,
    a: -2.15, b: -1.75, c: -1.35, d: -0.95, e: -0.55,
    f:  0.55, g:  0.95, h:  1.35, i:  1.75, j:  2.15,
    bn: 2.95, bp: 3.35,
  } as Record<string, number>,
} as const;
