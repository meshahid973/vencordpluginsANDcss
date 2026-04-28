import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const STYLE_ID = "cp-image-ambience-style";
const GLOW_CLASS = "cp-image-ambience-glow";
const IMAGE_SELECTOR = "img[src], img[srcset]";

let observer: MutationObserver | null = null;
let imageObserver: IntersectionObserver | null = null;

let scanFrame = 0;
let resizeFrame = 0;

let lastKey = new WeakMap<HTMLImageElement, string>();
let glowByImage = new WeakMap<HTMLImageElement, HTMLElement>();

const queue = new Set<Node>();
const watchedImages = new WeakSet<HTMLImageElement>();
const glows = new Set<HTMLElement>();
const openedParents = new Set<HTMLElement>();

function refresh() {
    syncVars();
    cleanupGlows();

    if (settings.store.enabled) {
        requestScan(document.body);
    }
}

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Turn the image glow on or off.",
        default: true,
        onChange: refresh
    },

    discordOnly: {
        type: OptionType.BOOLEAN,
        description: "Only glow Discord uploaded images. Best option.",
        default: true,
        onChange: refresh
    },

    stillImagesOnly: {
        type: OptionType.BOOLEAN,
        description: "Ignore GIFs so the GIF favorite button does not break spacing.",
        default: true,
        onChange: refresh
    },

    pngOnly: {
        type: OptionType.BOOLEAN,
        description: "Only glow PNG images.",
        default: false,
        onChange: refresh
    },

    strength: {
        type: OptionType.NUMBER,
        description: "How visible the glow is.",
        default: 82,
        min: 0,
        max: 100,
        step: 1,
        onChange: syncVars
    },

    size: {
        type: OptionType.NUMBER,
        description: "How far the glow spreads.",
        default: 26,
        min: 0,
        max: 80,
        step: 1,
        onChange: syncVars
    },

    softness: {
        type: OptionType.NUMBER,
        description: "How soft and blurry the glow is.",
        default: 34,
        min: 0,
        max: 90,
        step: 1,
        onChange: syncVars
    },

    colorBoost: {
        type: OptionType.NUMBER,
        description: "Makes the glow colors stronger.",
        default: 230,
        min: 100,
        max: 450,
        step: 10,
        onChange: syncVars
    },

    roundness: {
        type: OptionType.NUMBER,
        description: "How rounded the image corners are.",
        default: 14,
        min: 0,
        max: 40,
        step: 1,
        onChange: syncVars
    },

    minimumSize: {
        type: OptionType.NUMBER,
        description: "Ignore tiny icons, emojis, and buttons.",
        default: 65,
        min: 20,
        max: 250,
        step: 5,
        onChange: refresh
    },

    debug: {
        type: OptionType.BOOLEAN,
        description: "Show console logs for testing.",
        default: false
    }
});

function log(...args: unknown[]) {
    if (settings.store.debug) console.log("[Image Ambience]", ...args);
}

function cssUrl(url: string) {
    return `url("${url.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}")`;
}

function syncVars() {
    const root = document.documentElement.style;

    root.setProperty("--cp-img-ambience-opacity", String(settings.store.strength / 100));
    root.setProperty("--cp-img-ambience-size", `${settings.store.size}px`);
    root.setProperty("--cp-img-ambience-blur", `${settings.store.softness}px`);
    root.setProperty("--cp-img-ambience-saturation", `${settings.store.colorBoost}%`);
    root.setProperty("--cp-img-ambience-radius", `${settings.store.roundness}px`);
}

