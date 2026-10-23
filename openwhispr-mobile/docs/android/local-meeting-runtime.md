# Android local meeting runtime

The Android adapter uses Sherpa-ONNX 1.13.8 with Pyannote segmentation 3.0 int8
and NVIDIA NeMo TitaNet Small on CPU. Model filenames, sizes, sources and SHA-256
digests are in `src/android/meetingModels.ts`; the existing downloader verifies
both files before the adapter runs. Notices are included in Android Licenses.

This is the processing foundation, not a completed meeting feature. Android's
Local Mode meeting setup still does not offer Start. Recording, recovery,
account/mode changes, timestamp-capable ASR selection and model-management UI
must be integrated and tested before enabling it or building a release candidate.
The adapter returns within-meeting speaker labels, not reusable voice identities.

The shared inference queue unloads idle text and speech models before speaker
processing. Native decoding creates a temporary 16 kHz mono WAV. The original
recording is never changed or uploaded. A memory preflight includes audio/JNI
copies, the clustering distance matrix and reserved headroom; it is an estimate,
not a demonstrated maximum meeting duration. The shared decoder currently
requires audio shorter than one hour. Physical-phone memory, heat, latency and
long-session behavior remain unverified.

Cancellation invalidates queued/returned results. The pinned native API does not
interrupt inference immediately: its worker owns and releases the engine after
processing returns. UI cancellation and persistence must respect that distinction.

## Bounded verification

- TypeScript adapter tests exercise platform routing, timed turns, missing models,
  queued cancellation and stale-result rejection.
- JVM tests cover memory refusal, including quadratic clustering allocation.
- `DiarizationRuntimeTest` runs in the separate `com.openwhispr.dictation.test`
  instrumentation app, with no microphone permission or network needed. It checks
  repeated synthetic voices, silence and original-file preservation after failure.
- `SpeechRuntimeTest` checks the rebuilt shared runtime with Parakeet and both
  Moonshine models, including the existing unpadded final-word regression.

For the diarization instrumentation test, place the two verified model files and
fixtures in that debug test app's `files/fixtures/diarization`. `silence.wav` is
five seconds of 16 kHz mono signed-16-bit PCM zeros. `two-voices.wav` is the
retained 31.4945-second synthetic Samantha/Daniel/Samantha/Daniel fixture with
SHA-256 `9e5ad636d568a769daf6b8221806fbcf7043fd5d97f7bc73fc0480eb5f287ae4`.
Its four speech intervals start at 0, 7.1386875, 15.5620625 and 22.689125 seconds.
The test asserts stable A/B/A/B labels at interior points and unchanged original
bytes. This fixture check does not establish accuracy for real meeting audio.
