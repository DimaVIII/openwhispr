const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAudioManager } = require("./harness/audioManager");

// The dictionary prompt is built by the real getCustomDictionaryPrompt /
// getWhisperPrompt from settings: personal words and snippet triggers, then the
// active workspace's space and workspace words (sharedDictionaryHints).

const OPENAI_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";

function dictionarySettings({ personal = [], space = [], workspace = [], ...rest } = {}) {
  return {
    useLocalWhisper: false,
    allowLocalFallback: false,
    cloudTranscriptionProvider: "openai",
    customDictionary: personal,
    snippets: [],
    sharedDictionaryHints: { space, workspace },
    ...rest,
  };
}

function captureRequests(t) {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_endpoint, init) => {
    requests.push({
      prompt: init.body.get("prompt"),
      keywords: init.body.getAll("keywords[]"),
    });
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ text: "transcribed text" }),
    };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  return requests;
}

const teamWords = (prefix, count) =>
  Array.from({ length: count }, (_, i) => `${prefix}${String(i).padStart(4, "0")}`);

async function setUp(t, cachePrefix) {
  const loaded = await loadAudioManager(t, {
    cachePrefix,
    settingsKey: `__${cachePrefix.replace(/[^a-z]/gi, "")}Settings`,
  });
  const openAIManager = ({ model = "whisper-1", endpoint = OPENAI_ENDPOINT, language = "auto" }) =>
    loaded.createManager({
      getEffectiveSttLanguage: () => language,
      getTranscriptionModel: () => model,
      getTranscriptionEndpoint: () => endpoint,
      getAPIKey: async () => "test-key",
      getKeyterms: () => [],
      shouldStreamTranscription: () => false,
      processTranscription: async (text) => text,
      isReasoningAvailable: async () => false,
    });
  return { ...loaded, openAIManager };
}

const audioBlob = () => new Blob([new ArrayBuffer(8)], { type: "audio/webm" });

test("whisper prompt includes shared words after personal", async (t) => {
  const { setSettings, createManager } = await setUp(t, "openwhispr-dictionary-prompt-tiers-");
  setSettings(dictionarySettings({ personal: ["Piha"], workspace: ["ARR"] }));

  assert.equal(createManager().getCustomDictionaryPrompt(), "ARR, Piha");
});

test("a word in Personal and a shared list is sent once, in the personal spelling", async (t) => {
  const { setSettings, createManager } = await setUp(t, "openwhispr-dictionary-prompt-dedupe-");
  setSettings(
    dictionarySettings({
      personal: ["OpenWhispr"],
      space: ["Openwhispr", "Qdrant"],
      workspace: ["OPENWHISPR", "ARR"],
    })
  );

  assert.equal(createManager().getCustomDictionaryPrompt(), "ARR, Qdrant, OpenWhispr");
});

