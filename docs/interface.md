# Cookie interface and accessibility

Beta.3 provides `<x-consent::banner />` alongside the existing head/runtime component. It uses ordinary HTML, scoped CSS, native checkbox controls, and a native `<dialog>` with no frontend framework. It targets the applicable WCAG 2.2 A and AA criteria of this interface; it does not certify an entire website or replace a site accessibility review.

## Visitor behavior

- A pending decision shows the banner with Accept all, Reject optional, and Manage preferences. Acceptance and rejection use the same size, color, and hierarchy.
- Necessary is always active. Only categories used by enabled services in the global registry appear. The choice applies across the website, including services on other pages.
- The modal lists category purposes and registered services. Optional switches start from the current valid decision, or off when pending. Switching a draft does not activate a script.
- Save preferences replaces the full selection. Acceptance and refusal use the same persistence and expiry. A small icon remains available after a choice and subsequent visits.
- The banner close button or Escape collapses the notice without granting permission or writing a decision. Closing the modal, pressing Escape, or clicking its backdrop discards unsaved edits. The next full page visit shows a pending banner again.
- With no optional services, the initial banner is omitted. The icon opens necessary information without inventing a decision.
- The UI follows changes detected by the runtime, including another tab, server updates, and expiry. Changes to an open selection are announced; an external decision replaces its draft.
- Saving is guarded against repeated activation. A polite status announces saving and success. A storage failure leaves a visible retryable alert and optional permission stays denied. If temporary denial cannot survive navigation, the alert asks the visitor to leave the page, following the runtime's safe failure behavior.
- Withdrawal of already running code normally reloads the page with the new choice. The UI uses the same lifecycle as programmatic decisions; it cannot stop a tracker by merely deleting a script element.

See [the runtime guide](browser-runtime.md) for storage recovery, revocation, cleanup, and script diagnostics. Use an explicit user action for every decision. Opening preferences through `data-consent-open` or `Consent.openPreferences()` never grants permission.

## Keyboard, focus, and semantics

The initial banner is a named section, not a modal, and does not autofocus. A native modal makes the background inert while preferences are open. It has an accessible heading, starts focus at that heading, confines Tab and Shift+Tab to enabled controls, and closes with Escape. Space changes a checkbox/switch; Enter submits the preferences form. The necessary control is checked, disabled, and accompanied by visible explanatory text.

On dismissal or save, focus returns to the opener when it remains visible; otherwise it moves to the reopening icon. A delayed native close event does not pull focus back from another page control. There is no keyboard trap preventing dismissal and no positive tabindex.

An overlay must not obscure keyboard focus on the host website. If focus moves to a page control underneath the banner, the banner collapses to its icon without making a decision. If that icon would also cover the focused control, it is temporarily hidden until focus moves away. The active page control retains focus. A `data-consent-open` footer or privacy-page button is an additional convenient route to preferences.

The modal scrolls vertically; its footer is not sticky and cannot cover focused controls. Labels, category descriptions, a fieldset legend, service lists, named close buttons, and a labelled reopening SVG support the accessibility tree. Decorative SVGs and the close glyph are hidden from assistive technology. Long structured modal content is not flattened into a single `aria-describedby` announcement.

These behaviors follow the [W3C modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) and [Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html).

## Appearance and layout

The default is a white card with a light shadow, sentence case headings, underlined links, visible focus outlines, and spacious action buttons. Left/right variants are compact; center becomes a wide two-column layout on larger screens. All variants wrap and scroll vertically on narrow or short viewports. Safe-area bottom insets are respected.

Text and button dimensions use relative units. Category/service text and action labels can wrap without truncation. Normal text requires at least 4.5:1 contrast, and controls/focus at least 3:1 against the UI background. Configuration accepts only validated six-digit hex colors. Decorative borders do not communicate state on their own. Switching state also changes the thumb position; links and focus have visible indicators beyond color.

Primary controls are at least 48 CSS pixels high at the default font size. Close controls are at least 44 by 44, switches 48 by 44, and the launcher 52 by 52. Policy links retain their inline-text exception. This exceeds the applicable [WCAG 2.2 minimum target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). Text resizing, spacing changes, and [320 CSS pixel reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) are included in verification.

There are no automatic animations or flashing effects. Reduced motion resets animation/transition/scroll behavior in the interface. Forced-colors styles restore native checkboxes and system control/focus colors. Those media-query styles are implemented; a dedicated forced-colors environment and assistive technology testing are still needed for a site's supported platform combinations.

| Applicable criteria | Interface behavior |
|---|---|
| 1.1.1, 1.3.1, 1.3.2 | Named controls, headings, labels, fieldset, service lists, logical reading order |
| 1.4.1, 1.4.3, 1.4.11 | State beyond color; validated text/control contrast and visible outlines |
| 1.4.4, 1.4.10, 1.4.12 | Relative text, wrapping, vertical scrolling, no clipped content under tested resizing/spacing |
| 2.1.1, 2.1.2, 2.4.3, 2.4.7 | Keyboard actions, dismissible modal, logical focus and visible focus |
| 2.4.11, 2.5.8 | Overlay yields to host-page focus; sufficiently sized standalone controls |
| 3.1.2, 3.2.1, 3.2.2 | UI language declared; focusing or editing a draft does not save a choice |
| 3.3.1, 3.3.2, 4.1.2, 4.1.3 | Instructions, named switches, storage error alerts, polite status messages |

