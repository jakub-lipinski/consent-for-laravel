@props(['nonce' => null, 'src' => null])
@once
<script type="application/json" data-consent-config @if($nonce !== null) nonce="{{ $nonce }}" @endif>{!! app(\ConsentForLaravel\ConsentForLaravel\BrowserRuntime::class)->json() !!}</script>
@if($src !== null)
<script src="{{ $src }}" data-consent-runtime @if($nonce !== null) nonce="{{ $nonce }}" @endif></script>
@else
<script data-consent-runtime @if($nonce !== null) nonce="{{ $nonce }}" @endif>{!! app(\ConsentForLaravel\ConsentForLaravel\BrowserRuntime::class)->source() !!}</script>
@endif
@endonce
