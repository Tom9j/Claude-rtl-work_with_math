// ==UserScript==
// @name         Claude RTL (Web)
// @namespace    https://github.com/Tom9j/Claude-rtl-work_with_math
// @version      2026.05.27.21
// @description  Smart RTL/bidi + Hebrew typography for claude.ai (math 1.3em — confidently larger than text)
// @author       Tom9j
// @match        https://claude.ai/*
// @match        https://*.claude.ai/*
// @run-at       document-start
// @grant        none
// @noframes
// @updateURL    https://raw.githubusercontent.com/Tom9j/Claude-rtl-work_with_math/main/claude-rtl.user.js
// @downloadURL  https://raw.githubusercontent.com/Tom9j/Claude-rtl-work_with_math/main/claude-rtl.user.js
// @supportURL   https://github.com/Tom9j/Claude-rtl-work_with_math/issues
// @homepageURL  https://github.com/Tom9j/Claude-rtl-work_with_math
// @connect      fonts.googleapis.com
// @connect      fonts.gstatic.com
// ==/UserScript==
// --- CLAUDE RTL PATCH START ---
;(function() {
    'use strict';
    if (typeof document === 'undefined') return;
    try {
        var WRITING_SEL = '[data-testid="chat-input"]';
        // Math containers (KaTeX, MathJax v2/v3, raw MathML). These have their own
        // internal LTR layout — if a parent paragraph is RTL, numbers/operators
        // flip and fraction bars reverse. We isolate them entirely.
        var MATH_SEL = '.katex, .katex-display, .katex-mathml, .katex-html, mjx-container, .MathJax, .MathJax_Display, math, mjx-math';

        function isRTL(c) {
            var code = c.charCodeAt(0);
            return (code >= 0x0590 && code <= 0x05FF) ||
                   (code >= 0x0600 && code <= 0x06FF) ||
                   (code >= 0x0750 && code <= 0x077F) ||
                   (code >= 0x08A0 && code <= 0x08FF);
        }

        function hasRTL(text) {
            if (!text) return false;
            for (var i = 0; i < text.length; i++) { if (isRTL(text[i])) return true; }
            return false;
        }

        // First strong character direction in a string
        function firstStrong(text) {
            if (!text) return null;
            for (var i = 0; i < text.length; i++) {
                if (isRTL(text[i])) return 'rtl';
                if (/[a-zA-Z]/.test(text[i])) return 'ltr';
            }
            return null;
        }

        // Get text from element excluding <code> children (DOM-aware)
        function textWithoutCode(el) {
            var out = '';
            var nodes = el.childNodes;
            for (var i = 0; i < nodes.length; i++) {
                var n = nodes[i];
                if (n.nodeType === 3) { out += n.textContent; }
                else if (n.nodeType === 1 && n.tagName !== 'CODE' && n.tagName !== 'PRE'
                         && !(n.matches && n.matches(MATH_SEL))) {
                    out += textWithoutCode(n);
                }
            }
            return out;
        }

        // Strip leading LTR-only patterns from plain text
        // Removes: filenames (x.js), URLs, paths (a/b/c), backtick-code
        function stripLeadingLTR(text) {
            return text
                .replace(/^[\s]*(?:[\w.\-]+\.[\w]{1,5})\s*/g, '')
                .replace(/https?:\/\/\S+/g, '')
                .replace(/[\w.\-]+[\/\\][\w.\-\/\\]+/g, '')
                .replace(/`[^`]+`/g, '');
        }

        // --- PER-LINE DIRECTIONAL SPLITTING ---
        //
        // A paragraph rendered with <br> separators or whitespace-pre may carry
        // multiple lines, each in a different script. Forcing a single dir on the
        // host element mangles every line that disagrees. We instead wrap each
        // line in its own dir-tagged span and stamp data-rtl-split on the host so
        // subsequent passes recognize it as already handled.

        var RTL_SPLIT_FLAG = 'data-rtl-split';
        var BR_OR_NL_SPLIT = /(<br\s*\/?>|\n)/i;

        function hasMultiScriptLines(el) {
            var src = el.textContent;
            if (!src) return false;
            if (!/[a-zA-Z]{2,}/.test(src)) return false;
            if (!hasRTL(src)) return false;
            // A break must appear in markup or in the rendered text.
            return BR_OR_NL_SPLIT.test(el.innerHTML) || src.indexOf('\n') !== -1;
        }

        function splitToDirectionalSpans(el) {
            if (el.hasAttribute(RTL_SPLIT_FLAG)) return;
            // No DOM rewriting — the previous version assigned to el.innerHTML which
            // broke React reconciliation ("Failed to execute 'removeChild' on 'Node'":
            // React tried to remove children whose identity we had just replaced).
            //
            // Instead, defer to unicode-bidi:plaintext. The CSS injected below already
            // applies plaintext to :not([dir]) elements, and <br> is a paragraph
            // separator in the Unicode BiDi algorithm — so each line auto-picks its
            // direction from first-strong character without us touching the DOM.
            // We mark the flag so processContainers won't try to handle the subtree.
            el.setAttribute(RTL_SPLIT_FLAG, '1');
            if (el.hasAttribute('dir')) el.removeAttribute('dir');
            el.style.direction = '';
            el.style.textAlign = 'start';
            el.style.unicodeBidi = 'plaintext';
        }

        // Used by the no-RTL branches below: if the element inherits RTL purely
        // via CSS class on a parent (rather than an explicit dir attribute on
        // itself), removing dir alone won't free it — we must pin direction=ltr.
        function resetDirOrPinLTR(el) {
            if (window.getComputedStyle(el).direction === 'rtl') {
                el.dir = 'ltr';
                el.style.direction = 'ltr';
                return;
            }
            if (el.hasAttribute('dir')) el.removeAttribute('dir');
            el.style.direction = '';
        }

        // --- HYBRID DIRECTION DETECTION ---

        // For DOM elements (output): 3-layer detection
        function detectElDir(el) {
            var full = el.textContent || '';
            if (!hasRTL(full)) return null;

            // Layer 1: first-strong on text excluding <code> children
            var noCode = textWithoutCode(el);
            var d = firstStrong(noCode);
            if (d === 'rtl') return 'rtl';

            // Layer 2: strip leading filenames/URLs, then first-strong
            var stripped = stripLeadingLTR(noCode);
            d = firstStrong(stripped);
            if (d === 'rtl') return 'rtl';

            // Layer 3: there ARE RTL chars (we checked above) but they hide
            // behind code/filenames. Since RTL exists, treat as RTL.
            return 'rtl';
        }

        // For plain text (input box, dialogs without DOM structure)
        function detectTextDir(text) {
            if (!text || !text.trim()) return null;
            var d = firstStrong(text);
            if (d === 'rtl') return 'rtl';
            if (!hasRTL(text)) return 'ltr';

            // Has RTL but first-strong is LTR — strip patterns and retry
            var stripped = stripLeadingLTR(text);
            d = firstStrong(stripped);
            if (d === 'rtl') return 'rtl';

            // RTL chars exist somewhere → RTL
            return 'rtl';
        }

        // --- ELEMENT PROCESSING ---

        // querySelectorAll that INCLUDES root itself if it matches
        function qsa(root, sel) {
            var base = root.querySelectorAll ? root : document;
            var els = Array.from(base.querySelectorAll(sel));
            if (root.matches && root.matches(sel)) els.unshift(root);
            return els;
        }

        function forceCodeLTR(root) {
            qsa(root, 'pre, .code-block__code, .relative.group\\/copy').forEach(function(b) {
                b.dir = 'ltr'; b.style.textAlign = 'left'; b.style.unicodeBidi = 'embed';
            });
            qsa(root, 'code').forEach(function(c) {
                if (!c.closest('pre') && !c.closest('.code-block__code')) c.dir = 'ltr';
            });
        }

        function forceMathLTR(root) {
            qsa(root, MATH_SEL).forEach(function(m) {
                m.dir = 'ltr';
                m.style.setProperty('direction', 'ltr', 'important');
                m.style.setProperty('unicode-bidi', 'isolate', 'important');
                // Do NOT force textAlign here: display math centers via CSS,
                // inline math has no text-align semantics. Forcing 'left' here
                // beat the CSS centering rule and made block equations stick
                // to the left edge inside RTL paragraphs.

                // CRITICAL — stamp inline direction AND unicode-bidi on every
                // descendant. Both are needed:
                //
                //   - direction:ltr stops descendants from inheriting RTL from
                //     the surrounding Hebrew paragraph.
                //   - unicode-bidi:isolate overrides our own '[dir]>* { unicode-
                //     bidi: plaintext }' cascade rule, which would otherwise
                //     pick the .base paragraph direction from the FIRST STRONG
                //     character. In a base containing Hebrew \text{...} content
                //     (e.g. "1 \quad כאשר k=") the first strong char is the
                //     Hebrew letter, so plaintext picks RTL and the entire .base
                //     reorders right-to-left even when its direction is ltr.
                //     isolate forces the paragraph base direction to follow the
                //     `direction` property regardless of content.
                //
                // setProperty(..., 'important') beats any non-inline !important
                // and is robust even when our injected stylesheet is missing,
                // corrupted, or out-of-order.
                var kids = m.querySelectorAll('*');
                for (var i = 0; i < kids.length; i++) {
                    kids[i].style.setProperty('direction', 'ltr', 'important');
                    kids[i].style.setProperty('unicode-bidi', 'isolate', 'important');
                }
            });
        }

        // --- INLINE BIDI ISOLATION FOR MATH-LIKE TEXT IN RTL CONTEXT ---
        //
        // The browser's Unicode BiDi Algorithm correctly handles plain English in
        // Hebrew paragraphs, but "neutral" characters (parens, < > = + - · etc.)
        // attach to the SURROUNDING strong direction. Inside an RTL paragraph this
        // means an expression like `(j < n)` or `n - 1` or `P(k+1)` gets its
        // brackets / operators dragged to the RTL level, reordering the run.
        //
        // The fix: wrap each LTR math-ish run in invisible Unicode bidi-isolates
        // (U+2066 LRI ... U+2069 PDI). The browser then treats the wrapped run
        // as a single LTR bidi unit, with all internal ordering preserved.
        //
        // We only touch text nodes inside elements whose nearest [dir] ancestor
        // is RTL — LTR paragraphs are already fine. We never touch math/code/input.
        // We mutate node.nodeValue in place (NOT innerHTML), so React's child
        // identity is preserved — same Text node, just different content. The
        // idempotency check (already contains LRI) keeps the MutationObserver
        // from looping.
        var LRI = '⁦';  // LEFT-TO-RIGHT ISOLATE
        var PDI = '⁩';  // POP DIRECTIONAL ISOLATE
        // Run = letter/digit/open-bracket .. letter/digit/close-bracket, with
        // operator chars allowed in between. Tightened to require start/end on
        // an "anchor" char so we don't grab trailing punctuation like ". ".
        var MATH_TEXT_RUN = /[A-Za-z0-9(\[{][A-Za-z0-9 \t+\-*\/=<>(){}\[\]≤≥≠·^_.,'`]*[A-Za-z0-9)\]}]/g;
        // Operator-only trigger — must contain a real math/comparison operator
        // for wrapping to make sense. Bare brackets/parens are NOT enough: a code
        // span like `succ` followed by a sentence-closing `)` would otherwise get
        // wrapped, which pulls the close paren into an LTR isolate. The open
        // paren (still in the surrounding Hebrew text node) stays at RTL level
        // and gets mirrored to a `)`-glyph — so the user sees two `)`-glyphs
        // bracketing the parenthetical. Requiring an actual operator restricts
        // wrapping to true math/expression patterns and lets natural Hebrew
        // paren mirroring keep its symmetric `(...)` shape.
        var BIDI_TRIGGER = /[<>=+\-*\/≤≥≠·]/;

        function bidiIsolateMathInTextNodes(root) {
            if (!root || !root.nodeType) return;
            var startEl = (root.nodeType === 1) ? root : root.parentElement;
            if (!startEl || !startEl.querySelectorAll) return;

            var walker = document.createTreeWalker(startEl, NodeFilter.SHOW_TEXT, {
                acceptNode: function(node) {
                    var p = node.parentElement;
                    if (!p) return NodeFilter.FILTER_REJECT;
                    // CRITICAL: never touch non-rendered text containers.
                    // <style> in particular: if <html dir="rtl"> (Claude does this
                    // for Hebrew locale), the walker would descend into our own
                    // <style id="claude-rtl-styles"> and wrap CSS selectors like
                    // ".katex *" with U+2066/U+2069. The browser then rejects the
                    // rules as invalid, our math-protection CSS never loads, and
                    // every formula collapses back to RTL.
                    var tag = p.tagName;
                    if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'NOSCRIPT' ||
                        tag === 'TEMPLATE' || tag === 'HEAD' || tag === 'TITLE') {
                        return NodeFilter.FILTER_REJECT;
                    }
                    if (p.closest('pre') || p.closest('code')) return NodeFilter.FILTER_REJECT;
                    if (p.closest(WRITING_SEL)) return NodeFilter.FILTER_REJECT;
                    if (p.closest(MATH_SEL)) return NodeFilter.FILTER_REJECT;
                    if (p.closest('style, script, noscript, template, head')) return NodeFilter.FILTER_REJECT;
                    var t = node.nodeValue;
                    if (!t || t.length < 3) return NodeFilter.FILTER_REJECT;
                    if (t.indexOf(LRI) !== -1) return NodeFilter.FILTER_REJECT; // idempotent
                    if (!BIDI_TRIGGER.test(t)) return NodeFilter.FILTER_REJECT;
                    if (!/[A-Za-z0-9]/.test(t)) return NodeFilter.FILTER_REJECT;
                    // Only need isolation when the surrounding flow is RTL.
                    var rtlAncestor = p.closest('[dir="rtl"]');
                    if (!rtlAncestor) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                }
            });
            var nodes = [];
            var n;
            while ((n = walker.nextNode()) !== null) nodes.push(n);
            for (var i = 0; i < nodes.length; i++) {
                var node = nodes[i];
                var text = node.nodeValue;
                var changed = false;
                var wrapped = text.replace(MATH_TEXT_RUN, function(match) {
                    if (!BIDI_TRIGGER.test(match)) return match;
                    changed = true;
                    return LRI + match + PDI;
                });
                if (changed) {
                    try { node.nodeValue = wrapped; } catch(e) {}
                }
            }
        }

        function processText(root) {
            // Standard text elements
            qsa(root, 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, summary, label, dt, dd').forEach(function(el) {
                if (el.closest(WRITING_SEL) || el.closest('pre') || el.closest('.code-block__code')) return;
                if (el.closest(MATH_SEL)) return;
                if (el.hasAttribute(RTL_SPLIT_FLAG)) return;
                var dir = detectElDir(el);
                if (dir) {
                    // RTL paragraphs with internal line breaks need per-line
                    // treatment — otherwise a single English line buried in
                    // Hebrew text inherits the wrong direction.
                    if (dir === 'rtl' && hasMultiScriptLines(el)) {
                        splitToDirectionalSpans(el);
                        return;
                    }
                    el.dir = dir;
                    el.style.direction = dir;
                    if (el.tagName === 'LI') {
                        el.style.listStylePosition = (dir === 'rtl') ? 'inside' : '';
                        // Propagate RTL to parent list immediately to fix bullet position
                        var parentList = el.closest('ul, ol');
                        if (parentList && dir === 'rtl' && !parentList.hasAttribute('dir')) {
                            parentList.dir = 'rtl';
                            parentList.style.direction = 'rtl';
                            var pl = getComputedStyle(parentList).paddingLeft;
                            if (parseFloat(pl) > 0) { parentList.style.paddingRight = pl; parentList.style.paddingLeft = '0'; }
                        }
                    }
                } else {
                    resetDirOrPinLTR(el);
                    if (el.tagName === 'LI') el.style.listStylePosition = '';
                }
            });

            // Lists
            qsa(root, 'ul, ol').forEach(function(el) {
                if (el.closest(WRITING_SEL) || el.closest('pre')) return;
                if (el.closest(MATH_SEL)) return;
                var dir = detectElDir(el);
                if (dir === 'rtl') {
                    el.dir = 'rtl';
                    el.style.direction = 'rtl';
                    var pl = getComputedStyle(el).paddingLeft;
                    if (parseFloat(pl) > 0) { el.style.paddingRight = pl; el.style.paddingLeft = '0'; }
                } else {
                    resetDirOrPinLTR(el);
                    el.style.paddingRight = ''; el.style.paddingLeft = '';
                }
            });
        }

        // Universal: process ANY leaf text container (catches dialogs, tooltips, etc.)
        function processContainers(root) {
            qsa(root, 'div, span, button, a, label').forEach(function(el) {
                if (el.closest('pre') || el.closest('code') || el.closest(WRITING_SEL)) return;
                if (el.closest(MATH_SEL)) return;
                // Bail if we (or our wrapping host) already converted this subtree into per-line spans.
                if (el.hasAttribute(RTL_SPLIT_FLAG)) return;
                var parent = el.parentElement;
                if (parent && parent.hasAttribute(RTL_SPLIT_FLAG)) return;
                // Skip if has block children (not a leaf)
                if (el.querySelector('p, div, ul, ol, h1, h2, h3, h4, h5, h6, pre, table')) return;
                // Skip elements already handled by processText
                if (/^(P|LI|H[1-6]|BLOCKQUOTE|TD|TH|UL|OL)$/.test(el.tagName)) return;
                var text = (el.textContent || '').trim();
                if (text.length < 2) return;
                if (hasRTL(text)) {
                    if (hasMultiScriptLines(el)) {
                        splitToDirectionalSpans(el);
                    } else {
                        el.dir = detectTextDir(text) || 'rtl';
                        el.style.textAlign = 'start';
                    }
                } else if (el.hasAttribute('dir')) {
                    el.removeAttribute('dir');
                    el.style.textAlign = '';
                }
            });
        }

        function processInput() {
            document.querySelectorAll(WRITING_SEL).forEach(function(input) {
                var text = input.textContent || input.innerText || '';
                var dir = detectTextDir(text);
                if (dir === 'rtl') {
                    input.style.direction = 'rtl'; input.style.textAlign = 'right'; input.style.paddingRight = '25px';
                } else {
                    input.style.direction = 'ltr'; input.style.textAlign = 'left'; input.style.paddingRight = '';
                }
            });
        }

        function processAll() {
            processText(document);
            processContainers(document.body);
            processInput();
            forceCodeLTR(document.body);
            forceMathLTR(document.body);
            // Must run AFTER processText/processContainers — those set dir="rtl"
            // on elements, which the bidi-isolate walker uses to identify scope.
            bidiIsolateMathInTextNodes(document.body);
        }

        // Load Noto Sans Hebrew + Inter from Google Fonts via a <link> in <head>.
        // This pair mirrors the typographic system Google uses across Gemini /
        // Android / Maps (Google Sans for English, Noto Sans Hebrew for Hebrew).
        // Google Sans isn't free; Inter is the closest open-source match.
        // Using <link> instead of @import keeps the font fetch non-blocking;
        // if CSP blocks it, the cascade falls back to system fonts silently.
        function injectFont() {
            if (document.getElementById('claude-rtl-font')) return;
            // preconnect so the .woff2 fetch starts the moment the stylesheet parses.
            var pc1 = document.createElement('link');
            pc1.rel = 'preconnect';
            pc1.href = 'https://fonts.googleapis.com';
            document.head.appendChild(pc1);
            var pc2 = document.createElement('link');
            pc2.rel = 'preconnect';
            pc2.href = 'https://fonts.gstatic.com';
            pc2.crossOrigin = 'anonymous';
            document.head.appendChild(pc2);
            var link = document.createElement('link');
            link.id = 'claude-rtl-font';
            link.rel = 'stylesheet';
            link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Hebrew:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap';
            document.head.appendChild(link);
        }

        function injectStyles() {
            if (document.getElementById('claude-rtl-styles')) return;
            var s = document.createElement('style');
            s.id = 'claude-rtl-styles';
            s.textContent = [
                'p:not([dir]),li:not([dir]),h1:not([dir]),h2:not([dir]),h3:not([dir]),h4:not([dir]),h5:not([dir]),h6:not([dir]),blockquote:not([dir]),td:not([dir]),th:not([dir]),summary:not([dir]),label:not([dir]),legend:not([dir]),dt:not([dir]),dd:not([dir]),figcaption:not([dir]),caption:not([dir]){unicode-bidi:plaintext!important;text-align:start!important}',
                'pre,.code-block__code,.relative.group\\/copy{unicode-bidi:embed!important;direction:ltr!important;text-align:left!important}',
                'code{unicode-bidi:isolate!important;direction:ltr!important}',
                // --- MATH (KaTeX / MathJax / MathML) ---
                // Outer math container: isolated bidi unit relative to surrounding text.
                '.katex,.katex-display,mjx-container,.MathJax,.MathJax_Display,math,mjx-math{unicode-bidi:isolate!important;direction:ltr!important}',
                // CRITICAL — force direction:ltr on EVERY descendant of a math
                // container. KaTeX splits binary operators across multiple
                // `<span class="base">` inline-blocks; if any of them inherit
                // direction:rtl from the surrounding Hebrew paragraph, the bases
                // flow right-to-left and the whole formula reverses
                // (e.g. `m = k + 1` becomes `1 + k = m`, `n - 1` becomes `1n -`).
                // Belt-and-suspenders: also stamp the descendants under an explicit
                // [dir="rtl"] ancestor with extra specificity, to outrank any rule
                // that might cascade RTL onto math internals.
                '.katex,.katex *,.katex-display,.katex-display *,mjx-container,mjx-container *,.MathJax,.MathJax *,math,math *{direction:ltr!important}',
                '[dir="rtl"] .katex,[dir="rtl"] .katex *,[dir="rtl"] .katex-display,[dir="rtl"] .katex-display *,[dir="rtl"] mjx-container,[dir="rtl"] mjx-container *,[dir="rtl"] .MathJax,[dir="rtl"] .MathJax *,[dir="rtl"] math,[dir="rtl"] math *{direction:ltr!important;unicode-bidi:isolate!important}',
                // Inline math: keep on the surrounding text's baseline (KaTeX's
                // internal .strut element handles ascender/descender clearance).
                // We had vertical-align:middle here previously to compensate for
                // Hebrew x-height, but with Noto Sans Hebrew it pushed single-
                // glyph math (e.g. \mathbb{N}) visibly below the line. baseline
                // is what KaTeX is designed against and renders cleanly.
                '.katex:not(.katex-display),mjx-container:not([display="true"]){display:inline-block!important;vertical-align:baseline!important;white-space:nowrap!important}',
                // Display math: own line, centered, breathing room. overflow-x:auto
                // so a wide equation scrolls horizontally instead of bleeding into
                // the sidebar or being clipped.
                '.katex-display,.MathJax_Display,mjx-container[display="true"]{display:block!important;text-align:center!important;margin:1em 0!important;overflow-x:auto;overflow-y:hidden;max-width:100%}',
                // Belt-and-suspenders: even when the parent is dir=rtl, the display
                // math container itself must stay LTR and centered.
                '[dir="rtl"] .katex-display,[dir="rtl"] mjx-container[display="true"]{direction:ltr!important;text-align:center!important}',
                // Inline math sitting inside an RTL line of Hebrew: a tiny lateral
                // margin keeps it from kissing the Hebrew letters on either side.
                '[dir="rtl"] .katex:not(.katex-display),[dir="rtl"] mjx-container:not([display="true"]){margin:0 .15em}',
                '[dir]{text-align:start!important}[dir="rtl"]{direction:rtl!important}[dir="ltr"]{direction:ltr!important}',
                '[dir]>*:not([dir]):not(pre):not(code):not(.code-block__code):not(.katex):not(.katex-display):not(mjx-container):not(.MathJax):not(math){unicode-bidi:plaintext;text-align:start}',
                // RTL: flip sidebar truncation gradient to fade the LEFT edge
                // (Tailwind classes like [mask-image:linear-gradient(to_right,...)] cut off
                // the start of Hebrew text instead of the end — see issue #7).
                '[dir="rtl"][class*="mask-image:linear-gradient(to_right"]{-webkit-mask-image:linear-gradient(to left,hsl(var(--always-black)) 85%,transparent 99%)!important;mask-image:linear-gradient(to left,hsl(var(--always-black)) 85%,transparent 99%)!important}',
                '.group:hover [dir="rtl"][class*="mask-image:linear-gradient(to_right"],.group:focus-within [dir="rtl"][class*="mask-image:linear-gradient(to_right"],[data-menu-open="true"] [dir="rtl"][class*="mask-image:linear-gradient(to_right"]{-webkit-mask-image:linear-gradient(to left,hsl(var(--always-black)) 60%,transparent 78%)!important;mask-image:linear-gradient(to left,hsl(var(--always-black)) 60%,transparent 78%)!important}',
                // --- HEBREW TYPOGRAPHY (Gemini-style) ---
                // Pair Noto Sans Hebrew (Google's official Hebrew face — used in
                // Android, Maps, Gemini, etc.) with Inter for any embedded Latin.
                // Inter is the closest open-source match to Google Sans, which is
                // proprietary. Together these mimic Gemini's reading experience:
                // clean rounded letterforms, generous-but-not-excessive line-height,
                // zero tracking.
                //
                // Selector matches BOTH descendant-of-[dir="rtl"] and elements
                // that have dir="rtl" stamped on themselves (table cells set by
                // Claude, headings set by processText, etc.).
                'p[dir="rtl"],li[dir="rtl"],h1[dir="rtl"],h2[dir="rtl"],h3[dir="rtl"],h4[dir="rtl"],h5[dir="rtl"],h6[dir="rtl"],blockquote[dir="rtl"],td[dir="rtl"],th[dir="rtl"],summary[dir="rtl"],label[dir="rtl"],dt[dir="rtl"],dd[dir="rtl"],[dir="rtl"] p,[dir="rtl"] li,[dir="rtl"] h1,[dir="rtl"] h2,[dir="rtl"] h3,[dir="rtl"] h4,[dir="rtl"] h5,[dir="rtl"] h6,[dir="rtl"] blockquote,[dir="rtl"] td,[dir="rtl"] th,[dir="rtl"] summary,[dir="rtl"] label,[dir="rtl"] dt,[dir="rtl"] dd,[data-rtl-split="1"]{font-family:"Noto Sans Hebrew","Inter","Heebo","Assistant","Segoe UI","Arial Hebrew","David",system-ui,sans-serif!important;font-size:1.0625em;line-height:1.65;letter-spacing:0;font-feature-settings:"kern" 1,"liga" 1,"calt" 1}',
                // Code and math inside RTL containers keep their own fonts.
                '[dir="rtl"] code,[dir="rtl"] pre,[dir="rtl"] pre *,[dir="rtl"] .code-block__code,[dir="rtl"] .code-block__code *,[dir="rtl"] .katex,[dir="rtl"] .katex *,[dir="rtl"] mjx-container,[dir="rtl"] mjx-container *,[data-rtl-split="1"] code,[data-rtl-split="1"] pre,[data-rtl-split="1"] pre *,[data-rtl-split="1"] .code-block__code,[data-rtl-split="1"] .code-block__code *,[data-rtl-split="1"] .katex,[data-rtl-split="1"] .katex *,[data-rtl-split="1"] mjx-container,[data-rtl-split="1"] mjx-container *,td[dir="rtl"] code,td[dir="rtl"] .katex,td[dir="rtl"] .katex *,th[dir="rtl"] code,th[dir="rtl"] .katex,th[dir="rtl"] .katex *{font-family:revert!important;font-size:revert!important;line-height:revert!important;letter-spacing:normal!important;font-feature-settings:revert!important}',
                // --- MATH SIZING ---
                // KaTeX's natural inline .katex font-size is 1.21em. We previously
                // dropped it to 1.1em which made math feel small next to the
                // slightly enlarged Hebrew body text (1.0625em). Bump to 1.3em so
                // formulas read as confidently bigger than the surrounding text —
                // matching Claude's stock visual weight, or a touch larger.
                '.katex{font-size:1.3em!important}',
                '.katex-display{font-size:1.5em!important}',
                '.katex-display .katex{font-size:1em!important}',
                // --- INLINE LARGE OPERATORS (sum, int, prod) ---
                // Bigger sigma/integral/product. KaTeX's default for .op-symbol
                // .small-op is 1.2em; we push to 1.6em so the operator is
                // dominant inside the line, like Gemini's MathJax.
                '.katex:not(.katex-display) .mop > .op-symbol.small-op{font-size:1.6em!important}',
                // --- UNDERBRACE / OVERBRACE WITH HEBREW LABELS ---
                // KaTeX positions the label with absolute top offsets calibrated
                // for KaTeX_Main text-mode metrics. Hebrew falls back to Noto Sans
                // Hebrew (taller glyphs) and crashes upward into the brace.
                //
                // \underbrace{X}_{label} is rendered as TWO nested .mord.munder:
                //   OUTER: contains the label and the inner munder wrapper
                //   INNER: contains the brace SVG (.svg-align) and the content X
                //
                // To shift only the OUTER label we must exclude both the brace
                // SVG (.svg-align) and any "last-child" (which is content/wrapper).
                // That isolates the label span (no class, first child) and pushes
                // it ~0.7em down. Overbrace is the mirror.
                '.katex .mord.munder > .vlist-t > .vlist-r:first-child > .vlist > span:not(.svg-align):not(:last-child){transform:translateY(.7em)!important}',
                '.katex .mord.mover > .vlist-t > .vlist-r:first-child > .vlist > span:not(.svg-align):not(:first-child){transform:translateY(-.7em)!important}',
                // KaTeX reserves vertical space for the full \underbrace assembly
                // through three independent mechanisms: the strut, the .base
                // inline-block, and the .mord.munder inline-block (whose stacked
                // vlists need 1.848em). Cap all three at normal text height so
                // the math doesn't dictate the line-box height.
                // Cap every container in the math chain (.katex, .katex-html,
                // .base, .mord.munder, .mord.mover) at 1em with overflow:visible.
                // Earlier we only capped the inner three — but .katex itself
                // (the outermost inline-block) had no cap and its intrinsic
                // height still leaked into the line box. Also explicitly hide
                // KaTeX's "spacer" vlist-r — the second vlist-r in a munder/mover
                // that reserves vertical room for the label-depth-reservation;
                // we already nudge the label visually with translateY, so the
                // reserved space is dead weight that inflates the line.
                '.katex:not(.katex-display){line-height:1!important;vertical-align:baseline!important;max-height:1.2em!important;overflow:visible}',
                '.katex:not(.katex-display) .katex-html{max-height:1em!important;overflow:visible!important;line-height:1!important}',
                '.katex:not(.katex-display) .base{max-height:1em!important;overflow:visible;vertical-align:baseline!important}',
                '.katex:not(.katex-display) .base > .strut{height:1em!important;vertical-align:-.25em!important}',
                '.katex:not(.katex-display) .mord.munder,.katex:not(.katex-display) .mord.mover{max-height:1em!important;overflow:visible!important;vertical-align:baseline!important}',
                '.katex:not(.katex-display) .mord.munder > .vlist-t > .vlist-r:nth-of-type(2),.katex:not(.katex-display) .mord.mover > .vlist-t > .vlist-r:nth-of-type(2){display:none!important}',
                // Surrounding Hebrew text on the math line still claimed line-
                // height 1.65 (=28px) around what is now a 20px math box. That
                // gave a one-Hebrew-line-tall gap. Drop the line-height to 1.3
                // for paragraphs containing tall math so the line hugs the math.
                '[dir="rtl"] p:has(.katex .mord.munder),[dir="rtl"] p:has(.katex .mord.mover),[dir="rtl"] li:has(.katex .mord.munder),[dir="rtl"] li:has(.katex .mord.mover),[data-rtl-split="1"]:has(.katex .mord.munder),[data-rtl-split="1"]:has(.katex .mord.mover),p[dir="rtl"]:has(.katex .mord.munder),p[dir="rtl"]:has(.katex .mord.mover),li[dir="rtl"]:has(.katex .mord.munder),li[dir="rtl"]:has(.katex .mord.mover){line-height:1.3!important}'
            ].join('');
            document.head.appendChild(s);
        }

        function init() {
            injectFont();
            injectStyles();
            processAll();

            // Input box live direction switching
            document.addEventListener('input', function(e) {
                var t = e.target;
                if (!t || !(t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
                var text = t.textContent || t.innerText || t.value || '';
                var dir = detectTextDir(text);
                if (dir === 'rtl') {
                    t.style.direction = 'rtl'; t.style.textAlign = 'right'; t.style.paddingRight = '25px';
                } else {
                    t.style.direction = 'ltr'; t.style.textAlign = 'left'; t.style.paddingRight = '';
                }
            }, true);

            // Watch DOM changes (throttle, not debounce — process DURING streaming)
            var pendingMuts = [];
            var obs = new MutationObserver(function(muts) {
                var dominated = false;
                for (var i = 0; i < muts.length; i++) {
                    if (muts[i].addedNodes.length > 0 || muts[i].type === 'characterData') { dominated = true; break; }
                }
                if (!dominated) return;
                for (var j = 0; j < muts.length; j++) pendingMuts.push(muts[j]);
                if (window._rtlT) return; // throttle: already scheduled
                window._rtlT = setTimeout(function() {
                    window._rtlT = null;
                    var toProcess = pendingMuts;
                    pendingMuts = [];
                    var roots = new Set();
                    toProcess.forEach(function(m) {
                        m.addedNodes.forEach(function(n) { if (n.nodeType === 1) roots.add(n); });
                        if (m.type === 'characterData' && m.target.parentElement) roots.add(m.target.parentElement);
                    });
                    // Expand roots to include ancestor text/list elements
                    var expanded = new Set(roots);
                    roots.forEach(function(r) {
                        if (!r.closest) return;
                        var txt = r.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, summary, label, dt, dd');
                        if (txt) expanded.add(txt);
                        var list = r.closest('ul, ol');
                        if (list) expanded.add(list);
                    });
                    roots = expanded;
                    if (roots.size > 0 && roots.size <= 30) {
                        roots.forEach(function(r) {
                            processText(r);
                            processContainers(r);
                            forceCodeLTR(r);
                            forceMathLTR(r);
                            bidiIsolateMathInTextNodes(r);
                        });
                        processInput();
                    } else {
                        processAll();
                    }
                }, 50);
            });
            obs.observe(document.body, { childList: true, subtree: true, characterData: true });
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else { init(); }
    } catch(e) { console.error('[Claude RTL]', e); }
})();
// --- CLAUDE RTL PATCH END ---
// --- CLAUDE WCO FIX START ---
;(function() {
    'use strict';
    try {
        if (typeof navigator === 'undefined' || typeof document === 'undefined') return;
        // Feature-detect + locale fallback. If the WCO API isn't available and the
        // OS locale is LTR, this whole block becomes a silent no-op.
        var wco = ('windowControlsOverlay' in navigator) ? navigator.windowControlsOverlay : null;
        var locale = ((navigator.language || '') + ',' + (navigator.languages || []).join(',')).toLowerCase();
        var LOCALE_IS_RTL = /\b(he|iw|ar|fa|ur|yi|ps|sd)\b/.test(locale);
        var FALLBACK_PAD_PX = 140; // Default Windows titleBarOverlay width at 100% DPI
        if (!wco && !LOCALE_IS_RTL) {
            window.__claudeWCOState = { source: 'none', reason: 'no-api-and-ltr-locale', locale: locale };
            return;
        }

        var STYLE_ID = 'claude-wco-fix';
        var TARGET_ATTR = 'data-claude-wco-target';
        var retryCount = 0;
        var MAX_RETRIES = 20; // ~10 seconds total at 500ms interval

        function removeAll() {
            var style = document.getElementById(STYLE_ID);
            if (style) style.remove();
            var marked = document.querySelectorAll('[' + TARGET_ATTR + ']');
            for (var i = 0; i < marked.length; i++) {
                marked[i].removeAttribute(TARGET_ATTR);
            }
        }

        // The title bar is the element Electron marks as the OS drag region.
        // In Claude Desktop it's always the element with class `draggable` (as
        // opposed to `draggable-none`, which marks non-drag subregions).
        // Padding on this overlay moves only the title-bar buttons, not the
        // app body — which is exactly what we want.
        function findTopBar() {
            return document.querySelector('.draggable:not(.draggable-none)');
        }

        function applyFix() {
            try {
                var rect = (wco && typeof wco.getTitlebarAreaRect === 'function')
                    ? wco.getTitlebarAreaRect() : null;

                var padStart = 0;
                var source = 'none';
                var height = 0;

                if (wco && wco.visible && rect && rect.width !== 0 && rect.x > 0) {
                    padStart = Math.round(rect.x);
                    height = Math.round(rect.height) || 40;
                    source = 'wco-api';
                } else if (LOCALE_IS_RTL) {
                    // Fallback: WCO API unavailable or not reporting left-side controls,
                    // but the OS locale is RTL — apply a conservative default padding.
                    padStart = FALLBACK_PAD_PX;
                    height = 40;
                    source = 'locale-fallback';
                } else {
                    // True no-op case: LTR locale and either no API or overlay on right.
                    window.__claudeWCOState = { source: 'none', reason: 'ltr-or-right-controls', rect: rect, locale: locale };
                    removeAll();
                    return true;
                }

                window.__claudeWCOState = { source: source, padStart: padStart, rect: rect, locale: locale, visible: wco ? wco.visible : null };

                var topBar = findTopBar();
                if (!topBar) return false; // Signal caller to retry later

                // Clear stale markers (previous target may have unmounted), mark fresh one.
                var prevMarked = document.querySelectorAll('[' + TARGET_ATTR + ']');
                for (var i = 0; i < prevMarked.length; i++) {
                    if (prevMarked[i] !== topBar) prevMarked[i].removeAttribute(TARGET_ATTR);
                }
                topBar.setAttribute(TARGET_ATTR, 'true');

                var style = document.getElementById(STYLE_ID);
                if (!style) {
                    style = document.createElement('style');
                    style.id = STYLE_ID;
                    document.head.appendChild(style);
                }
                // Single rule bound to our private attribute — zero collision risk
                // with any selector claude.ai might define.
                style.textContent =
                    '[' + TARGET_ATTR + ']{padding-inline-start:' + padStart +
                    'px!important;box-sizing:border-box!important}';
                return true;
            } catch(e) {
                console.error('[Claude WCO Fix]', e);
                return true; // Error → don't spam retries
            }
        }

        function scheduleAttempt() {
            var ok = applyFix();
            if (ok === false && retryCount++ < MAX_RETRIES) {
                setTimeout(scheduleAttempt, 500);
            }
        }

        function attach() {
            scheduleAttempt();

            // Chromium fires geometrychange on maximize/restore/DPI change.
            if (wco && typeof wco.addEventListener === 'function') {
                wco.addEventListener('geometrychange', function() {
                    retryCount = 0;
                    applyFix();
                });
            }
            // In locale-fallback mode we have no geometrychange event — listen
            // for window resize as a proxy. Cheap, fires rarely.
            if (!wco && LOCALE_IS_RTL) {
                window.addEventListener('resize', function() {
                    retryCount = 0;
                    applyFix();
                });
            }

            // React/SPA re-renders can unmount the top bar. Re-apply when that
            // happens. Debounced to 200ms; only actually re-runs if the marked
            // target is no longer in the DOM.
            var debounceTimer = null;
            var obs = new MutationObserver(function() {
                if (debounceTimer) return;
                debounceTimer = setTimeout(function() {
                    debounceTimer = null;
                    var marked = document.querySelector('[' + TARGET_ATTR + ']');
                    if (!marked || !document.body.contains(marked)) {
                        retryCount = 0;
                        applyFix();
                    }
                }, 200);
            });
            obs.observe(document.body, { childList: true, subtree: true });
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', attach);
        } else {
            attach();
        }
    } catch(e) { console.error('[Claude WCO Fix]', e); }
})();
// --- CLAUDE WCO FIX END ---

