import React from 'react';
import { COLORS, FONTS } from '../constants';

export const ChatMessage: React.FC<{
  role: 'user' | 'ai' | 'typing';
  text: string;
  visibleChars?: number;
}> = ({ role, text, visibleChars }) => {
  if (role === 'typing') {
    return (
      <div
        style={{
          alignSelf: 'flex-start',
          background: COLORS.chatAi,
          border: `1px solid ${COLORS.chatAiBorder}`,
          borderRadius: '14px 14px 14px 4px',
          padding: '14px 20px',
          display: 'flex',
          gap: 7,
        }}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              backgroundColor: COLORS.accent,
              opacity: 0.6,
            }}
          />
        ))}
      </div>
    );
  }

  const displayText = visibleChars !== undefined ? text.slice(0, visibleChars) : text;
  const isUser = role === 'user';

  return (
    <div
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: '90%',
        background: isUser ? COLORS.chatUser : COLORS.chatAi,
        border: `2px solid ${isUser ? COLORS.chatUserBorder : COLORS.chatAiBorder}`,
        borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        padding: '14px 20px',
        color: isUser ? COLORS.chatUserText : COLORS.textPrimary,
        fontSize: 20,
        fontFamily: FONTS.primary,
        fontWeight: 500,
        lineHeight: 1.6,
      }}
    >
      {displayText}
      {visibleChars !== undefined && visibleChars < text.length && (
        <span style={{ opacity: 0.5 }}>|</span>
      )}
    </div>
  );
};
