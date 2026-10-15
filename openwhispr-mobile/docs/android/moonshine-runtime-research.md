# Moonshine Android integration evidence — 2026-10-15

Research and a temporary native build were performed for the premium Android feature. Model inference is not yet verified. Keep Parakeet and the existing Qwen cleanup baseline.

## Pinned artifacts

- Upstream source: `234f60faa0eb388b01cdf7e60aca232af37aefda` (v0.1.5), [source archive](https://codeload.github.com/moonshine-ai/moonshine/tar.gz/234f60faa0eb388b01cdf7e60aca232af37aefda), 176,944,864 bytes, SHA-256 `6bd927a48234dced3cc6f208522fe176c248686e9283273c51eddc8d7994e001`.
- Maven [moonshine-voice 0.1.5 AAR](https://repo.maven.apache.org/maven2/ai/moonshine/moonshine-voice/0.1.5/moonshine-voice-0.1.5.aar), SHA-256 `ee2d95c21150683c743db8f3aef66281fd5408bcefc94be3ca1d2545ada1f571`.
- Publisher's [Hugging Face archive documentation](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/docs/models/huggingface.md) identifies `moonshine-ai/moonshine-voice-assets`. Release snapshot `0bf2f2e5aff22e6fbba4300b00a4e00bbc4f8aae` is immutable. Exact model path: `model/{tiny,small}-streaming-en/quantized_26_08_21/{filename}`.
- Required eight files: `adapter.ort`, `cross_kv.ort`, `decoder_kv.ort`, `encoder.ort`, `frontend.model.ort`, `frontend.weights.ort`, `streaming_config.json`, `tokenizer.bin`. English Tiny totals 45,233,659 bytes; English Small 142,300,974. Optional word-timestamp decoder is excluded; do not imply word-level timestamps.
- Source/config GET returned 200; tokenizer.bin full download (249,974 bytes) SHA-256 matched upstream LFS metadata; Tiny decoder range request returned 206. Full checkpoint download/inference remains unverified. Exact per-file URLs/sizes/SHA-256 are retained in the research locator below; production delivery must choose a maintained endpoint deliberately, since upstream describes HF as an archive/verification source.

## Native compatibility and verified build recipe

The published AAR bundles ORT 1.23.2; its Moonshine native imports require `OrtGetApiBase@VERS_1.23.2`. Sherpa in this app uses ORT 1.28.2, exporting `VERS_1.28.2`. `pickFirst` cannot make these published binaries compatible.

A temporary build from pinned source succeeded using the existing NDK 27.1.12297006, CMake 3.22.1, Android API 26, `c++_shared`, and flexible 16 KB page sizes:

1. Retain `core/**`, `language-bindings/android/moonshine-jni/**` and licenses. Exclude upstream ORT binaries from extraction.
2. Copy the app's verified ORT 1.28.2 binary into `core/third-party/onnxruntime/lib/android/<abi>/libonnxruntime.so`; upstream maps `arm64-v8a` to `arm64`. Other ABI names are unchanged. Upstream's CMake overwrites `ONNXRUNTIME_LIB_PATH` internally, so a command-line override alone is insufficient.
3. Configure `cmake -S <source>/core -B <build> -G Ninja` with the Android toolchain and `-DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-26 -DANDROID_STL=c++_shared -DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON -DCMAKE_BUILD_TYPE=Release`.
4. Build only `moonshine-jni`. Package `libmoonshine.so` and `moonshine-jni/libmoonshine-jni.so`, alongside the single existing ORT. ELF inspection confirmed the rebuilt libraries require `VERS_1.28.2` and have `0x4000` LOAD alignment. Other ABIs and model inference still need validation.
5. Extract only `classes.jar` from the pinned AAR, not its JNI libraries. Its POM dependencies are appcompat 1.6.1, material 1.10.0, okhttp 4.12.0 and work-runtime 2.9.1. Add release keep rules for `ai.moonshine.voice` JNI/reflected classes and fields. The AAR has no consumer ProGuard file.

`MOONSHINE_TTS_BUILD_ONNX=OFF` is broken in this source: `moonshine-c-api.cpp` unconditionally uses TTS/G2P while the corresponding macro is never consumed. The verified build leaves the default ON. This adds native TTS code but no espeak. A speech-only fork requires a deliberate upstream patch; do not claim the flag alone works.

## Adapter contract

Verified Java signatures: `Transcriber.loadFromFiles(directory, JNI.MOONSHINE_MODEL_ARCH_TINY_STREAMING)` (Tiny=2, Small=4); `transcribeWithoutStreaming(floatSamples, sampleRate)` returns a `Transcript` with `text()`; `close()` releases resources. Streaming supports `addListener`, `start`, `addAudio`, `stop` (final update), `close`.

Use app-owned capture and serialized inference. Do not use `MicTranscriber`, which introduces competing microphone ownership and automatic downloads. Never free native state while inference is running. Download integrity, selected-language support and full speech-plus-Qwen measurements are still implementation/acceptance work. Exact checkpoint licenses must be carried into Licenses when integrated.

## Local research locator

`/var/folders/ck/k7s7x5zs14jdcd7v97g479w00000gn/T/ow-moonshine-research-mcnift9t/` contains `models.json`, the pinned AAR, source archive and extracted source. Temporary verification build output was removed by its owning researcher. The source/checkpoint hashes above permit reconstruction if the temporary directory expires.
