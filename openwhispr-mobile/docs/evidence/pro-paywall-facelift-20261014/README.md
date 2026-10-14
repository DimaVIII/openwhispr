# Pro paywall facelift — blue draft, 14 October 2026

Status: **reviewable, unpublished Superwall draft; acceptance is still open**. Josh confirmed target 271365 and then explicitly selected the blue design. No Publish, campaign change, mobile release, purchase, redemption, restore, or creator validation request was executed.

![Final blue editor preview](after-blue.jpg)

## Provider identity and persistence

- Application 38286; existing paywall **271365**, `Creator Code TEST DRAFT 2026-09-25`.
- Last saved provider baseline: revision **12** (Sep 26, 2026, 2:59 AM as displayed). The facelift is in the editor's local **Unsaved Changes** draft, above that baseline. It survives reload. It has **not** created a newly published revision or a server-side saved-release claim.
- Campaign 109201 remains restricted to bundle `com.openwhispr.creatorcode.probe20260925`, placement `creator_code_probe_20260925`, with no catch-all. Live onboarding campaign 110528 still uses paywall 239043. No routing was edited.
- The complete exported draft in `after-tree.json` is the durable review/rollback record alongside the existing editor draft. The official editor documentation says unpublished changes persist locally until sign-out: https://superwall.com/docs/dashboard/dashboard-creating-paywalls/paywall-editor-publishing . Keep the editor session available; do not sign out and assume a remote revision exists.

## Design applied

The source is greatcoat/titan commit `f474ca1075f4a50b033fcbc82f4d39397d7c5480`, `artefacts/reports/2026-10-13-pro-paywall-prototypes.html`. The exact embedded blue artwork was extracted and uploaded to Superwall, without generating replacement artwork. Provider asset: `https://user-content.superwalleditor.com/user-content/Qk5W_puKFGoJ0Ezp1vSpv.png` (786×1704; 1,775,075 bytes). It renders at 81% opacity with translucent benefit/form panels and footer.

The draft includes the flat Pro keycap, all nine benefits, annual/monthly cards and selection indicators, catalog-bound prices, computed annual savings, 50px glossy CTA, directly visible monthly creator form, fixed 108px action width, loading spinner, verified Applied check, read-only accepted code, concise error/recovery copy, and preserved close/restore/terms routes. The spinner SVG respects reduced motion. Annual hides the creator area and shows ordinary monthly catalog pricing on the unselected Monthly card. Returning to Monthly restores the verified offer presentation.

No app-source presentation change was needed: Superwall owns these visuals. This PR contains the exported configuration, evidence, and an executable contract verifier rather than unrelated app changes.

## Functional comparison

`verify-facelift-contract.mjs` compares saved revision 12 to the final exported draft. **Every original node remains, and every original click-action property is byte-identical except the explicit recovery control.** The blocking apply callback, its payload and callback leaf resets, redemption callback, CTA guard ordering, products, default plan, restore, terms, and dismissal actions remain intact. The verified monthly price binding is identical; the verified renewal branches are identical, with only the ordinary fallback shortened to “Billed monthly.”

Two UI-state adaptations make the always-visible form compatible with the existing unchecked-input guard:

1. `state.creatorOpen` starts true, instead of false.
2. Continue without code retains the existing regular-monthly choice and phase reset, keeps `creatorOpen` true, and clears the input. Typing a new code after recovery blocks ordinary payment again.

The accepted-code display duplicates the original success visibility condition. It cannot show Applied merely because a callback resolved; all original required price/renewal/token checks must pass. The original input and apply control remain hidden under the original ready condition, so the accepted display is read-only.

## Validation and limits

