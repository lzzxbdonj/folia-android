import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

// src/components/visualizer/styleTransition/layerTransition.ts
// What a lyric style switch and a background change share. A layer is one style or one background in
// its own box: while a change plays the one on screen leaves and the new one comes in, and at most two
// are mounted (each can hold a WebGL context). The animations are the browser's own, on the box's
// opacity, filter and transform, so they keep going while a new layer's first mount holds up the page.
// A change can wait before it starts: the new layer is mounted at once but not shown, the one on screen
// stays as it is, and both animations start together once the change is started (a style switch waits
// for the new style's first frame, VisualizerStyleTransition; a background change made with it, for it).

/** How a layer change looks (softFocus.ts). */
export interface LayerTransition {
    /** How the layer on screen leaves: the look it goes to. */
    leave: { to: Keyframe; duration: number; delay?: number; easing: string };
    /** How the new layer comes in: the look it comes from. */
    enter: { from: Keyframe; duration: number; delay?: number; easing: string };
}

/** One layer, keyed per change, so a value shown again is mounted again. */
export interface ShownLayer<T> {
    key: number;
    value: T;
    leaving: boolean;
    comesIn: boolean;
    /** Its change has not started: a new layer stays unseen, a leaving one stays as it is. */
    waits: boolean;
}

/** Every layer of a change that waits, started. */
const started = <T>(layers: readonly ShownLayer<T>[]): readonly ShownLayer<T>[] => layers.map(layer => ({ ...layer, waits: false }));

/**
 * The layers once `value` is the one to show. With a transition the layer on screen leaves and the new
 * one comes in; at most two are mounted, so one still leaving from an earlier change goes at once.
 * `waits` says whether a change made now waits to start, and a change that waits starts once `waits`
 * is false or startedLayers starts it. A new change made while one waits replaces it: the layer on
 * screen is still the one leaving, and a change back to it ends the change. Without a transition, the
 * new layer only, and a change still playing when transitions are turned off ends at once.
 */
export const nextShownLayers = <T>(
    layers: readonly ShownLayer<T>[],
    value: T,
    animate: boolean,
    waits: boolean,
): readonly ShownLayer<T>[] => {
    const current = layers[layers.length - 1];
    if (current.value === value) {
        if (!animate) return layers.length === 1 && !current.waits ? layers : [{ ...current, waits: false }];
        return current.waits && !waits ? started(layers) : layers;
    }
    const next: ShownLayer<T> = { key: current.key + 1, value, leaving: false, comesIn: animate, waits: animate && waits };
    if (!animate) return [next];
    if (!current.waits) return [{ ...current, leaving: true, waits: next.waits }, next];
    const onScreen = layers.length > 1 ? layers[layers.length - 2] : null;
    if (!onScreen) return [next];
    if (onScreen.value === value) return [{ ...onScreen, leaving: false, waits: false }];
    return [{ ...onScreen, waits: next.waits }, next];
};

/** The layers once the change to the layer `key` starts: the same ones unless it is the newest and waits. */
export const startedLayers = <T>(layers: readonly ShownLayer<T>[], key: number): readonly ShownLayer<T>[] => {
    const current = layers[layers.length - 1];
    return current.key === key && current.waits ? started(layers) : layers;
};

/** How long after its leave should have ended a leaving layer is removed when no finish event came. */
export const LEAVE_FALLBACK_MARGIN_MS = 1000;

/**
 * The layers to draw for `value`, oldest first (the new one is drawn over the leaving one), what a
 * layer calls once it has left, and what starts the change to a layer that waits. The first value is
 * there from the start, without a transition. `waits` as for nextShownLayers.
 */
export const useShownLayers = <T>(
    value: T,
    animate: boolean,
    waits: boolean,
): readonly [readonly ShownLayer<T>[], (key: number) => void, (key: number) => void] => {
    const [layers, setLayers] = useState<readonly ShownLayer<T>[]>(() => [{ key: 0, value, leaving: false, comesIn: false, waits: false }]);
    const shown = nextShownLayers(layers, value, animate, waits);
    if (shown !== layers) setLayers(shown);
    const onLeft = useCallback((key: number) => {
        setLayers(list => list.filter(layer => layer.key !== key));
    }, []);
    const onStart = useCallback((key: number) => {
        setLayers(list => startedLayers(list, key));
    }, []);
    return [shown, onLeft, onStart];
};

/**
 * Plays a layer's transition on its box: the enter when it mounts coming in (fixed then, so a setting
 * changed later does not play it again), and the leave once it is leaving, after which it calls
 * `onLeft`; both once the change has started. A layer without a box, or without a transition, has left
 * at once. `hold`, where given, is called while the layer waits or plays its transition, and what it
 * returns once that is over.
 */
export const useLayerAnimation = (
    ref: RefObject<HTMLElement | null>,
    layer: ShownLayer<unknown>,
    transition: LayerTransition | null,
    onLeft: (key: number) => void,
    hold?: () => () => void,
) => {
    const comingRef = useRef<Animation | null>(null);
    const [enter] = useState(() => (layer.comesIn ? transition?.enter ?? null : null));
    const { key, leaving, waits } = layer;

    useLayoutEffect(() => {
        const element = ref.current;
        if (!enter || !element || typeof element.animate !== 'function') return undefined;
        const { from, ...timing } = enter;
        const animation = element.animate([{ ...from, offset: 0 }], { ...timing, fill: 'backwards' });
        comingRef.current = animation;
        const release = hold?.();
        if (release) animation.finished.then(release, release);
        return () => {
            animation.cancel();
            release?.();
        };
    }, [ref, enter, hold]);

    // Held at the look it comes from, unseen, until its change starts. One that is called away while
    // still coming in goes on coming in until its leave starts.
    const enterWaits = waits && !leaving;
    useLayoutEffect(() => {
        const coming = comingRef.current;
        if (!coming) return;
        if (enterWaits) coming.pause();
        else if (coming.playState === 'paused') coming.play();
    }, [enter, enterWaits]);

    useLayoutEffect(() => {
        if (!leaving) return undefined;
        const element = ref.current;
        if (!transition || !element || typeof element.animate !== 'function') {
            onLeft(key);
            return undefined;
        }
        if (waits) return undefined;
        const coming = comingRef.current;
        if (coming?.playState === 'running') {
            // Called away while still coming in: it leaves from where it got to.
            try {
                coming.commitStyles();
            } catch {
                // Not rendered: it leaves from its full look.
            }
            coming.cancel();
        }
        const { to, ...timing } = transition.leave;
        const animation = element.animate([{ ...to, offset: 1 }], { ...timing, fill: 'forwards' });
        animation.onfinish = () => onLeft(key);
        // The finish event waits while the window is hidden, and never comes for an animation cancelled
        // from outside; either way the layer (maybe a WebGL context) would stay mounted. The timer
        // counts from here, while the animation starts with the next frame, which the new layer's
        // first mount can hold up: the margin keeps the timer from cutting a fade that started late.
        const fallback = window.setTimeout(() => onLeft(key), (timing.delay ?? 0) + timing.duration + LEAVE_FALLBACK_MARGIN_MS);
        const release = hold?.();
        return () => {
            window.clearTimeout(fallback);
            animation.cancel();
            release?.();
        };
    }, [ref, leaving, waits, transition, onLeft, key, hold]);
};
