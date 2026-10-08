@props(['nonce' => null, 'locale' => null, 'position' => null, 'policyUrl' => null, 'styleSrc' => null, 'scriptSrc' => null])
@once
@php
    $ui = app(\ConsentForLaravel\ConsentForLaravel\BannerView::class);
    $language = $ui->locale($locale);
    $placement = \ConsentForLaravel\ConsentForLaravel\BannerSettings::position($position ?? $ui->settings->position);
    $policy = \ConsentForLaravel\ConsentForLaravel\BannerSettings::policyUrl($policyUrl ?? $ui->settings->policyUrl);
@endphp
@if($styleSrc !== null)
<link rel="stylesheet" href="{{ $styleSrc }}" />
@else
<style @if($nonce !== null) nonce="{{ $nonce }}" @endif>{!! $ui->styles() !!}</style>
@endif
@if($ui->settings->colors !== \ConsentForLaravel\ConsentForLaravel\BannerSettings::COLORS)
<style @if($nonce !== null) nonce="{{ $nonce }}" @endif>.consent-ui{{ '{' }}{!! $ui->settings->variables() !!}{{ '}' }}</style>
@endif
<div class="consent-ui" data-consent-ui data-consent-position="{{ $placement }}" lang="{{ $language }}" dir="ltr"
     data-message-saving="{{ $ui->text('saving', $language) }}" data-message-saved="{{ $ui->text('saved', $language) }}"
     data-message-changed="{{ $ui->text('changed', $language) }}" data-message-error="{{ $ui->text('save_failed', $language) }}"
     data-message-leave="{{ $ui->text('leave_page', $language) }}">
    <section class="consent-fallback" data-consent-fallback aria-label="{{ $ui->text('preferences_title', $language) }}">
        <p>{{ $ui->text('unavailable', $language) }} @if($policy !== null)<a href="{{ $policy }}">{{ $ui->text('policy_link', $language) }}</a>@endif</p>
    </section>
    <section class="consent-banner" data-consent-banner aria-labelledby="consent-banner-title" hidden>
        <div class="consent-banner__content">
            <div class="consent-heading">
                <h2 id="consent-banner-title">{{ $ui->text('banner_title', $language) }}</h2>
                <button type="button" class="consent-icon-button" data-consent-action="dismiss" aria-label="{{ $ui->text('dismiss', $language) }}"><span aria-hidden="true">&times;</span></button>
            </div>
            <p>{{ $ui->text('banner_description', $language) }}</p>
            @if($ui->advancedGoogle())<p>{{ $ui->text('google_advanced', $language) }}</p>@endif
            @if($policy !== null)<a class="consent-policy" href="{{ $policy }}">{{ $ui->text('policy_link', $language) }}</a>@endif
            <p class="consent-error" role="alert" data-consent-error hidden></p>
        </div>
        <div class="consent-actions">
            <button type="button" class="consent-button consent-button--choice" data-consent-action="accept">{{ $ui->text('accept_all', $language) }}</button>
            <button type="button" class="consent-button consent-button--choice" data-consent-action="reject">{{ $ui->text('reject_optional', $language) }}</button>
            <button type="button" class="consent-button" data-consent-action="open" aria-haspopup="dialog" aria-controls="consent-preferences">{{ $ui->text('customize', $language) }}</button>
        </div>
    </section>
    <dialog id="consent-preferences" class="consent-dialog" data-consent-dialog aria-labelledby="consent-preferences-title" aria-modal="true">
        <form data-consent-form>
            <header class="consent-heading">
                <h2 id="consent-preferences-title" tabindex="-1">{{ $ui->text('preferences_title', $language) }}</h2>
                <button type="button" class="consent-icon-button" data-consent-action="close" aria-label="{{ $ui->text('close', $language) }}"><span aria-hidden="true">&times;</span></button>
            </header>
            <p class="consent-description">{{ $ui->text('preferences_description', $language) }}</p>
            @if($ui->advancedGoogle())<p class="consent-description">{{ $ui->text('google_advanced', $language) }}</p>@endif
            <p class="consent-error" role="alert" data-consent-error hidden></p>
            <fieldset class="consent-categories">
                <legend class="consent-sr-only">{{ $ui->text('categories_label', $language) }}</legend>
                @foreach($ui->services->categories() as $category)
                <div class="consent-category">
                    <div class="consent-category__heading">
                        <label for="consent-category-{{ $category->value }}">{{ $ui->text('categories.'.$category->value.'.title', $language) }}</label>
                        @if($category->value === 'necessary')<span class="consent-category__required">{{ $ui->text('always_active', $language) }}</span>@endif
                        <input id="consent-category-{{ $category->value }}" class="consent-switch" type="checkbox" role="switch"
                               data-consent-category="{{ $category->value }}" aria-describedby="consent-description-{{ $category->value }}"
                               @if($category->value === 'necessary') checked disabled @endif />
                    </div>
                    <p id="consent-description-{{ $category->value }}">{{ $ui->text('categories.'.$category->value.'.description', $language) }}</p>
                    @if($ui->services->forCategory($category) !== [])
                    <ul class="consent-services" aria-label="{{ $ui->text('services_label', $language) }}">
                        @foreach($ui->services->forCategory($category) as $service)
                        <li><strong>{{ $ui->serviceText($service, 'name', $language) }}</strong><span>{{ $ui->serviceText($service, 'description', $language) }}</span></li>
                        @endforeach
                    </ul>
                    @endif
                </div>
                @endforeach
            </fieldset>
            <footer class="consent-dialog__footer">
                @if($policy !== null)<a class="consent-policy" href="{{ $policy }}">{{ $ui->text('policy_link', $language) }}</a>@endif
                <div class="consent-actions">
                    <button type="button" class="consent-button consent-button--choice" data-consent-action="accept">{{ $ui->text('accept_all', $language) }}</button>
                    <button type="button" class="consent-button consent-button--choice" data-consent-action="reject">{{ $ui->text('reject_optional', $language) }}</button>
                    <button type="submit" class="consent-button" data-consent-action="save">{{ $ui->text('save', $language) }}</button>
                </div>
            </footer>
        </form>
    </dialog>
    <button type="button" class="consent-launcher" data-consent-launcher data-consent-action="open" aria-label="{{ $ui->text('reopen', $language) }}" title="{{ $ui->text('reopen', $language) }}" aria-controls="consent-preferences" aria-haspopup="dialog" hidden>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M12 3.25a8.75 8.75 0 1 0 8.75 8.75 3.2 3.2 0 0 1-3.2-3.2 3.2 3.2 0 0 1-3.2-3.2A3.2 3.2 0 0 1 12 3.25Z"/><circle cx="8.25" cy="10" r=".8"/><circle cx="11.25" cy="15.25" r=".8"/><circle cx="7" cy="15" r=".6"/></svg>
    </button>
    <p class="consent-sr-only" role="status" aria-live="polite" aria-atomic="true" data-consent-status></p>
</div>
@if($scriptSrc !== null)
<script src="{{ $scriptSrc }}" @if($nonce !== null) nonce="{{ $nonce }}" @endif></script>
@else
<script @if($nonce !== null) nonce="{{ $nonce }}" @endif>{!! $ui->script() !!}</script>
@endif
@endonce