- **19 exported-configuration checks pass**: `contract-results.txt`. Run from repository root with Node 24: `node openwhispr-mobile/scripts/creator-paywall-probe/verify-facelift-contract.mjs`.
- **125 existing tests / 9 suites passed** against the unchanged affiliate source at the baseline: `baseline-tests.txt`. No native affiliate, attribution, validation, backend, or purchase source was edited afterward. These are unit/probe tests, not financial acceptance.
- Interactive editor checks: unchecked code disables CTA; checking disables apply/CTA; complete seeded offer shows Applied and a read-only entered code; Annual hides creator controls; Monthly restores the accepted presentation; error retains entered text; explicit Continue without code clears it; re-entry blocks ordinary payment. No request/financial action was clicked.
- The success/loading screenshots use explicitly temporary **preview fixtures**, including `PREVIEW20` and `$7.99`. They are not a validated creator, live discount, or assigned offer. All fixture overrides and input text were removed before the final readback. `after-variables.json` records empty/false offer defaults and null overrides.
- Compact 375×667 with temporarily enlarged 125% font sizes: no horizontal overflow (375px scroll/client width), 60px form, 44px controls, 108px action. Scrolling exposed a small footer overlap at the initial 140px bottom padding; final padding is 180px. The final compact scroll clearance and native Dynamic Type still need acceptance. All temporary font-size edits were restored.
- Screenshot names beginning `preview-` record intermediate state/size checks; they precede the final price-font asset normalization and bottom-padding adjustment. `after-blue.jpg` is the final default blue preview. These are editor renderings, not native app screenshots.
- Final readback was rechecked after reload. `after-reload-tree.json` records the final persisted local draft; it is not proof of a publish.

## Open acceptance items — do not publish as accepted

1. **Pre-existing payment guard gap, reproduced without a transaction:** in `error` or `unavailable`, an empty input can reach the ordinary purchase fallback. The error case was observed in the interactive editor by manually emptying the field; both cases are demonstrated in the original and final exported CTA conditions. They are not caused by this facelift. The requested strict “explicit recovery only” invariant is therefore not fully met by the inherited logic. A separately reviewed guard repair is needed before release; this UI-only change deliberately preserves the original CTA action tree.
2. **Native rendering and behavior:** the editor's device dialog offers Published Version (In-App) and Real-Time Preview (Safari). No new draft was published to obtain SDK rendering. No simulator/device profile was changed. Native callback/storefront/reduced-motion/VoiceOver acceptance remains unverified.
3. **160ms state crossfade:** the fixed geometry, spinner, applied check, alert labels and opacity transition declarations are present. A true checking→applied crossfade is not yet proven; display-based visibility can prevent an opacity transition from running. Complete that visual acceptance without adding delays or modifying validation/payment response handling.

## Evidence and rollback

- `before-tree.json`: original inspected editor tree, 69 nodes.
- `saved-revision-12-tree.json`: exact saved revision loaded before edits. Differences from the first export were rendered catalog text; authored properties were unchanged.
- `before-products.json`, `after-products.json`: catalog identity/order/default comparison.
- `before-variables.json`, `after-variables.json`: authored/default state only, excluding user/device records.
- `after-tree.json`, `after-reload-tree.json`: complete draft configuration and persistence readback.
- `before.jpg`, `after-blue.jpg`, `preview-*.jpg`: provider preview evidence, labeled above.
- `sha256.json`: integrity hashes. No controller credentials, private offer URL, or preview token is stored in the published definition.

To roll back the provider draft, use revision history to restore revision 12 after preserving any later human edits. This document does not authorize publishing a rollback. The mobile PR has no runtime app code to roll back.

## Branch and handover

Repository `OpenWhispr/openwhispr`; stacked on affiliate PR #2334 head `3a434905b813eba100ac3320cb420d4171082d92`, branch `feat/mobile-affiliate-port-20260924`. Fresh main at baseline was `2516e6e000b866a06099f69fd851b914069653d4`.

Owned sparse checkout: `/Users/joshuadavidpadoa/dev/ow-pro-paywall-facelift-20261014`, branch `codex/pro-paywall-facelift-20261014`. **Kept** for the open acceptance items and review follow-up; no copied dependencies, builds, or owned servers remain. Retire it when this draft handoff is accepted or superseded. Other sessions' worktrees and the primary Titan checkout were untouched.