test("the OpenAI transcription request carries the formatted prompt", async (t) => {
  const { setSettings, openAIManager } = await setUp(t, "openwhispr-dictionary-prompt-openai-");

  await t.test("whisper-1 ends the prompt with the personal words", async (st) => {
    setSettings(
      dictionarySettings({ personal: ["Piha", "Biscuit"], space: ["S1"], workspace: ["W1"] })
    );
    const requests = captureRequests(st);

    const result = await openAIManager({}).processWithOpenAIAPI(audioBlob(), {});

    assert.equal(result.success, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].prompt, "W1, S1, Piha, Biscuit");
    assert.ok(requests[0].prompt.endsWith("Piha, Biscuit"));
  });

  await t.test("a long team list on Groq drops shared words, never personal ones", async (st) => {
    setSettings(
      dictionarySettings({
        cloudTranscriptionProvider: "groq",
        personal: ["Piha", "Biscuit"],
        snippets: [{ trigger: "my sig", replacement: "Chad" }],
        workspace: teamWords("Team", 300),
      })
    );
    const requests = captureRequests(st);

    await openAIManager({
      model: "whisper-large-v3-turbo",
      endpoint: GROQ_ENDPOINT,
    }).processWithOpenAIAPI(audioBlob(), {});

    const prompt = requests[0].prompt;
    assert.ok(prompt.length <= 890, `groq prompt must stay capped, got ${prompt.length}`);
    assert.ok(prompt.endsWith("Piha, Biscuit, my sig"), "personal words and triggers are the tail");
    assert.ok(prompt.startsWith("Team0000"), "shared words are cut from the end of their tier");
  });

  await t.test("a Chinese script bias counts against the provider limit", async (st) => {
    setSettings(
      dictionarySettings({
        cloudTranscriptionProvider: "groq",
        personal: ["Piha"],
        workspace: teamWords("Team", 300),
      })
    );
    const requests = captureRequests(st);

    await openAIManager({
      model: "whisper-large-v3-turbo",
      endpoint: GROQ_ENDPOINT,
      language: "zh-CN",
    }).processWithOpenAIAPI(audioBlob(), {});

    const prompt = requests[0].prompt;
    assert.match(prompt, /^以下是简体中文。\S* Team0000,/, "the bias leads, then shared words");
    assert.ok(prompt.length <= 890, `bias plus dictionary must fit, got ${prompt.length}`);
    assert.ok(prompt.endsWith(", Piha"));
  });

  await t.test("gpt-transcribe sends personal words as its first keywords", async (st) => {
    setSettings(
      dictionarySettings({ personal: ["Piha"], space: ["S1"], workspace: teamWords("Team", 950) })
    );
    const requests = captureRequests(st);

    await openAIManager({ model: "gpt-transcribe" }).processWithOpenAIAPI(audioBlob(), {});

    const { keywords, prompt } = requests[0];
    assert.equal(keywords.length, 900);
    assert.deepEqual(keywords.slice(0, 3), ["Piha", "S1", "Team0000"]);
    assert.equal(prompt, teamWords("Team", 950).slice(898).join(", "));
  });
});

test("paths with no provider limit still send a long personal list whole", async (t) => {
  const { window, setSettings, createManager } = await setUp(
    t,
    "openwhispr-dictionary-prompt-uncapped-"
  );
  const personal = teamWords("SpecializedTerm", 100);
  const personalPrompt = personal.join(", ");
  assert.ok(personalPrompt.length > 1600, "fixture must exceed the Whisper budget");

  await t.test("personal-only is today's string", () => {
    setSettings(dictionarySettings({ personal }));
    assert.equal(createManager().getCustomDictionaryPrompt(), personalPrompt);
  });

  await t.test("shared words only fill what the personal list leaves", () => {
    setSettings(dictionarySettings({ personal, workspace: ["ARR"] }));
    assert.equal(createManager().getCustomDictionaryPrompt(), personalPrompt);

    setSettings(dictionarySettings({ personal: ["Piha"], workspace: teamWords("Team", 300) }));
    const prompt = createManager().getCustomDictionaryPrompt();
    assert.ok(prompt.length <= 900, `shared words stay inside the Whisper budget`);
    assert.ok(prompt.endsWith(", Piha"));
  });

  await t.test("local whisper is sent the same string the echo check reads", async () => {
    setSettings(
      dictionarySettings({
        useLocalWhisper: true,
        localTranscriptionProvider: "whisper",
        personal: ["Piha"],
        workspace: teamWords("Team", 300),
      })
    );
    const seen = [];
    window.electronAPI.transcribeLocalWhisper = async (_buf, options) => {
      seen.push(options.initialPrompt);
      return { success: true, text: "transcribed text" };
    };
    const manager = createManager({ getEffectiveSttLanguage: () => "auto" });

    const result = await manager.processWithLocalWhisper(audioBlob(), "base", {});

    assert.equal(result.success, true);
    assert.equal(seen[0], manager.getCustomDictionaryPrompt());
    assert.ok(seen[0].endsWith(", Piha"));
  });
});
