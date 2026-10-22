const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

async function loadProfileMenu(t) {
  t.after(() => {
    delete globalThis.__auth;
    delete globalThis.__menuItems;
  });
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-profile-menu-",
    mockModules: {
      "/hooks/useAuth": "export const useAuth = () => globalThis.__auth;",
      "/MemberAvatar": "export default function MemberAvatar() { return null; }",
      // Renders the menu open and records each item's handler under its text.
      "/ui/dropdown-menu": `
        import React from "react";
        const textOf = (node) =>
          typeof node === "string" ? node : Array.isArray(node) ? node.map(textOf).join("") : "";
        export const DropdownMenu = ({ children }) => children;
        export const DropdownMenuTrigger = ({ children, ...props }) =>
          React.createElement("button", props, children);
        export const DropdownMenuContent = ({ children }) => React.createElement("div", null, children);
        export const DropdownMenuSeparator = () => null;
        export const DropdownMenuItem = ({ children, onSelect }) => {
          globalThis.__menuItems.set(textOf(children), onSelect);
          return null;
        };
      `,
    },
  });
  const { default: ProfileMenu } = await vite.ssrLoadModule("/components/ProfileMenu.tsx");
  const opened = [];
  const render = (auth) => {
    globalThis.__auth = auth;
    globalThis.__menuItems = new Map();
    return renderToStaticMarkup(
      createElement(ProfileMenu, { onOpenSettings: (section) => opened.push(section) })
    );
  };
  return { render, opened };
}

test("a session still loading shows neither Sign in nor an account", async (t) => {
  const { render } = await loadProfileMenu(t);

  const markup = render({ isLoaded: false, isSignedIn: false, user: null });

  assert.doesNotMatch(markup, /<button/);
});

test("signed out, the avatar offers Sign in", async (t) => {
  const { render } = await loadProfileMenu(t);

  const markup = render({ isLoaded: true, isSignedIn: false, user: null });

  assert.match(markup, /aria-label="common\.signIn"/);
});

test("each menu item opens its own Settings section", async (t) => {
  const { render, opened } = await loadProfileMenu(t);

  render({
    isLoaded: true,
    isSignedIn: true,
    user: { name: "Chad Piha", email: "chad@example.com", image: null },
  });
  for (const label of [
    "settingsModal.sections.account.label",
    "settingsModal.sections.plansBilling.label",
    "sidebar.settings",
  ]) {
    globalThis.__menuItems.get(label)();
  }

  assert.deepEqual(opened, ["account", "plansBilling", "general"]);
});
