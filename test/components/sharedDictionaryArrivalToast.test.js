const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

async function mountListener(t, { workspaces = [{ id: "ws-1", name: "Acme" }] } = {}) {
  let root;
  const listeners = new Map();
  const calls = { toasts: [], requestedLists: [], viewWordsClicks: 0 };
  globalThis.__arrival = calls;
  globalThis.__arrivalWorkspaces = workspaces;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__arrival;
    delete globalThis.__arrivalWorkspaces;
  });
  installBrowserGlobals(t, {
    window: {
      addEventListener: (name, listener) => listeners.set(name, listener),
      removeEventListener: (name, listener) => {
        if (listeners.get(name) === listener) listeners.delete(name);
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-shared-dictionary-arrival-test-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `
        export const useTranslation = () => ({
          t: (key, values) => (values ? key + " " + JSON.stringify(values) : key),
        });
      `,
      "/ui/useToast": `
        export const useToast = () => ({ toast: (props) => globalThis.__arrival.toasts.push(props) });
      `,
      "/stores/workspaceStore": `
        export const useWorkspaceStore = {
          getState: () => ({ workspaces: globalThis.__arrivalWorkspaces }),
        };
      `,
      "/stores/sharedDictionaryStore": `
        export const useSharedDictionaryStore = {
          getState: () => ({
            setRequestedList: (list) => globalThis.__arrival.requestedLists.push(list),
          }),
        };
      `,
    },
  });
  const { default: Listener } = await vite.ssrLoadModule(
    "/components/SharedDictionaryArrivalToastListener.tsx"
  );
  root = createRoot(container);
  await React.act(async () =>
    root.render(
      React.createElement(Listener, {
        onViewWords: () => {
          calls.viewWordsClicks += 1;
        },
      })
    )
  );
  const arrive = (detail) =>
    React.act(async () => listeners.get("shared-dictionary-arrived")({ detail }));
  return { calls, listeners, arrive, unmount: () => React.act(async () => root.unmount()) };
}

test("dispatching the event shows the toast with both actions, and View words sets requestedList to allShared", async (t) => {
  const { calls, arrive } = await mountListener(t);

  await arrive({ workspaceId: "ws-1", count: 127 });

  assert.equal(calls.toasts.length, 1);
  const [toast] = calls.toasts;
  assert.equal(toast.title, 'dictionary.shared.arrival.title {"count":127}');
  assert.equal(toast.description, 'dictionary.shared.arrival.description {"workspace":"Acme"}');
  assert.deepEqual(
    toast.actions.map((action) => action.label),
    ["dictionary.shared.arrival.viewWords", "common.dismiss"]
  );
  assert.equal(calls.requestedLists.length, 0, "nothing is requested before the user acts");

  toast.actions[0].onClick();
  assert.deepEqual(calls.requestedLists, ["allShared"]);
  assert.equal(calls.viewWordsClicks, 1, "the control panel is sent to the dictionary view");

  assert.doesNotThrow(() => toast.actions[1].onClick());
  assert.equal(calls.viewWordsClicks, 1, "Dismiss leaves the view alone");
});

test("a workspace the store hasn't loaded gets the neutral description", async (t) => {
  const { calls, arrive } = await mountListener(t, { workspaces: [] });

  await arrive({ workspaceId: "ws-9", count: 1 });

  const [toast] = calls.toasts;
  assert.equal(toast.title, 'dictionary.shared.arrival.title {"count":1}');
  assert.equal(toast.description, "dictionary.shared.arrival.descriptionNoWorkspace");
});

test("a malformed event shows nothing, and unmounting stops listening", async (t) => {
  const { calls, listeners, arrive, unmount } = await mountListener(t);

  await arrive({ workspaceId: "ws-1", count: 0 });
  await arrive(undefined);
  assert.equal(calls.toasts.length, 0);

  await unmount();
  assert.equal(listeners.has("shared-dictionary-arrived"), false);
});
