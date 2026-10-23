const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { transcribeManagedAudioFile } = require("../../src/helpers/managedAudioFileTranscription");
const { silenceWav } = require("../../src/helpers/enterpriseAudioSetup");
const { getSafeTempDir } = require("../../src/helpers/safeTempDir");

function audio() {
  const buffer = Buffer.alloc(44 + 24000 * 2 * 3);
  silenceWav().copy(buffer, 0, 0, 44);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.writeUInt32LE(buffer.length - 44, 40);
  return buffer;
}
const temporaryFiles = () =>
  fs
    .readdirSync(getSafeTempDir())
    .filter((name) => /^enterprise-(buffer|chunks)-/.test(name))
    .sort();

test("oversized managed buffers use real ffmpeg chunks in order and clean temporary audio", async () => {
  const before = temporaryFiles();
  const sizes = [];
  const result = await transcribeManagedAudioFile({
    audioBuffer: audio(),
    fileName: "history.wav",
    maxUploadBytes: 20000,
    transcribe: async (buffer, name, type) => {
      assert.match(name, /\.mp3$/);
      assert.equal(type, "audio/mpeg");
      sizes.push(buffer.length);
      return `part-${sizes.length}`;
    },
  });
  assert.ok(sizes.length >= 3);
  assert.ok(sizes.every((size) => size <= 20000));
  assert.equal(result.text, sizes.map((_, index) => `part-${index + 1}`).join(" "));
  assert.deepEqual(temporaryFiles(), before);
});

test("canceling a managed history buffer stops queued chunks and releases temporary files", async () => {
  const before = temporaryFiles();
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    transcribeManagedAudioFile({
      audioBuffer: audio(),
      fileName: "dictation.wav",
      maxUploadBytes: 20000,
      signal: controller.signal,
      transcribe: async () => {
        calls++;
        controller.abort();
        return "retained";
      },
    }),
    { name: "AbortError" }
  );
  assert.equal(calls, 1);
  assert.deepEqual(temporaryFiles(), before);
});

test("managed chunk failures retain usable text and report the missing chunk", async () => {
  const before = temporaryFiles();
  let index = 0;
  const result = await transcribeManagedAudioFile({
    audioBuffer: audio(),
    fileName: "upload.wav",
    maxUploadBytes: 20000,
    onProgress: (progress) => {
      index = progress.chunksCompleted;
    },
    transcribe: async () => {
      if (index === 1)
        throw Object.assign(new Error("local provider unavailable"), { code: "SERVER_ERROR" });
      return `part-${index}`;
    },
  });
  assert.equal(result.failedChunks, 1);
  assert.match(result.text, /part-0/);
  assert.doesNotMatch(result.text, /part-1/);
  assert.deepEqual(temporaryFiles(), before);
});
