import {memo,useSyncExternalStore} from 'react';
import Cat from './CatV2';
import type {PlaybackState} from './avatar/useSpeech';
import type {PerformanceInput} from './avatar/performance.mjs';
import type {PetBehaviorState,PetInteraction} from './pet/behavior';

type Progress={snapshot():PlaybackState;subscribe(listener:()=>void):()=>void};
type Props={progress:Progress;idleInput:PerformanceInput;sleeping:boolean;onState(state:PetBehaviorState):void;onInteract(action:PetInteraction):void};

/** Playback boundaries update the portrait without rendering the workspace. */
export default memo(function SpeechCompanion({progress,idleInput,sleeping,onState,onInteract}:Props) {
  const speech=useSyncExternalStore(progress.subscribe,progress.snapshot,progress.snapshot);
  const input:PerformanceInput=!sleeping&&(speech.active||speech.pending)
    ? {utteranceId:speech.utteranceId,text:speech.text,phase:'speaking',speech:{active:speech.active,charIndex:speech.charIndex,ended:speech.ended,audioLevel:speech.audioLevel,emotion:speech.emotion}}
    : idleInput;
  return <Cat performanceInput={input} onState={onState} onInteract={onInteract}/>;
});