function injectStyle() {
    document.getElementById(STYLE_ID)?.remove();

    const style = document.createElement("style");
    style.id = STYLE_ID;

    style.textContent = `
        [data-cp-image-ambience-open="1"] {
            overflow: visible !important;
            contain: none !important;
            clip-path: none !important;
            mask-image: none !important;
            -webkit-mask-image: none !important;
        }

        [data-cp-image-ambience-host="1"] {
            position: relative !important;
            overflow: visible !important;
            contain: none !important;
            isolation: isolate !important;
            border-radius: var(--cp-img-ambience-radius) !important;
        }

        [data-cp-image-ambience-host="1"] > :not(.${GLOW_CLASS}) {
            position: relative !important;
            z-index: 1 !important;
        }

        [data-cp-image-ambience-host="1"] img,
        [data-cp-image-ambience-host="1"] [class*="loadingOverlay_"],
        [data-cp-image-ambience-host="1"] [class*="clickableWrapper_"],
        [data-cp-image-ambience-host="1"] [class*="lazyImgContainer_"] {
            border-radius: var(--cp-img-ambience-radius) !important;
        }

        .${GLOW_CLASS} {
            position: absolute !important;
            left: calc(var(--cp-img-ambience-x) - var(--cp-img-ambience-size)) !important;
            top: calc(var(--cp-img-ambience-y) - var(--cp-img-ambience-size)) !important;
            width: calc(var(--cp-img-ambience-w) + (var(--cp-img-ambience-size) * 2)) !important;
            height: calc(var(--cp-img-ambience-h) + (var(--cp-img-ambience-size) * 2)) !important;

            z-index: 0 !important;
            pointer-events: none !important;

            background-image: var(--cp-img-ambience-src) !important;
            background-size: 100% 100% !important;
            background-position: center !important;
            background-repeat: no-repeat !important;

            border-radius: calc(var(--cp-img-ambience-radius) + var(--cp-img-ambience-size)) !important;
            opacity: var(--cp-img-ambience-opacity) !important;

            filter:
                blur(var(--cp-img-ambience-blur))
                saturate(var(--cp-img-ambience-saturation))
                brightness(1.12) !important;

            transform: translateZ(0) scale(1.01) !important;
            backface-visibility: hidden !important;
        }

        [data-cp-image-ambience-host="1"]:hover > .${GLOW_CLASS} {
            opacity: min(1, calc(var(--cp-img-ambience-opacity) + 0.08)) !important;
        }

        @media (prefers-reduced-motion: reduce) {
            .${GLOW_CLASS} {
                transform: none !important;
            }
        }
    `;

    document.head.appendChild(style);
}

function firstSrcFromSrcset(srcset: string) {
    return srcset
        .split(",")
        .map(part => part.trim().split(/\s+/)[0])
        .find(Boolean) ?? "";
}

function getUrlInfo(src: string) {
    try {
        const url = new URL(src, location.href);
        const href = url.href.toLowerCase();
        const path = url.pathname.toLowerCase();
        const format = url.searchParams.get("format")?.toLowerCase();

        return { url, href, path, format };
    } catch {
        return null;
    }
}

function isGifUrl(src: string) {
    const info = getUrlInfo(src);
    if (!info) return false;

    return (
        info.path.endsWith(".gif") ||
        info.format === "gif" ||
        info.href.includes("format=gif") ||
        info.href.includes(".gif?")
    );
}

function isDiscordAttachmentUrl(src: string) {
    const info = getUrlInfo(src);
    if (!info) return false;

    const host = info.url.hostname.toLowerCase();

    return (
        (host === "cdn.discordapp.com" || host === "media.discordapp.net") &&
        (info.path.includes("/attachments/") || info.path.includes("/ephemeral-attachments/"))
    );
}

function isAllowedImageUrl(src: string) {
    const info = getUrlInfo(src);
    if (!info) return false;

    if (settings.store.discordOnly && !isDiscordAttachmentUrl(src)) return false;

    if (settings.store.stillImagesOnly && isGifUrl(src)) return false;

    if (settings.store.pngOnly) {
        return info.path.endsWith(".png") || info.format === "png" || info.href.includes("format=png");
    }

    return (
        info.path.endsWith(".png") ||
        info.path.endsWith(".jpg") ||
        info.path.endsWith(".jpeg") ||
        info.path.endsWith(".webp") ||
        info.path.endsWith(".gif") ||
        info.format === "png" ||
        info.format === "jpg" ||
        info.format === "jpeg" ||
        info.format === "webp" ||
        info.format === "gif" ||
        info.href.includes("format=png") ||
        info.href.includes("format=jpg") ||
        info.href.includes("format=jpeg") ||
        info.href.includes("format=webp") ||
        info.href.includes("format=gif")
    );
}

function resolveImageSrc(img: HTMLImageElement) {
    const candidates: string[] = [];

    if (img.currentSrc) candidates.push(img.currentSrc);
    if (img.src) candidates.push(img.src);
    if (img.srcset) candidates.push(firstSrcFromSrcset(img.srcset));

    const link = img.closest<HTMLAnchorElement>(
        'a[href*="cdn.discordapp.com/attachments/"], a[href*="media.discordapp.net/attachments/"], a[data-safe-src]'
    );

    const safeSrc = link?.getAttribute("data-safe-src");
    const href = link?.getAttribute("href");

    if (safeSrc) candidates.push(safeSrc);
    if (href) candidates.push(href);

    return candidates.find(src => {
        if (!src) return false;
        if (src.startsWith("data:") || src.startsWith("blob:")) return false;
        return isAllowedImageUrl(src);
    }) ?? "";
}