// --- CLAUDE PATCH WELCOME BANNER START ---
;(function() {
    'use strict';
    try {
        if (typeof document === 'undefined' || typeof localStorage === 'undefined') return;
        var FLAG_KEY = 'claude-rtl-patch-welcomed';
        // Tie the welcome banner to the Claude Desktop version reported in the UA
        // (e.g. "...Claude/1.3036.0 Chrome/..."). On every Claude release the
        // version changes, the saved flag stops matching, and the banner shows
        // once for the new version — no manual bump needed.
        var versionMatch = (navigator.userAgent || '').match(/Claude\/([\d.]+)/);
        var VERSION = versionMatch ? versionMatch[1] : '0';
        if (localStorage.getItem(FLAG_KEY) === VERSION) return;

        function show() {
            if (!document.body || document.getElementById('claude-rtl-welcome-banner')) return;
            var bar = document.createElement('div');
            bar.id = 'claude-rtl-welcome-banner';
            bar.dir = 'rtl';
            bar.style.cssText = [
                'position:fixed', 'top:12px', 'left:50%',
                'transform:translateX(-50%)',
                'z-index:2147483647',
                'background:#1f1f1f', 'color:#fff',
                'border:1px solid #3a3a3a', 'border-radius:10px',
                'padding:10px 14px', 'font:14px/1.4 system-ui,sans-serif',
                'box-shadow:0 6px 20px rgba(0,0,0,.4)',
                'display:flex', 'gap:12px', 'align-items:center',
                'max-width:560px'
            ].join(';');
            bar.innerHTML =
                '<span style="font-size:18px">\u2713</span>' +
                '<span style="flex:1">\u05d4\u05e4\u05d0\u05d8\u05e5\' \u05d4\u05d5\u05d7\u05dc \u05d1\u05d4\u05e6\u05dc\u05d7\u05d4 \u2014 \u05ea\u05de\u05d9\u05db\u05ea RTL \u05d5\u05ea\u05d9\u05e7\u05d5\u05df \u05db\u05e4\u05ea\u05d5\u05e8\u05d9 \u05d4\u05d7\u05dc\u05d5\u05df \u05e4\u05e2\u05d9\u05dc\u05d9\u05dd.</span>' +
                '<button id="claude-rtl-banner-close" style="background:transparent;color:#aaa;border:0;font-size:20px;cursor:pointer;padding:0 4px" aria-label="close">\u00d7</button>';
            document.body.appendChild(bar);

            function dismiss() {
                localStorage.setItem(FLAG_KEY, VERSION);
                bar.remove();
                document.removeEventListener('click', dismiss, true);
            }
            document.addEventListener('click', dismiss, true);
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', show);
        } else { show(); }
    } catch(e) { console.error('[Claude Welcome Banner]', e); }
})();
// --- CLAUDE PATCH WELCOME BANNER END ---
