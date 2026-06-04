import { useEffect, useRef } from 'react';
import { useSettings } from '@core/context/SettingsContext';

/**
 * Updates document title, favicon, and meta description/keywords
 * from global settings. Must be rendered inside SettingsProvider.
 *
 * Favicon handling notes
 * ----------------------
 * Browsers cache the FIRST `<link rel="icon">` they see at parse
 * time. `index.html` ships a static `vite.svg` icon so the tab
 * has *something* during cold load, but admins can replace it
 * from `Admin → Settings → Branding`. To make that override
 * actually win:
 *
 *   1. We remove ALL pre-existing favicon links the first time
 *      this effect runs (the static one from `index.html` AND any
 *      stale `dynamic-favicon` left by a previous render).
 *   2. We create exactly one canonical `<link id="dynamic-favicon"
 *      rel="icon">` and update its `href` + `type` whenever the
 *      admin uploads a new asset.
 *   3. We mirror the same URL onto a `<link rel="apple-touch-icon">`
 *      so iOS "Add to Home Screen" shows the admin's branding too.
 *   4. We pick the MIME type from the file extension so PNG / SVG /
 *      JPG / ICO uploads all render correctly (Safari refuses
 *      `image/x-icon` for PNGs and vice-versa).
 *   5. If `faviconUrl` is cleared we fall back to the bundled
 *      `/vite.svg` so the tab is never iconless.
 */
function mimeTypeForFaviconUrl(url) {
    const lower = (url || '').toLowerCase().split('?')[0];
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.svg')) return 'image/svg+xml';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.ico')) return 'image/x-icon';
    return 'image/png';
}

/**
 * Ensures the canonical favicon link exists, removing any stale
 * duplicates left over from previous renders or from index.html.
 */
function ensureFaviconLink() {
    const existing = document.querySelectorAll(
        'link[rel="icon"], link[rel="shortcut icon"]',
    );
    let canonical = null;
    existing.forEach((node) => {
        if (node.id === 'dynamic-favicon' && !canonical) {
            canonical = node;
        } else {
            node.parentNode?.removeChild(node);
        }
    });
    if (!canonical) {
        canonical = document.createElement('link');
        canonical.id = 'dynamic-favicon';
        canonical.rel = 'icon';
        document.head.appendChild(canonical);
    }
    return canonical;
}

function ensureAppleTouchIconLink() {
    let link = document.querySelector('link[rel="apple-touch-icon"]');
    if (!link) {
        link = document.createElement('link');
        link.rel = 'apple-touch-icon';
        document.head.appendChild(link);
    }
    return link;
}

export default function SeoHead() {
    const { settings } = useSettings();
    const metaRefs = useRef({
        description: null,
        keywords: null,
        favicon: null,
        appleTouchIcon: null,
    });

    useEffect(() => {
        if (!settings) return;

        const title = settings.metaTitle || settings.appName || 'App';
        document.title = title;

        const desc = settings.metaDescription || '';
        const keywordsContent = (Array.isArray(settings.keywords) && settings.keywords.length)
            ? settings.keywords.join(', ')
            : (settings.metaKeywords || '');

        // Update or create meta description
        let metaDesc = metaRefs.current.description;
        if (!metaDesc) {
            metaDesc = document.querySelector('meta[name="description"]');
            if (!metaDesc) {
                metaDesc = document.createElement('meta');
                metaDesc.setAttribute('name', 'description');
                document.head.appendChild(metaDesc);
            }
            metaRefs.current.description = metaDesc;
        }
        metaDesc.setAttribute('content', desc);

        // Update or create meta keywords
        let metaKw = metaRefs.current.keywords;
        if (!metaKw) {
            metaKw = document.querySelector('meta[name="keywords"]');
            if (!metaKw) {
                metaKw = document.createElement('meta');
                metaKw.setAttribute('name', 'keywords');
                document.head.appendChild(metaKw);
            }
            metaRefs.current.keywords = metaKw;
        }
        metaKw.setAttribute('content', keywordsContent);

        // ---- Favicon ----
        const faviconUrl = (settings.faviconUrl || '').trim();
        const effectiveFavicon = faviconUrl || '/vite.svg';
        const mime = mimeTypeForFaviconUrl(effectiveFavicon);

        let linkFavicon = metaRefs.current.favicon;
        if (!linkFavicon || !linkFavicon.isConnected) {
            linkFavicon = ensureFaviconLink();
            metaRefs.current.favicon = linkFavicon;
        }
        if (linkFavicon.getAttribute('href') !== effectiveFavicon) {
            linkFavicon.setAttribute('href', effectiveFavicon);
        }
        if (linkFavicon.getAttribute('type') !== mime) {
            linkFavicon.setAttribute('type', mime);
        }

        // Mirror onto apple-touch-icon for iOS home-screen branding.
        let linkApple = metaRefs.current.appleTouchIcon;
        if (!linkApple || !linkApple.isConnected) {
            linkApple = ensureAppleTouchIconLink();
            metaRefs.current.appleTouchIcon = linkApple;
        }
        if (linkApple.getAttribute('href') !== effectiveFavicon) {
            linkApple.setAttribute('href', effectiveFavicon);
        }
    }, [settings]);

    return null;
}