function looksLikeGifControl(img: HTMLImageElement) {
    const label = [
        img.alt,
        img.getAttribute("aria-label"),
        img.closest("[aria-label]")?.getAttribute("aria-label"),
        img.closest("button")?.getAttribute("aria-label")
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    return (
        label.includes("favorite") ||
        label.includes("favourite") ||
        label.includes("gif") ||
        Boolean(img.closest('[class*="gifFavorite"], [class*="favoriteButton"], [class*="gifTag"]'))
    );
}

function getImageRect(img: HTMLImageElement) {
    const rect = img.getBoundingClientRect();

    return {
        width: rect.width || img.clientWidth || img.naturalWidth || Number(img.getAttribute("width")) || 0,
        height: rect.height || img.clientHeight || img.naturalHeight || Number(img.getAttribute("height")) || 0
    };
}

function isValidImage(img: HTMLImageElement) {
    if (!settings.store.enabled) return false;
    if (!document.body.contains(img)) return false;
    if (looksLikeGifControl(img)) return false;

    const src = resolveImageSrc(img);
    if (!src) return false;

    const { width, height } = getImageRect(img);
    const minimum = settings.store.minimumSize;

    return width >= minimum && height >= minimum;
}

function isBadHost(el: HTMLElement) {
    return (
        el === document.body ||
        el === document.documentElement ||
        el.matches("button") ||
        el.matches('[role="button"]') ||
        el.matches('[class*="mediaAttachmentsContainer_"]') ||
        el.matches('[class*="oneByOneGrid_"]') ||
        el.matches('[class*="oneByTwoGrid_"]') ||
        el.matches('[class*="message_"]') ||
        el.matches('[class*="favorite"]') ||
        el.matches('[class*="gifFavorite"]')
    );
}

function getHost(img: HTMLImageElement) {
    const selectors = [
        ".imageWrapper",
        '[class*="imageWrapper_"]',
        '[class*="lazyImgContainer_"]',
        '[class*="imageContainer_"]',
        '[class*="visualMediaItemContainer_"]',
        'a[href*="cdn.discordapp.com/attachments/"]',
        'a[href*="media.discordapp.net/attachments/"]'
    ];

    for (const selector of selectors) {
        const host = img.closest<HTMLElement>(selector);
        if (host && !isBadHost(host)) return host;
    }

    let parent = img.parentElement;

    if (parent?.tagName === "PICTURE") {
        parent = parent.parentElement;
    }

    if (parent && !isBadHost(parent)) return parent;

    return null;
}

function openParents(host: HTMLElement) {
    let el: HTMLElement | null = host;

    for (let i = 0; el && i < 8; i++) {
        const className = el.className?.toString() ?? "";
        const aria = el.getAttribute("aria-label")?.toLowerCase() ?? "";

        if (
            el.matches("button") ||
            el.matches('[role="button"]') ||
            className.toLowerCase().includes("favorite") ||
            aria.includes("favorite") ||
            aria.includes("favourite")
        ) {
            break;
        }

        el.dataset.cpImageAmbienceOpen = "1";
        openedParents.add(el);

        if (
            el.id.startsWith("message-accessories-") ||
            className.includes("messageListItem_")
        ) {
            break;
        }

        el = el.parentElement;
    }
}

function ensureGlow(img: HTMLImageElement, host: HTMLElement) {
    let glow = glowByImage.get(img);

    if (!glow || !glow.isConnected || glow.parentElement !== host) {
        removeImageGlow(img);

        glow = document.createElement("div");
        glow.className = GLOW_CLASS;
        glow.setAttribute("aria-hidden", "true");

        host.prepend(glow);

        glowByImage.set(img, glow);
        glows.add(glow);
    }

    return glow;
}

function removeImageGlow(img: HTMLImageElement) {
    const glow = glowByImage.get(img);

    if (glow) {
        glow.remove();
        glows.delete(glow);
    }

    glowByImage.delete(img);
    lastKey.delete(img);
}

function applyGlow(img: HTMLImageElement) {
    if (!isValidImage(img)) {
        removeImageGlow(img);
        return;
    }

    const host = getHost(img);

    if (!host || !document.body.contains(host)) {
        removeImageGlow(img);
        return;
    }

    const src = resolveImageSrc(img);

    if (!src) {
        removeImageGlow(img);
        return;
    }

    const imgRect = img.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();

    const width = imgRect.width || img.clientWidth || img.naturalWidth;
    const height = imgRect.height || img.clientHeight || img.naturalHeight;

    if (width < settings.store.minimumSize || height < settings.store.minimumSize) {
        removeImageGlow(img);
        return;
    }

    const x = imgRect.left - hostRect.left;
    const y = imgRect.top - hostRect.top;

    const roundedWidth = Math.round(width);
    const roundedHeight = Math.round(height);
    const roundedX = Math.round(x);
    const roundedY = Math.round(y);

    const key = `${src}|${roundedX}|${roundedY}|${roundedWidth}|${roundedHeight}`;

    if (lastKey.get(img) === key) return;

    const glow = ensureGlow(img, host);

    host.dataset.cpImageAmbienceHost = "1";

    glow.style.setProperty("--cp-img-ambience-src", cssUrl(src));
    glow.style.setProperty("--cp-img-ambience-x", `${roundedX}px`);
    glow.style.setProperty("--cp-img-ambience-y", `${roundedY}px`);
    glow.style.setProperty("--cp-img-ambience-w", `${roundedWidth}px`);
    glow.style.setProperty("--cp-img-ambience-h", `${roundedHeight}px`);

    openParents(host);
    lastKey.set(img, key);

    log("applied", src);
}

function watchImage(img: HTMLImageElement) {
    if (watchedImages.has(img)) return;

    watchedImages.add(img);

    img.addEventListener("load", () => requestScan(img), { passive: true });
    img.addEventListener("error", () => removeImageGlow(img), { passive: true });

    imageObserver?.observe(img);
}

function scanNode(node: Node) {
    if (!settings.store.enabled) return;

    if (node instanceof HTMLImageElement) {
        watchImage(node);
        applyGlow(node);
        return;
    }

    if (!(node instanceof Element)) return;

    for (const img of node.querySelectorAll<HTMLImageElement>(IMAGE_SELECTOR)) {
        watchImage(img);
        applyGlow(img);
    }
}

function flushQueue() {
    scanFrame = 0;

    if (!settings.store.enabled) {
        queue.clear();
        cleanupGlows();
        return;
    }

    syncVars();

    const nodes = Array.from(queue);
    queue.clear();

    for (const node of nodes) {
        scanNode(node);
    }
}

function requestScan(node: Node | null) {
    if (!node) return;

    queue.add(node);

    if (!scanFrame) {
        scanFrame = requestAnimationFrame(flushQueue);
    }
}

function cleanupGlows() {
    for (const glow of glows) {
        glow.remove();
    }

    document.querySelectorAll<HTMLElement>(`.${GLOW_CLASS}`).forEach(el => el.remove());

    document.querySelectorAll<HTMLElement>("[data-cp-image-ambience-host]").forEach(el => {
        delete el.dataset.cpImageAmbienceHost;
    });

    for (const el of openedParents) {
        delete el.dataset.cpImageAmbienceOpen;
    }

    document.querySelectorAll<HTMLElement>("[data-cp-image-ambience-open]").forEach(el => {
        delete el.dataset.cpImageAmbienceOpen;
    });

    glows.clear();
    openedParents.clear();

    glowByImage = new WeakMap<HTMLImageElement, HTMLElement>();
    lastKey = new WeakMap<HTMLImageElement, string>();
}

function cleanupAll() {
    document.getElementById(STYLE_ID)?.remove();

    cleanupGlows();
    queue.clear();

    if (scanFrame) {
        cancelAnimationFrame(scanFrame);
        scanFrame = 0;
    }

    if (resizeFrame) {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = 0;
    }

    imageObserver?.disconnect();
    imageObserver = null;
}

function onResize() {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);

    resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        refresh();
    });
}

