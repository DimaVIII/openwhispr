import { requireNativeModule, EventEmitter } from 'expo';
import { Platform } from 'react-native';

export interface Recording {
  uri: string;
  durationMs: number;
  noSpeech: boolean;
}
export interface BubbleStatus {
  overlay: boolean;
  accessibility: boolean;
  enabled: boolean;
  batteryExempt: boolean;
  microphone: boolean;
}
interface NativeDictation {
  getLocale(): string;
  getStatus(): BubbleStatus;
  openSettings(kind: 'overlay' | 'accessibility' | 'battery' | 'app'): void;
  setEnabled(enabled: boolean, size: number): void;
  setStatus(status: string): Promise<void>;
  setBubbleOptions(options: Record<string, string>): Promise<void>;
  insert(text: string): Promise<boolean>;
  startRecording(): Promise<void>;
  stopRecording(cancel: boolean): Promise<Recording>;
  decodeAudio(uri: string): Promise<Recording>;
  sha256(uri: string): Promise<string>;
  transcribeParakeet(
    uri: string,
    modelDirectory: string,
  ): Promise<{
    text: string;
    duration: number;
    processingMs: number;
    tokenTimings: { token: string; startTime: number; endTime: number }[];
  }>;
  cancelParakeet(): void;
  releaseParakeet(): Promise<void>;
}
export const AndroidDictation =
  Platform.OS === 'android' ? requireNativeModule<NativeDictation>('AndroidDictation') : null;
export const dictationEvents = AndroidDictation
  ? new EventEmitter<{
      onStart: (event: {
        selection: string;
        mode: 'dictate' | 'translate' | 'write' | 'edit';
      }) => void;
      onRecording: (event: Recording) => void;
      onError: (event: { message: string }) => void;
      onCancel: () => void;
      onOpenResult: () => void;
      onStatusChange: () => void;
    }>(AndroidDictation as never)
  : null;
