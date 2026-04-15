// Astra Deck - MAIN World Bridge
// Handles canPlayType + MediaSource.isTypeSupported patching for codec filtering
// Runs in world: "MAIN" at document_start
// Communicates with ISOLATED world via data attributes on <html>
(function() {
    'use strict';

    var _origCanPlay = HTMLVideoElement.prototype.canPlayType;
    var _origIsTypeSupported = MediaSource && MediaSource.isTypeSupported
        ? MediaSource.isTypeSupported.bind(MediaSource) : null;
    var _origDecodingInfo = (typeof MediaCapabilities !== 'undefined' && MediaCapabilities.prototype.decodingInfo)
        ? MediaCapabilities.prototype.decodingInfo : null;
    var _codec = 'auto';
    var _patched = false;

    function shouldBlock(type) {
        if (_codec === 'h264' && /vp0?9|av01/i.test(type)) return true;
        if (_codec === 'vp9') {
            if (/av01/i.test(type)) return true;
            if (/avc1/i.test(type) && !/vp0?9/i.test(type)) return true;
        }
        if (_codec === 'av1') {
            if ((/vp0?9|avc1/i.test(type)) && !/av01/i.test(type)) return true;
        }
        return false;
    }

    function sync() {
        if (_codec === 'auto') {
            if (_patched) {
                HTMLVideoElement.prototype.canPlayType = _origCanPlay;
                if (_origIsTypeSupported) MediaSource.isTypeSupported = _origIsTypeSupported;
                if (_origDecodingInfo) MediaCapabilities.prototype.decodingInfo = _origDecodingInfo;
                _patched = false;
            }
            return;
        }
        HTMLVideoElement.prototype.canPlayType = function(type) {
            if (shouldBlock(type)) return '';
            return _origCanPlay.call(this, type);
        };
        if (_origIsTypeSupported) {
            MediaSource.isTypeSupported = function(type) {
                if (shouldBlock(type)) return false;
                return _origIsTypeSupported(type);
            };
        }
        // YouTube also queries MediaCapabilities.decodingInfo to select codecs.
        // Without this override, YouTube can bypass canPlayType/isTypeSupported.
        if (_origDecodingInfo) {
            MediaCapabilities.prototype.decodingInfo = function(config) {
                var contentType = config && config.video && config.video.contentType;
                if (contentType && shouldBlock(contentType)) {
                    return Promise.resolve({ supported: false, smooth: false, powerEfficient: false });
                }
                return _origDecodingInfo.call(this, config);
            };
        }
        _patched = true;
    }

    new MutationObserver(function() {
        var val = document.documentElement.getAttribute('data-ytkit-codec');
        if (val !== null && val !== _codec) {
            _codec = val || 'auto';
            sync();
        }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-ytkit-codec'] });

    var initial = document.documentElement.getAttribute('data-ytkit-codec');
    if (initial) { _codec = initial; sync(); }
})();
