const fs = require("node:fs");
const path = require("node:path");
const { getSafeTempDir } = require("./safeTempDir");
const { splitAudioFile } = require("./ffmpegUtils");
const { providerContentType } = require("./providerUploadAudio");

async function transcribeManagedAudioFile({
  filePath,
  audioBuffer,
  fileName = "audio.webm",
  contentType = "audio/webm",
  maxUploadBytes,
  transcribe,
  signal,
  onProgress,
}) {
  signal?.throwIfAborted();
  if (audioBuffer) {
    if (audioBuffer.length <= maxUploadBytes)
      return { text: await transcribe(audioBuffer, fileName, contentType) };
    const temporary = fs.mkdtempSync(path.join(getSafeTempDir(), "enterprise-buffer-"));
    try {
      const source = path.join(temporary, path.basename(fileName));
      fs.writeFileSync(source, audioBuffer, { mode: 0o600 });
      return await transcribeManagedAudioFile({
        filePath: source,
        maxUploadBytes,
        transcribe,
        signal,
        onProgress,
      });
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
  if (fs.statSync(filePath).size <= maxUploadBytes)
    return {
      text: await transcribe(
        fs.readFileSync(filePath),
        path.basename(filePath),
        providerContentType(filePath)
      ),
    };
  const directory = fs.mkdtempSync(path.join(getSafeTempDir(), "enterprise-chunks-"));
  const texts = [];
  const failed = [];
  try {
    onProgress?.({ stage: "splitting", chunksTotal: 0, chunksCompleted: 0 });
    // At 128 kbit/s, leave room for MP3/container overhead and encoder padding.
    const segmentDuration = Math.max(
      1,
      Math.min(600, Math.floor((maxUploadBytes - 65536) / 16000))
    );
    const { chunkPaths } = await splitAudioFile(filePath, directory, { segmentDuration, signal });
    for (const [index, chunkPath] of chunkPaths.entries()) {
      signal?.throwIfAborted();
      onProgress?.({
        stage: "transcribing",
        chunksTotal: chunkPaths.length,
        chunksCompleted: index,
      });
      if (fs.statSync(chunkPath).size > maxUploadBytes)
        throw new Error("Prepared audio chunk exceeds the enterprise provider limit");
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          texts[index] = await transcribe(
            fs.readFileSync(chunkPath),
            path.basename(chunkPath),
            "audio/mpeg"
          );
          break;
        } catch (error) {
          signal?.throwIfAborted();
          if (error.code === "NO_SPEECH_DETECTED") {
            texts[index] = "";
            break;
          }
          if (!["PROVIDER_RATE_LIMITED", "SERVER_ERROR"].includes(error.code)) throw error;
          if (attempt === 2) {
            failed.push(index);
            break;
          }
          await require("node:timers/promises").setTimeout(500 * 2 ** attempt, undefined, {
            signal,
          });
        }
      }
    }
    onProgress?.({
      stage: "transcribing",
      chunksTotal: chunkPaths.length,
      chunksCompleted: chunkPaths.length,
    });
    const text = texts.filter(Boolean).join(" ");
    if (!text)
      throw Object.assign(new Error("No usable enterprise transcript was returned"), {
        code: failed.length ? "SERVER_ERROR" : "NO_SPEECH_DETECTED",
      });
    return { text, failedChunks: failed.length, totalChunks: chunkPaths.length };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

module.exports = { transcribeManagedAudioFile };