function createImageObserver() {
    imageObserver?.disconnect();

    imageObserver = new IntersectionObserver(
        entries => {
            for (const entry of entries) {
                if (entry.isIntersecting && entry.target instanceof HTMLImageElement) {
                    requestScan(entry.target);
                }
            }
        },
        {
            root: null,
            rootMargin: "500px",
            threshold: 0
        }
    );
}

export default definePlugin({
    name: "ImageAmbience",
    description: "Adds a soft color glow around images.",
    authors: [{ name: "CoderPixel", id: 0n }],
    settings,

    start() {
        injectStyle();
        syncVars();
        createImageObserver();

        requestScan(document.body);

        observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                if (mutation.type === "attributes") {
                    requestScan(mutation.target);
                    continue;
                }

                for (const node of mutation.addedNodes) {
                    requestScan(node);
                }

                for (const node of mutation.removedNodes) {
                    if (node instanceof HTMLImageElement) {
                        removeImageGlow(node);
                    } else if (node instanceof Element) {
                        for (const img of node.querySelectorAll<HTMLImageElement>(IMAGE_SELECTOR)) {
                            removeImageGlow(img);
                        }
                    }
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["src", "srcset", "sizes", "href", "data-safe-src", "style", "class", "aria-label"]
        });

        window.addEventListener("resize", onResize, { passive: true });

        log("started");
    },

    stop() {
        observer?.disconnect();
        observer = null;

        window.removeEventListener("resize", onResize);

        cleanupAll();

        log("stopped");
    }
});
