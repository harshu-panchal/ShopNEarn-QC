import { useEffect } from 'react';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { isMobileOrWebView } from '@/core/utils/deviceUtils';

const LenisScroll = () => {
    useEffect(() => {
        // Disable Lenis on mobile devices and Flutter WebViews to use native hardware-accelerated scrolling
        if (isMobileOrWebView()) {
            return;
        }

        const lenis = new Lenis({
            duration: 1.2,
            easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
            direction: 'vertical',
            gestureDirection: 'vertical',
            smooth: true,
            mouseMultiplier: 1,
            smoothTouch: false,
            touchMultiplier: 2,
            // Allow native scrolling inside nested scroll containers.
            //
            // We opt out of Lenis in three situations:
            //   1. Any ancestor explicitly marked with `data-lenis-prevent`.
            //   2. Any ancestor inside a Radix dialog/popover portal
            //      (these are always meant to scroll independently).
            //   3. Any ancestor whose computed overflow makes it a real
            //      vertical scroll container with content that actually
            //      overflows. This catches every modal/drawer/sheet/
            //      popover in the codebase automatically — without
            //      requiring each one to remember to add
            //      `data-lenis-prevent`.
            prevent: (node) => {
                if (!node || typeof node.closest !== 'function') return false;

                if (
                    node.closest(
                        '[data-lenis-prevent], [data-lenis-prevent-wheel], [data-lenis-prevent-touch]'
                    )
                ) {
                    return true;
                }

                // Radix dialog / popover / dropdown portals always live
                // outside the main scroll flow and manage their own
                // overflow. Bail out for anything inside one of them.
                if (
                    node.closest(
                        '[role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper], [data-radix-portal]'
                    )
                ) {
                    return true;
                }

                // Walk up the tree looking for the first ancestor that
                // is a real vertical scroll container (overflow-y is
                // `auto` or `scroll` AND content actually overflows).
                let el = node;
                while (el && el !== document.body && el !== document.documentElement) {
                    const style =
                        el.nodeType === 1 ? window.getComputedStyle(el) : null;
                    if (style) {
                        const oy = style.overflowY;
                        if (
                            (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
                            el.scrollHeight > el.clientHeight + 1
                        ) {
                            return true;
                        }
                    }
                    el = el.parentElement;
                }

                return false;
            },
        });

        let rafId;

        function raf(time) {
            lenis.raf(time);
            rafId = requestAnimationFrame(raf);
        }

        rafId = requestAnimationFrame(raf);

        return () => {
            cancelAnimationFrame(rafId);
            lenis.destroy();
        };
    }, []);

    return null;
};

export default LenisScroll;
