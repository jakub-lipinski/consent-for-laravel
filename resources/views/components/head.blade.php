@props(['nonce' => null, 'src' => null])
@once
<meta name="consent-runtime-context" data-consent-page content="{{ app(\ConsentForLaravel\ConsentForLaravel\BrowserRuntime::class)->context() }}" data-consent-locale="{{ app(\ConsentForLaravel\ConsentForLaravel\BrowserRuntime::class)->locale() }}" />
<script type="application/json" data-consent-config @if($nonce !== null) nonce="{{ $nonce }}" @endif>{!! app(\ConsentForLaravel\ConsentForLaravel\BrowserRuntime::class)->json() !!}</script>
@if($src !== null)
<script src="{{ $src }}" data-consent-runtime data-navigate-track @if($nonce !== null) nonce="{{ $nonce }}" @endif></script>
@else
<script data-consent-runtime @if($nonce !== null) nonce="{{ $nonce }}" @endif>{!! app(\ConsentForLaravel\ConsentForLaravel\BrowserRuntime::class)->source() !!}</script>
@endif
@endonce
