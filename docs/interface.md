# Cookie interface and accessibility

Version 1.1 provides matching Standard and Compact interfaces through `<x-consent::banner />` alongside the head/runtime component. Both use ordinary HTML, scoped CSS, native checkbox controls, and a native `<dialog>` with no frontend framework. They target the applicable WCAG 2.2 A and AA criteria of this interface; the package does not certify an entire website or replace a site accessibility review.

The interface supports light/dark/auto modes, seven bundled languages, custom locale fallback, and non-blocking diagnostics with 72-hour warning suppression.

## Setup

Follow [installation and configuration](../README.md#install), then place `<x-consent::head />` in the shared layout's head and `<x-consent::banner />` in its body. The default components embed the package's assets, so no npm build or resource publication is needed for the interface. Set `ui.policy_url` to a real page in your application; the package does not create that route.

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

With the default light theme, Standard preserves the original white card, light shadow, spacious dialog, and filled acceptance/refusal buttons. Compact reduces card/dialog width and padding, category/service spacing, and corner rounding; it uses equally prominent outlined acceptance/refusal buttons. Its card has no shadow, and wider cards place the two choices side by side. Both retain the same wording, policy links, complete category purposes, service lists, switches, and actions. In both variants, category purposes remain visible and native `<details>` disclosures hold the complete service lists. Lists start collapsed; a decorative chevron beside the disclosure label points down when closed and up when open. Tab reaches each disclosure; Enter or Space opens or closes it without changing consent, category switches, or writing a decision. Native expanded-state semantics remain available to assistive technology.

Both variants support bottom-left, bottom-right, and bottom-center independently of appearance. Center becomes a wide two-column layout on larger screens. All layouts wrap and scroll vertically on narrow or short viewports; actions stack on small screens. Safe-area bottom insets are respected. Theme, variant, position, locale, and color changes neither invalidate nor extend a saved decision, and do not alter the consent fingerprint.

Set `ui.theme` to `light` (the default), `dark`, or `auto` in configuration. No theme button is added. `auto` follows the browser/system preference through CSS `prefers-color-scheme`, including live changes with an open dialog. Without media-query support it stays light. All interface surfaces share the palette in both variants, while scoped `color-scheme` matches native controls and scrollbars without changing the host page. Existing published configs without these settings keep light. Republish/update customized views and assets to use the new selectors.

`ui.colors` and `ui.dark_colors` default to empty arrays and independently override their palette's eight six-digit HEX colors. Missing/invalid entries inherit the corresponding palette default; custom light colors are not automatically transformed. Contrast diagnostics check both palettes and identify the affected palette even if it is inactive. Changing the theme does not write a decision or reset an open draft. See the README's [theme configuration and palette table](https://consent.lipinskijakub.pl/docs/banner-and-theme).

Text and button dimensions use relative units. Category/service text and action labels can wrap without truncation. Both default palettes meet at least 4.5:1 for normal text and 3:1 for controls/focus against the UI background. Custom themes accept six-digit hex colors; invalid formats fall back to their defaults and log a warning without interrupting the page. Contrast diagnostics default to off (`ui.validate_contrast => false`, also when omitted). Enabling them logs warnings for pairs below these thresholds while preserving the chosen colors; logging failures cannot interrupt rendering. Diagnostics do not establish the accessibility of custom CSS. Decorative borders do not communicate state on their own. Switching state also changes the thumb position; links and focus have visible indicators beyond color.

Identical theme warnings (contrast, color format, and diagnostic flag issues) use a 72-hour cache marker keyed by both resolved palettes and the issue list. The application's default cache claims the marker before logging; changed palettes/issues can be reported immediately, while presentation settings do not reset the interval. Cross-request/concurrent suppression requires a persistent cache with atomic `add`. Cache failures skip optional logging and preserve rendering; a logger failure keeps the claimed marker until expiry. Clearing/evicting markers can allow earlier retries, `array` cache is limited to its lifetime, and `null` cache skips these diagnostics. Healthy settings do not access the diagnostic cache. This does not change consent decisions or browser gates; see the README's [diagnostic behavior](https://consent.lipinskijakub.pl/docs/banner-and-theme).

At the default font size, primary controls are at least 48 CSS pixels high in Standard and 44 in Compact. Close controls are at least 44 by 44, switches 48 by 44, and the launcher 52 by 52. Policy links retain their inline-text exception. This exceeds the applicable [WCAG 2.2 minimum target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). Text resizing, spacing changes, and [320 CSS pixel reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) are included in verification.

The launcher places a palette-colored backing beneath its focus outline so the outline keeps its UI contrast even on an opposite-themed host page.

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

### Languages and custom translations

Both variants ship `en`, `pl`, `de`, `fr`, `it`, `es`, and `pt` (European Portuguese), including preset purposes, accessible names, status/error messages, and the Advanced Google notice. The component locale takes priority over `ui.locale`, which takes priority over the app locale. Custom `lang/vendor/consent/{locale}/messages.php` and optional `services.php` dictionaries work without a package language allowlist. No publishing step is required to add these files.

Requested regional/script locales fall back through their parents and then English, per key, without using the app's configured fallback locale. Normalized hyphen and underscore directory forms are supported; hyphen wins when both define the same key. A partial `fr_CA/messages.php` can override Canadian French wording while inheriting the remaining French messages. If no matching nonempty UI dictionary exists, the root uses `lang="en"`; otherwise it uses the selected dictionary's normalized language tag. Empty/missing keys inherit fallback text, and non-string values are configuration errors. Custom service metadata is preserved unless an explicit display translation is supplied.

Language/wording changes preserve saved decisions and their lifetime. Vary shared HTML caches by the locale used to render the interface. Custom RTL languages require adapting the built-in LTR view/layout and verifying the integrated interface in a native browser. See the README's [translation examples](https://consent.lipinskijakub.pl/docs/translations).

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

Check both variants with all three positions, all three theme modes, independent palette overrides, all bundled languages and custom dictionaries, inline and published assets under CSP, necessary-only and all-category registries, storage failures, and saved choices across visits and variant changes. Verify Tab/Shift+Tab loops, Space, Escape, focus return, draft cancellation, overlay behavior around host-page focus, saving, reopening, and withdrawal. Check 320 CSS pixel reflow, 200% text size, and increased line/letter/word/paragraph spacing, including the fully visible final save control.

Run full axe checks with WCAG A/AA tags in that host application, including contrast and target size, for the banner, modal, and launcher. In jsdom, only geometry-dependent contrast and target-size rules are disabled; semantic/state tests use real PHP-rendered Blade fragments and require no standalone website.

Version 1.1.0 native WebKit verification covered Standard and Compact with all three positions and both languages, nonce-based inline/published assets, full axe checks, native keyboard wrapping and service disclosures, draft cancellation/focus return, saved decisions across variant changes, active withdrawal with reload and declared cookie cleanup, necessary-only registries, and storage errors. Both variants/languages had no horizontal overflow at 320 CSS pixels with combined 200% text size and spacing stress, including all-category dialogs and expanded Compact service lists. Tab to the final Save control scrolled it fully into view. See [the release verification](releases/v1.1.0.md#verification) for automated counts and the distinction between local and configured CI coverage.

Full axe checks found no violations in the tested version 1.1 banner and modal states. Some checks remained incomplete: closed-modal `aria-controls` references, decorative close glyph/name matching, and overlapping text backgrounds. Manual review confirmed the referenced dialog IDs, hidden decorative glyphs with explicit control names, and opaque theme backgrounds with measured foreground/background contrast. These reviewed items are not silently counted as automatic passes. Earlier native checks also covered the reopening launcher. These results do not cover arbitrary custom colors accepted with contrast diagnostics disabled.

Native testing used the Codex in-app browser. Actual screen reader announcements, other browser engines, high-contrast OS modes, and the complete host-site experience were not certified by these checks. The automated suite and native checks provide evidence for this release's interface behavior, not a blanket WCAG certification.

### Language verification

On 2026-10-09, local validation used PHP 8.4.25, Laravel 13.35.0, and Node 22.21.1. `composer check` passed 321 Pest tests and 142 Node/jsdom tests, including all bundled languages in both variants and file-backed custom/regional translation tests. These are locally executed checks, not a claim that the entire configured PHP/Laravel CI matrix was run again.

A disposable Laravel host outside the package checkout was checked in the native Codex in-app browser. Standard and Compact passed 320px reflow with all seven bundled languages, a partial custom Dutch dictionary, and a Canadian French override. Both variants also passed combined 200% text size and increased text spacing at 320px with all five new languages and those custom dictionaries: no horizontal overflow or clipped interface labels; the dialogs scrolled and the final Save control remained fully visible when keyboard-focused. French layouts fit all three positions at 1280×900. Full axe checks, including contrast and target size, reported no violations in the tested banner/modal states; the closed-dialog `aria-controls` check remained incomplete and the referenced dialog ID was verified manually.

Native keyboard checks confirmed dialog modality, initial heading focus, Tab/Shift+Tab wrapping, Escape cancellation, and opener focus restoration. Nonce-protected inline assets rendered under CSP, and an analytics-gated module with an import and top-level await stayed inert until acceptance and then ran in order before the following script. The application had no CSP violations at DOM readiness; subsequent browser tooling produced an anonymous blocked inline-style event, so that instrumentation event is not counted as a clean browser-console result. These checks do not establish screen-reader pronunciation or arbitrary custom/RTL layout accessibility.

### Diagnostic logging verification

On 2026-10-09, `composer check` passed 331 Pest tests and 142 Node/jsdom tests on the same local PHP/Laravel/Node versions listed above. Focused tests covered suppression until the exact 72-hour boundary without extending the interval on repeated reads, immediate reporting for new palettes/issues, persistence across independent file-cache repositories, and rendering with unavailable cache/logging. This is local validation, not a rerun of the full configured CI matrix.

In a separate disposable Laravel host with persistent file cache, five fresh HTTP requests (including a Standard-to-Compact and French-to-German change) produced one warning. A request with another problematic accent produced a second warning immediately. Both interfaces rendered with the selected colors, and the native dialog retained its initial heading focus and modality. The logging change does not alter markup, CSS, or browser scripts; the preceding language verification records those interface checks.

### Theme verification

On 2026-10-09, local `composer check` passed 362 Pest tests and 148 Node/jsdom tests with PHP 8.4.25, Laravel 13.35.0, and Node 22.21.1. Tests cover existing config defaults, strict theme validation, independent partial palettes, CSS/server default consistency, unsafe dark colors, nonce-protected inline overrides with published assets, configuration caching, both-palette diagnostics, 72-hour suppression, and unchanged consent gates/lifetimes. These are local checks, not a rerun of the full configured CI matrix.

A disposable Laravel host (PHP 8.5.9 with the same installed Laravel version) outside the package checkout was checked in the native Codex in-app browser. Both variants rendered light, dark, and auto banners/dialogs with matching scoped control colors and no full-axe violations in tested banner/modal states. The browser's actual preference was light. Live light/dark auto branches were exercised by a host-only harness changing the media rule's condition; the package's declarations and runtime were unchanged. This verifies native CSS branch behavior, not an actual OS preference toggle or other browser engines. The auto transitions preserved an open analytics draft without writing a decision, then saved normally. Independent palette overrides worked with nonce-protected inline theme styles and published CSS/JS. An analytics-gated module/import/top-level await executed only after permission, in dependency/module/following-script order.

Dark layouts fit 320 CSS pixels in all three positions and both variants with French text, 200% text sizing, increased text spacing, and expanded service disclosures. No horizontal overflow occurred and keyboard focus scrolled the final Save control fully into view. Native keyboard checks verified initial heading focus, forward/backward wrapping, Space, Escape cancellation, and opener focus return. A focused dark launcher had the configured focus outline over its own dark backing on the light host page.

The host recorded no CSP violations at DOM readiness. As in the preceding checks, browser instrumentation later produced a blocked anonymous inline-style event; this is not counted as a clean console result. The closed-dialog reference check remained incomplete in axe and was reviewed against the existing dialog ID. Screen readers, dedicated forced-colors environments, and arbitrary custom palettes require their own checks.

Version 1.1.1 rechecked independent service disclosures and arrow states in both variants/languages under inline/published nonce CSP. Both variants/languages reflowed at 320 CSS pixels with combined 200% text and increased spacing, including every service list expanded. Native keyboard interaction, draft cancellation, save/focus return, module ordering, and withdrawal were verified. See [the 1.1.1 release verification](releases/v1.1.1.md#verification).
