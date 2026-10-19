const test = require("node:test");
const assert = require("node:assert/strict");

const ctx = {
  getApiKey: async () => "test-key",
  getSystemPrompt: () => "Clean the transcript",
  getCustomDictionary: () => [],
  getPreferredLanguage: () => "en",
  getUiLanguage: () => "en",
  calculateMaxTokens: () => 4096,
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const reply = {
  output: [{ type: "message", content: [{ type: "output_text", text: "Cleaned" }] }],
};

function pendingBody(signal) {
  let stream;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        stream = controller;
      },
    })
  );
  signal.addEventListener("abort", () => stream.error(new DOMException("Aborted", "AbortError")));
  return response;
}

async function setup(t, name, fetchResponse, config = {}) {
  const { openaiProvider } = await import("../../src/services/ai/inferenceProviders/openai.ts");
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const requested = [];
  globalThis.fetch = async (url, init = {}) => {
    requested.push(String(url));
    return fetchResponse(String(url), init);
  };
  const request = openaiProvider.call({
    text: "raw transcript",
    model: "cleanup-model",
    agentName: null,
    config: {
      provider: "custom",
      customApiKey: "test-key",
      baseUrl: `https://${name}.example/v1`,
      ...config,
    },
    ctx,
  });
  return { request, requested };
}

for (const [scope, deadline] of [
  [undefined, 30_000],
  ["noteFormatting", 600_000],
]) {
  test(`successful response body retains the ${deadline / 1000}s deadline`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let signal;
    const { request, requested } = await setup(
      t,
      `body-${deadline}`,
      (url, init) => {
        if (url.endsWith("/models")) return json({}, 404);
        signal = init.signal;
        return pendingBody(signal);
      },
      { inferenceScope: scope }
    );
    let error;
    const outcome = request.catch((cause) => {
      error = cause;
    });
    await settle();
    assert.equal(requested.length, 2);
    t.mock.timers.tick(deadline - 1);
    await settle();
    assert.equal(signal.aborted, false);
    t.mock.timers.tick(1);
    await settle();
    assert.equal(signal.aborted, true, "body consumption must remain covered by the deadline");
    await outcome;
    assert.equal(error?.code, "PROVIDER_TIMEOUT");
    assert.match(
      error?.cause?.message ?? "",
      new RegExp(`Request timed out after ${deadline / 1000}s`)
    );
    assert.equal(requested.length, 2, "an expired body must not trigger fallback or retry");
  });
}

test("model discovery body times out and permits the inference request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  const { request, requested } = await setup(t, "probe-body", (url, init) => {
    if (url.endsWith("/models")) {
      signal = init.signal;
      return pendingBody(signal);
    }
    return json(reply);
  });
  await settle();
  assert.equal(requested.length, 1);
  t.mock.timers.tick(2_000);
  await settle();
  assert.equal(signal.aborted, true, "discovery deadline must cover its body");
  assert.equal(await request, "Cleaned");
  assert.equal(requested.length, 2);
});

test("a complete response body resolves and disposes the deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  const { request } = await setup(t, "complete-body", (url, init) => {
    if (url.endsWith("/models")) return json({}, 404);
    signal = init.signal;
    return json(reply);
  });
  assert.equal(await request, "Cleaned");
  t.mock.timers.tick(30_000);
  assert.equal(signal.aborted, false);
});

for (const kind of ["malformed", "dropped"]) {
  test(`${kind} successful body does not newly fall back to chat`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { request, requested } = await setup(t, `${kind}-body`, (url) => {
      if (url.endsWith("/models")) return json({}, 404);
      if (kind === "malformed") return new Response("{");
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("body dropped"));
          },
        })
      );
    });
    const rejected = assert.rejects(request);
    for (const delay of [1_000, 2_000, 4_000]) {
      await settle();
      t.mock.timers.tick(delay);
    }
    await rejected;
    assert.equal(requested.length, 5, "preserve the four existing outer retry attempts");
    assert.ok(requested.slice(1).every((url) => url.endsWith("/responses")));
  });
}
