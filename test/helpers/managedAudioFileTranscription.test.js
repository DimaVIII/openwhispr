const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
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

test("the IPC job retains its original profile lifetime during preparation and between chunks", async () => {
  const ipcPath = path.join(__dirname, "../../src/helpers/ipcHandlers.js");
  const source = fs.readFileSync(ipcPath, "utf8");
  const start = source.indexOf("const transcribeManagedAudio = async");
  const end = source.indexOf("\n    ipcMain.handle(", start);
  assert.ok(start >= 0 && end > start);
  for (const rotationPoint of ["splitting", "between-chunks"]) {
    const before = temporaryFiles();
    let retirement = new AbortController();
    let submitted = 0;
    const rotate = () => {
      retirement.abort();
      retirement = new AbortController();
    };
    const run = vm.runInNewContext(`${source.slice(start, end)}\ntranscribeManagedAudio;`, {
      require: createRequire(ipcPath),
      AbortSignal,
      resolveEnterpriseRuntime: async () => ({
        enterprise: {
          audioProfile: { signal: retirement.signal, section: { maxUploadBytes: 20000 } },
        },
      }),
      executeManagedTranscription: async () => {
        submitted++;
        rotate();
        return "first chunk";
      },
    });
    await assert.rejects(
      run(
        {},
        { provider: "openai-compatible", context: {} },
        {
          audioBuffer: audio(),
          fileName: "history.wav",
          onProgress: ({ stage }) => {
            if (rotationPoint === "splitting" && stage === "splitting") rotate();
          },
        }
      ),
      { name: "AbortError" }
    );
    assert.equal(submitted, rotationPoint === "splitting" ? 0 : 1);
    assert.deepEqual(temporaryFiles(), before);
  }
});
