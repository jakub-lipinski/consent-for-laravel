# Interface

## When to Read This Reference

Read when changing appearance, translations, policy links, reopening controls, or published consent views.

## Configuration

Edit selected entries inside `consent.ui`, keeping the others:

```php
'variant' => 'compact',
'position' => 'bottom-right',
'theme' => 'auto',
'locale' => null,
'policy_url' => '/cookies',
'validate_contrast' => true,
'colors' => ['accent' => '#245C49', 'accent_text' => '#FFFFFF'],
'dark_colors' => ['accent' => '#8DD8B4', 'accent_text' => '#10251B'],
```

Variants are `standard` and `compact`; positions are `bottom-left`, `bottom-right`, and `bottom-center`; themes are `light`, `dark`, `auto`, and `inherit`. Auto follows CSS `prefers-color-scheme`; there is no visitor theme selector. Component props can override presentation, for example `<x-consent::banner variant="compact" locale="pl" />`.

Use `inherit` when the application owns its theme switch. It selects the configured light/dark palette using the nearest ancestor's CSS `color-scheme`, including live changes and modal dialogs. Set that property in the application's existing theme rules; the package does not infer a scheme from class names or attributes. For a root `.dark` selector:

```css
:root { color-scheme: light; }
:root.dark { color-scheme: dark; }
```

A host using `color-scheme: light dark` delegates the selection to the browser. An unspecified scheme or a browser without CSS `light-dark()` support uses the light palette. No theme JavaScript, preference storage, or consent reset is needed. Refresh/cache-bust published `consent.css` when enabling this mode after a package update.

Both palettes accept selected six-digit HEX keys: `background`, `text`, `muted`, `accent`, `accent_text`, `border`, `control`, and `focus`. Missing/invalid entries inherit their palette's defaults. Light overrides are not transformed into dark colors. Diagnostics preserve chosen colors, check both palettes, and suppress identical warnings for 72 hours through the application's default cache; suppression across requests requires a suitable persistent cache.

## Usage

Use an ordinary button to reopen the native preferences dialog:

```blade
<button type="button" data-consent-open>Cookie preferences</button>
```

Opening preferences grants nothing. The initial banner is a section; preferences use a native modal dialog. Keep equal acceptance/refusal prominence, category purposes, full service descriptions, accessible controls, status/error announcements, focus management, and a readily available reopening action when customizing views. Closing the banner or an unsaved dialog does not record a decision.

Preserve a visible retryable alert after a failed save. Merge the current `save_failed` wording into application-owned dictionaries: an audit failure can leave earlier grants active, so the generic error must not claim that all optional cookies are blocked or assume cookie-storage failure. Keep any attempted selection available for retry without treating it as saved permission.

### Translations

Bundled locales are `en`, `pl`, `de`, `fr`, `it`, `es`, `pt`, `cs` (Czech), and `nl` (Dutch). Null locale follows the application; regional locales such as `cs-CZ`, `nl-NL`, and `nl-BE` fall back to their parent and then English per key. Custom locales can use the same dictionary structure. Partial published overrides inherit remaining keys from the matching bundled dictionary.

With Livewire, set the application locale before rendering and preserve it across update requests. The interface and signed notice change together; explicit component/config locale overrides keep their priority. Read [Livewire](livewire.md) for component updates, navigation and persisted interfaces.

```bash
php artisan vendor:publish --tag=consent-translations
```

Find the published `vendor/consent/<locale>/messages.php` under the application's language path (`lang_path()`), rather than assuming a legacy `resources/lang` location. Copy its shape for new dictionaries. For displayed service overrides, create `services.php` beside it:

```php
return [
    'matomo' => [
        'description' => 'Statystyki odwiedzin i zakupów w naszym sklepie.',
    ],
];
```

An explicit `consent::services` translation overrides displayed service fields. Built-in localized purposes apply when the canonical preset wording remains its default; a custom canonical `name`/`description` is otherwise preserved. UI-only translations do not change the consent fingerprint, but audit snapshots include the actual resolved wording.

### Published Views

```bash
php artisan vendor:publish --tag=consent-views
```

Inspect the bundled version before editing `resources/views/vendor/consent`. Preserve component contracts, data attributes, nonce support, and the banner's audit capture/notice block. For external assets, use the head's `src` and banner's `style-src`/`script-src` props with published URLs; see [custom scripts](custom-scripts.md).

## Verification

Check both variants and relevant light/dark/auto/inherit states, all application languages, longer labels, keyboard opening/Tab/Shift+Tab/Escape, focus return, 320-pixel reflow, and 200% text resizing. Verify contrast for customized palettes in the browser. Automated accessibility checks supplement these observations. If auditing is enabled, verify the stored notice contains the customized translated interface.

## Common Pitfalls

- Changing consent behavior while changing presentation.
- Hiding refusal, withdrawal, category purposes, or service details.
- Replacing bundled modal behavior with a visual overlay lacking keyboard modality.
- Editing signed notice JSON or adding visitor-specific content to cached audit markup.
- Assuming contrast diagnostics establish accessibility of arbitrary host CSS.