The reference is [WCAG 2.2](https://www.w3.org/TR/WCAG22/). Criteria that depend on the host site's content, navigation, authentication, or other features need assessment in that context.

## Browser support and failure behavior

Use current browsers with native `HTMLDialogElement.showModal()`, modern JavaScript, and readable first-party cookie storage. There is no legacy dialog polyfill. Optional scripts are denied unless the core runtime successfully stores and verifies a current grant.

Until the core and UI initialize successfully, the server renders a readable in-flow fallback with the policy link when configured. The interactive banner, icon, and dialog remain hidden. With JavaScript disabled or core unavailable, the fallback remains and optional templates stay inert. Without native dialog support, the UI remains unavailable while the core still honors valid saved preferences; missing or invalid decisions continue to deny optional processing. Configure a real policy URL for useful fallback information. The package adds no unprotected decision route as a fallback.

Serve the head before the UI. Both components accept a nonce; scripts and styles need matching CSP permissions. Publishing `consent-assets` supplies `consent.js`, `banner.js`, and `consent.css`. Even with separate files, custom theme colors emit an inline style requiring a matching style nonce. Preserve the stylesheet and scripts when overriding the view, and recheck focus/labels if changing markup.

Only one UI root is supported per document. The component renders once per response. If a SPA replaces the entire root, the controller removes stale listeners and mounts the new root. Keep stable script block IDs for page fragments as described in the runtime guide. Locale-specific HTML caches must vary by locale.

## Integration responsibilities

Describe actual services and purposes, provide a real policy, classify optional processing correctly, and gate every optional script/request under the appropriate permission. The package does not discover trackers already loaded elsewhere. Translate service purposes without changing their meaning. A material change still requires updated canonical metadata or the policy version.

Keep withdrawal readily available. The same interface allows refusal and later replacement of a saved grant, consistent with the withdrawal guidance in [EDPB Guidelines 05/2020, section 5.2](https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf). Whether each site's processing, policy, retention, and vendor setup meets legal requirements remains site-specific. Google Consent Mode v2 and provider presets are subsequent milestones.

The host website must preserve root font sizing, viewport scaling, supported browser behavior, accessible policy content, and sufficient contrast after custom styles. Do not disable pinch zoom or override labels/focus styles. Test the integrated page, including fixed headers/footers and third-party widgets. Test with the screen readers and browsers relevant to your visitors before claiming complete WCAG conformance.

## Verification

```bash
composer install
npm ci --ignore-scripts
composer check
php -S 127.0.0.1:8873 tests/Browser/ui.php
```

Open the local fixture in a real browser. It uses only local mock trackers. Query options:

| Option | Effect |
|---|---|
| `position=bottom-left`, `bottom-right`, `bottom-center` | Banner/launcher position |
| `locale=en` or `pl` | Interface language |
| `assets=1` | Separate CSS and runtime/UI scripts under a nonce-based CSP |
| `all=1` | All five categories, including longer scrolling content |
| `empty=1` | Necessary only, no initial optional banner |
| `stress=1` | Increased line, letter, word, and paragraph spacing |
| `zoom=1` | Root text size 200% |

The page includes reset, text size/spacing, blocked-cookie simulation, and audit controls. Audit preferences opens the modal and runs axe with WCAG A/AA tags, including contrast and target size. Audit current page checks the visible banner or launcher. In jsdom, only geometry-dependent contrast and target-size rules are disabled; semantic/state tests use real PHP-rendered Blade output.

Beta.3 local native-browser checks covered all three positions, English/Polish, nonce-based inline and published assets, keyboard loops and draft cancellation, saved decisions across visits, selection/withdrawal with reload and declared cookie cleanup, storage errors, and 320 CSS pixel reflow. At 320 pixels, both the banner and all-category modal also had no horizontal overflow with combined 200% text size and spacing stress. Tab to the final save control scrolled it fully into view.

Full axe checks found no violations in the tested banner, launcher, and modal states. Modals in both languages, including the narrow stressed modal, had no incomplete checks. Closed-modal `aria-controls` references on openers were manually verified because axe marks them incomplete. One overlapping banner text background also required manual contrast review: the card is opaque and the PHP theme check verifies the foreground/background pair. These reviewed items are not silently counted as automatic passes.

Native testing used the Codex in-app browser. Actual screen reader announcements, other browser engines, high-contrast OS modes, and the complete host-site experience were not certified by these checks. The automated suite and native checks provide evidence for this release's interface behavior, not a blanket WCAG certification.
