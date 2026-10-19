import { useEffect, useMemo, useRef, useState } from 'react';
import { mixColors } from '../colorMix';

// src/components/visualizer/backgrounds/useBlendedColors.ts
// For a background that changes its colours in place rather than as a new copy (its entry has no
// `song`; a second WebGL copy on every song change would hold up the page): the colours it draws,
// blended from the ones on screen over `blendMs` (VisualizerBackgroundRenderProps), the soft focus's
// length where the host plays transitions and 0 where it changes at once.

/** The soft focus's own ease out, near enough for colours. */
const easeOut = (t: number) => 1 - (1 - t) ** 3;

const sameColors = (left: readonly string[], right: readonly string[]) => (
    left.length === right.length && left.every((color, index) => color === right[index])
);

/** `colors` as drawn: a change blends from what is drawn to them over `durationMs`; with 0, at once. */
export const useBlendedColors = (colors: readonly string[], durationMs: number): readonly string[] => {
    const key = colors.join('|');
    // The same array while the colours stay the same, though `colors` is a new one each render.
    const target = useMemo(() => key.split('|'), [key]);
    const [drawn, setDrawn] = useState<readonly string[]>(target);
    // What is on screen now, also partway through a blend, so a new change blends on from there.
    const drawnRef = useRef<readonly string[]>(target);

    useEffect(() => {
        const from = drawnRef.current;
        const show = (next: readonly string[]) => {
            drawnRef.current = next;
            setDrawn(next);
        };
        if (sameColors(from, target)) return undefined;
        if (durationMs <= 0 || from.length !== target.length) {
            show(target);
            return undefined;
        }
        const startedAt = performance.now();
        let frame = 0;
        const step = (now: number) => {
            const t = Math.min(1, (now - startedAt) / durationMs);
            show(t >= 1 ? target : target.map((to, index) => mixColors(from[index], to, easeOut(t))));
            if (t < 1) frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return () => cancelAnimationFrame(frame);
    }, [target, durationMs]);

    return durationMs <= 0 ? target : drawn;
};
