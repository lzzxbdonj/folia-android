import { useEffect, useState } from 'react';
import { restoreScreenOrientation } from '../../../services/androidDisplay';
import { isAndroidRuntime } from '../../../services/androidRuntime';

/*
 * Phone landscape: the phone is rotated, not a desktop window that happens to be
 * wide. The viewport is short (~360 CSS px tall on a 2800x1264 phone), where a few
 * desktop-sized overlays are taller than the screen.
 *
 * This hook does NOT restyle the player. The stage, the compact capsule and the
 * transient track card keep their desktop geometry; phoneLandscape.css only
 * constrains the overlays that cannot fit (settings sheet, wall menu, panel).
 *
 * `max-height: 560px` keeps tablets and desktop windows out of this rule even
 * when they are landscape; `min-aspect-ratio` rejects a short but narrow window.
 */
const QUERY = '(orientation: landscape) and (max-height: 560px) and (min-aspect-ratio: 4/3)';

const matches = () => isAndroidRuntime() && typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(QUERY).matches;

/** True while the app is laid out for a rotated phone. */
export const usePhoneLandscape = (): boolean => {
    const [landscape, setLandscape] = useState(matches);

    // The saved orientation choice lives in localStorage, but the activity
    // always starts unlocked, so re-apply it once the shell is up.
    useEffect(() => {
        restoreScreenOrientation();
    }, []);

    useEffect(() => {
        if (!isAndroidRuntime() || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const media = window.matchMedia(QUERY);
        const apply = () => {
            setLandscape(media.matches);
            // CSS keys off this attribute so non-React trees (modals, portals, mod UI)
            // follow the same orientation without threading a prop through them.
            const root = document.documentElement;
            // Phone-only tuning that is not orientation specific (e.g. the seam
            // material over a dense poster wall) hangs off this marker.
            root.dataset.foliaPlatform = 'android';
            if (media.matches) root.dataset.foliaOrientation = 'landscape';
            else delete root.dataset.foliaOrientation;
        };
        apply();
        media.addEventListener('change', apply);
        return () => {
            media.removeEventListener('change', apply);
            delete document.documentElement.dataset.foliaOrientation;
            delete document.documentElement.dataset.foliaPlatform;
        };
    }, []);

    return landscape;
};
