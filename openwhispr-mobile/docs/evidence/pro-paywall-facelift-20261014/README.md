# Pro paywall facelift — execution checkpoint, 14 October 2026

Status: target clarification pending; no design implementation saved or published.

## Authority and inputs

The approved design and execution brief are in greatcoat/titan commit `f474ca1075f4a50b033fcbc82f4d39397d7c5480`, `docs/handovers/2026-10-14-pro-paywall-facelift-execute.md`, and `artefacts/reports/2026-10-13-pro-paywall-prototypes.html`. The user authorized an in-place facelift and separate mobile PR, preserving identity, routing, publication state and payment behavior. No mobile merge/release or charge is authorized.

## Current provider findings

Read directly from the authenticated Superwall dashboard on October 14:

| Existing paywall | Current evidence |
| --- | --- |
| First Paywall, 239043 | Paywall list shows 2 active campaigns. Onboarding campaign 110528 uses this paywall for 100% of its matched audience on `onboarding_paywall`. Its audience is all unsubscribed users, without filters. |
| Creator Code TEST DRAFT 2026-09-25, 271365 | Paywall list shows 1 active campaign. Editor contains the expected creator input, blocking apply/redemption callbacks, product bindings and guard conditions. Campaign 109201 is still restricted to `device.bundleId == "com.openwhispr.creatorcode.probe20260925"`, placement `creator_code_probe_20260925`, without a catch-all. |
| DRAFT, 279623 | Inactive; edited one day earlier. Five benefits and ordinary plan cards; the inspected layer tree has no creator input/apply controls. |

The implementation chat asked Josh which existing paywall should receive the facelift. This is a target clarification, not renewed plan approval. Changing First Paywall to add creator functionality would exceed the stated visual-only scope. Do not silently substitute the historical test target for the current live target.

For 271365, version history showed saved revision #12 dated September 26, 2026 at 2:59 AM as displayed by the dashboard, and #13 Unsaved Changes in the current editor. Only read tools were invoked; no design mutation, Save or Publish was invoked. The exported tree is the current editor readback, not a claim that every field exactly matches saved revision #12. Verify the saved version and acquire a complete rollback snapshot before editing the confirmed target.

## Captured baseline

- `before-tree.json`: complete 69-node editor subtree including CSS, click actions and conditional bindings.
- `before-products.json`: existing annual primary and monthly secondary; Monthly is default, index 1. Product values come from the SDK.
- `before-variables.json`: authored state, parameters and callback defaults, plus selected product index. Does not include user/device records.
- `before.jpg`: provider editor screenshot at 390×845, prior to design changes. This is provider-preview evidence, not native rendering or storefront proof.
- `baseline-tests.txt`: 9 existing suites / 125 tests passed, Node 24.20.0; cloned existing dependency tree. Covers affiliate paywall, offers, attribution, link parsing, intent, Superwall gating/provider and refusal-only callback probe.

No simulator was booted at inspection. No device profile, purchase, redemption, Restore or attribution mutation was performed. Native rendering and post-change checks remain outstanding.

## Source baseline and ownership

Repository: OpenWhispr/openwhispr. Affiliate PR #2334 remains open at `3a434905b813eba100ac3320cb420d4171082d92`. Fresh origin/main was `2516e6e000b866a06099f69fd851b914069653d4`. The affiliate implementation is still on the PR branch; the facelift branch is based on that exact head so a separate stacked PR can isolate visual integration from the existing affiliate work. No source algorithms were edited.

Owned sparse worktree: `/Users/joshuadavidpadoa/dev/ow-pro-paywall-facelift-20261014`, branch `codex/pro-paywall-facelift-20261014`. Kept because the approved implementation is unfinished pending target clarification and this checkpoint contains its fresh evidence. Copied dependencies are removed at this checkpoint; no owned build/server is running. Retire the worktree when the implementation handoff no longer needs it. The primary Titan checkout and its unrelated `wiki/inbox/` were not changed.

## Resume

1. Read Josh's target answer. Reopen that existing paywall and verify saved revision, full rollback/export, campaign/product bindings and current theme.
2. Apply the committed approved shared design, retaining all nine benefits, fixed footer, localized pricing, monthly-only creator controls and exact callback/payment guards. No prototype timer, sample USD values or fake outcomes enter production.
3. Reattach through Superwall's official editor skill; use current tool discovery. The helper is `/tmp/ow-paywall-editor-20261014/scripts/sw-editor.sh`; attachment state is outside the repository and must not be committed or printed. Release the connection when done.
4. Save only in a way that preserves publication state. Compare before/after action and binding contracts, match screenshots to the prototype, exercise the complete requested matrix without charges, distinguish preview/mocks/simulator/device evidence, and open the separate mobile PR with the actual revision and remaining gaps. No implementation PR exists yet.
