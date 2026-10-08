# Cookie interface and accessibility

Version 1.1 provides matching Standard and Compact interfaces through `<x-consent::banner />` alongside the head/runtime component. Both use ordinary HTML, scoped CSS, native checkbox controls, and a native `<dialog>` with no frontend framework. They target the applicable WCAG 2.2 A and AA criteria of this interface; the package does not certify an entire website or replace a site accessibility review.

## Setup

Follow [installation and configuration](../README.md#installation), then place `<x-consent::head />` in the shared layout's head and `<x-consent::banner />` in its body. The default components embed the package's assets, so no npm build or resource publication is needed for the interface. Set `ui.policy_url` to a real page in your application; the package does not create that route.

Presets are disabled and custom services are empty after installation. Enable the presets you use with their IDs or register your own optional services; without an optional purpose, only the preferences launcher appears. Publishing views or translations is optional and only needed for file customization. Refresh cached configuration after changing UI settings.

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

An overlay must not entirely obscure keyboard focus on the host website. If focus moves to a page control fully covered by the banner, the banner collapses to its icon without making a decision. If that icon would also fully cover the focused control, it is temporarily hidden until focus moves away. Large page containers and partially visible controls do not dismiss the notice. The active page control retains focus. A `data-consent-open` footer or privacy-page button is an additional convenient route to preferences.

The modal scrolls vertically; its footer is not sticky and cannot cover focused controls. Labels, category descriptions, a fieldset legend, service lists, named close buttons, and a labelled reopening SVG support the accessibility tree. Decorative SVGs and the close glyph are hidden from assistive technology. Long structured modal content is not flattened into a single `aria-describedby` announcement.

These behaviors follow the [W3C modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) and [Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html).

## Appearance and layout

Set `consent.ui.variant` to `standard` (the default) or `compact`. A component override, `<x-consent::banner variant="compact" />`, selects the appearance of both the banner and its preferences dialog. Other values are rejected. Existing published configurations without the setting keep Standard.

Standard preserves the original white card, light shadow, spacious dialog, and filled acceptance/refusal buttons. Compact reduces card/dialog width and padding, category/service spacing, and corner rounding; it uses equally prominent outlined acceptance/refusal buttons. Its card has no shadow, and wider cards place the two choices side by side. Both retain the same wording, policy links, complete category purposes, service lists, switches, and actions. In both variants, category purposes remain visible and native `<details>` disclosures hold the complete service lists. Lists start collapsed; a decorative chevron beside the disclosure label points down when closed and up when open. Tab reaches each disclosure; Enter or Space opens or closes it without changing consent, category switches, or writing a decision. Native expanded-state semantics remain available to assistive technology.

Both variants support bottom-left, bottom-right, and bottom-center independently of appearance. Center becomes a wide two-column layout on larger screens. All layouts wrap and scroll vertically on narrow or short viewports; actions stack on small screens. Safe-area bottom insets are respected. Variant, position, locale, and color changes neither invalidate nor extend a saved decision, and do not alter the consent fingerprint.

Text and button dimensions use relative units. Category/service text and action labels can wrap without truncation. The default palette meets at least 4.5:1 for normal text and 3:1 for controls/focus against the UI background. Custom themes accept six-digit hex colors; invalid formats fall back to their defaults and log a warning without interrupting the page. Contrast diagnostics default to off (`ui.validate_contrast => false`, also when omitted). Enabling them logs warnings for pairs below these thresholds while preserving the chosen colors; logging failures cannot interrupt rendering. Diagnostics do not establish the accessibility of custom CSS. Decorative borders do not communicate state on their own. Switching state also changes the thumb position; links and focus have visible indicators beyond color.

At the default font size, primary controls are at least 48 CSS pixels high in Standard and 44 in Compact. Close controls are at least 44 by 44, switches 48 by 44, and the launcher 52 by 52. Policy links retain their inline-text exception. This exceeds the applicable [WCAG 2.2 minimum target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). Text resizing, spacing changes, and [320 CSS pixel reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) are included in verification.

There are no automatic animations or flashing effects. Reduced motion resets animation/transition/scroll behavior in the interface. Forced-colors styles restore native checkboxes and system control/focus colors. Those media-query styles are implemented; a dedicated forced-colors environment and assistive technology testing are still needed for a site's supported platform combinations.

| Applicable criteria | Interface behavior |
|---|---|
| 1.1.1, 1.3.1, 1.3.2 | Named controls, headings, labels, fieldset, service lists, logical reading order |
| 1.4.1, 1.4.3, 1.4.11 | State beyond color; tested default contrast, optional custom-theme diagnostics, and visible outlines |
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

Keep withdrawal readily available. The same interface allows refusal and later replacement of a saved grant, consistent with the withdrawal guidance in [EDPB Guidelines 05/2020, section 5.2](https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf). Whether each site's processing, policy, retention, and vendor setup meets legal requirements remains site-specific. Google Consent Mode v2, GA4, and Google Ads are included; see the [Google guide](google.md). Meta Pixel and Microsoft Clarity are included; see the [tracker guide](tracker-presets.md).

The host website must preserve root font sizing, viewport scaling, supported browser behavior, accessible policy content, and sufficient contrast after custom styles. Do not disable pinch zoom or override labels/focus styles. Test the integrated page, including fixed headers/footers and third-party widgets. Test with the screen readers and browsers relevant to your visitors before claiming complete WCAG conformance.

## Verification

```bash
composer install
npm ci --ignore-scripts
composer check
```

Use a disposable Laravel host application outside this repository, installing the package through a local Composer path repository. Add the head/banner components to that application's layout and register local mock services. All host markup, test resources, server entry points, and mock trackers stay outside the package checkout. Documentation/presentation websites belong in a separate repository.

Check both variants with all three positions, both languages, inline and published assets under CSP, necessary-only and all-category registries, storage failures, and saved choices across visits and variant changes. Verify Tab/Shift+Tab loops, Space, Escape, focus return, draft cancellation, overlay behavior around host-page focus, saving, reopening, and withdrawal. Check 320 CSS pixel reflow, 200% text size, and increased line/letter/word/paragraph spacing, including the fully visible final save control.

Run full axe checks with WCAG A/AA tags in that host application, including contrast and target size, for the banner, modal, and launcher. In jsdom, only geometry-dependent contrast and target-size rules are disabled; semantic/state tests use real PHP-rendered Blade fragments and require no standalone website.

Version 1.1.0 native WebKit verification covered Standard and Compact with all three positions and both languages, nonce-based inline/published assets, full axe checks, native keyboard wrapping and service disclosures, draft cancellation/focus return, saved decisions across variant changes, active withdrawal with reload and declared cookie cleanup, necessary-only registries, and storage errors. Both variants/languages had no horizontal overflow at 320 CSS pixels with combined 200% text size and spacing stress, including all-category dialogs and expanded Compact service lists. Tab to the final Save control scrolled it fully into view. See [the release verification](releases/v1.1.0.md#verification) for automated counts and the distinction between local and configured CI coverage.

Full axe checks found no violations in the tested version 1.1 banner and modal states. Some checks remained incomplete: closed-modal `aria-controls` references, decorative close glyph/name matching, and overlapping text backgrounds. Manual review confirmed the referenced dialog IDs, hidden decorative glyphs with explicit control names, and opaque theme backgrounds with measured foreground/background contrast. These reviewed items are not silently counted as automatic passes. Earlier native checks also covered the reopening launcher. These results do not cover arbitrary custom colors accepted with contrast diagnostics disabled.

Native testing used the Codex in-app browser. Actual screen reader announcements, other browser engines, high-contrast OS modes, and the complete host-site experience were not certified by these checks. The automated suite and native checks provide evidence for this release's interface behavior, not a blanket WCAG certification.

Version 1.1.1 rechecked independent service disclosures and arrow states in both variants/languages under inline/published nonce CSP. Both variants/languages reflowed at 320 CSS pixels with combined 200% text and increased spacing, including every service list expanded. Native keyboard interaction, draft cancellation, save/focus return, module ordering, and withdrawal were verified. See [the 1.1.1 release verification](releases/v1.1.1.md#verification).
