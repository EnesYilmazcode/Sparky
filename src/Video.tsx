import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { SCENES } from './constants';
import { Hook } from './scenes/Hook';
import { AITutor3D } from './scenes/AITutor3D';
import { Closing } from './scenes/Closing';

export const Video: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0a12' }}>
      <Sequence from={SCENES.hook.from} durationInFrames={SCENES.hook.duration} name="Hook">
        <Hook />
      </Sequence> 
      <Sequence from={SCENES.aiTutor.from} durationInFrames={SCENES.aiTutor.duration} name="AI Tutor">
        <AITutor3D />
      </Sequence>
      <Sequence from={SCENES.closing.from} durationInFrames={SCENES.closing.duration} name="Closing">
        <Closing />
      </Sequence>
    </AbsoluteFill>
  );
};
