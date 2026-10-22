import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import type { AudioRecorder } from 'expo-audio';
import { useAudioRecording } from '@/hooks/useAudioRecording';
import { useUsageLimitRecovery } from '@/hooks/useUsageLimitRecovery';
import { isMicPermissionError, isNoSpeechError, showMicPermissionAlert } from '@/lib/permissions';
import { promptLocalModelFallback } from '@/lib/privateMode';
import { useChatStore, type ChatPending } from '@/store/useChatStore';
import type { UsageLimitError } from '@/lib/usageLimitError';

export interface ChatVoiceInput {
  state: 'idle' | 'listening' | 'transcribing';
  elapsedSeconds: number;
  audioRecorder: AudioRecorder;
  start: (allowCloudFallback: boolean) => Promise<void>;
  finish: () => Promise<void>;
  cancel: () => Promise<void>;
}

interface UseChatVoiceInputOptions {
  conversationId: string | null;
  onSent?: (conversationId: string) => void;
}

interface TranscribingSlot {
  generation: number;
  pending: ChatPending | null;
}

export function useChatVoiceInput({
  conversationId,
  onSent,
}: UseChatVoiceInputOptions): ChatVoiceInput {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const onSentRef = useRef(onSent);
  onSentRef.current = onSent;
  const allowCloudFallbackRef = useRef(false);
  // Bumped by cancel, so a transcript that lands afterwards is ignored.
  const generationRef = useRef(0);
  const slotRef = useRef<TranscribingSlot | null>(null);
  const { handleUsageLimitReached } = useUsageLimitRecovery();

  // The slot is ours only while it is the exact pending entry we created: a cancel, delete,
  // sign-out or another turn replaces or clears it.
  const ownsSlot = (): boolean => {
    const slot = slotRef.current;
    return (
      !!slot &&
      slot.generation === generationRef.current &&
      useChatStore.getState().pending === slot.pending
    );
  };

  const takeSlot = (): boolean => {
    if (!useChatStore.getState().beginTranscribing(conversationIdRef.current)) return false;
    generationRef.current += 1;
    slotRef.current = {
      generation: generationRef.current,
      pending: useChatStore.getState().pending,
    };
    setIsTranscribing(true);
    return true;
  };

  const releaseSlot = (): void => {
    if (ownsSlot()) useChatStore.getState().endTranscribing();
    slotRef.current = null;
    setIsTranscribing(false);
  };

  const sendTranscript = (text: string): void => {
    if (!ownsSlot()) return;
    const targetId = conversationIdRef.current;
    // The screen moved to another conversation while this question was transcribing.
    const movedAway = useChatStore.getState().pending?.conversationId !== targetId;
    releaseSlot();
    if (movedAway) return;
    const result = useChatStore.getState().send(text, {
      conversationId: targetId,
      allowCloudFallback: allowCloudFallbackRef.current,
    });
    if (result) onSentRef.current?.(result.conversationId);
  };

  const recording = useAudioRecording({
    saveToHistory: false,
    onComplete: sendTranscript,
    onError: (error) => {
      releaseSlot();
      if (isMicPermissionError(error)) {
        // iOS already showed its own prompt; only point to Settings when it couldn't.
        if (!error.nativePromptShown) showMicPermissionAlert();
        return;
      }
      if (isNoSpeechError(error)) return;
      Alert.alert('Couldn’t hear that', error.message);
    },
    // The fallback prompt has no cancel callback, so the slot is released before it shows
    // (finish releases it) and taken again only if the user picks the cloud.
    onLocalModelMissing: (retryWithCloud) => {
      promptLocalModelFallback(() => {
        if (takeSlot()) retryWithCloud();
      });
    },
    onUsageLimitReached: async (
      error: UsageLimitError,
      retryWithCloud: () => Promise<void>,
    ): Promise<void> => {
      await handleUsageLimitReached(error, retryWithCloud);
      releaseSlot();
    },
  });

  const state: ChatVoiceInput['state'] = recording.isRecording
    ? 'listening'
    : isTranscribing
      ? 'transcribing'
      : 'idle';

  useEffect(() => {
    if (state !== 'listening') return undefined;
    setElapsedSeconds(0);
    const timer = setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1000);
    return () => clearInterval(timer);
  }, [state]);

  const start = async (allowCloudFallback: boolean): Promise<void> => {
    // A cancelled transcription still delivers its text later, which must not land in a new slot.
    if (useChatStore.getState().pending || recording.isRecording || recording.isProcessing) {
      return;
    }
    allowCloudFallbackRef.current = allowCloudFallback;
    // Failures already reached onError.
    await recording.startRecording().catch(() => undefined);
  };

  const finish = async (): Promise<void> => {
    if (state !== 'listening') return;
    if (!takeSlot()) {
      await recording.cancelRecording();
      return;
    }
    const slot = slotRef.current;
    try {
      await recording.stopRecording();
    } catch {
      // Failures already reached onError.
    } finally {
      // Covers every exit that sent nothing; a slot taken since (a cloud retry) isn't ours to end.
      if (slotRef.current === slot) releaseSlot();
    }
  };

  const cancel = async (): Promise<void> => {
    if (recording.isRecording) {
      await recording.cancelRecording();
      return;
    }
    releaseSlot();
    generationRef.current += 1;
  };

  return {
    state,
    elapsedSeconds,
    audioRecorder: recording.audioRecorder,
    start,
    finish,
    cancel,
  };
}
