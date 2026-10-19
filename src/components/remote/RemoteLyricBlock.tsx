import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Line, SubtitleContentMode } from '../../types';
import {
    buildRemoteLyricSegments,
    resolveRemoteLyricFit,
    resolveRemoteLyricTexts,
    type RemoteLyricSegment,
    type RemoteLyricTexts,
} from './remoteLyricText';
import type { RemoteClock } from './useRemoteClock';

// src/components/remote/RemoteLyricBlock.tsx
// The remote window's lyric: the line being sung, large, and one quiet line under it (its
// translation, its romanization, or the next line). The word-by-word fill is written straight to
// the DOM from the running clock; React only renders when the line changes.

const LARGE_LINE_HEIGHT_PX = 26;
const WHITESPACE_ONLY = /^\s+$/;

const getLineKey = (line: Line) => `${line.startTime}-${line.endTime}-${line.fullText}`;

type RemoteLyricLineProps = {
    line: Line;
    texts: RemoteLyricTexts;
    clock: RemoteClock;
    lyricOffsetSec: number;
};

const renderSegments = (
    segments: RemoteLyricSegment[],
    line: Line,
    setNode?: (index: number, node: HTMLSpanElement | null) => void,
) => {
    if (segments.length === 0) {
        // 只按行计时的歌词：整行都是唱到的颜色。
        return <span className="remote-lyric__whole">{line.fullText}</span>;
    }

    return segments.map((segment, index) => {
        if (!segment.timed && WHITESPACE_ONLY.test(segment.text)) {
            return <React.Fragment key={index}>{segment.text}</React.Fragment>;
        }
        return (
            <span
                key={index}
                ref={setNode ? node => setNode(index, node) : undefined}
                className={segment.timed ? 'remote-lyric__word' : 'remote-lyric__gap'}
            >
                {segment.text}
            </span>
        );
    });
};

/** One line with what goes under it. Owns its fill, so a line that is leaving keeps the fill it had. */
const RemoteLyricLine: React.FC<RemoteLyricLineProps> = ({ line, texts, clock, lyricOffsetSec }) => {
    const segments = useMemo(() => buildRemoteLyricSegments(line), [line]);
    const nodesRef = useRef<Array<HTMLSpanElement | null>>([]);
    const measureRef = useRef<HTMLDivElement | null>(null);
    const [mainLinesAtLarge, setMainLinesAtLarge] = useState(1);

    // The fit rule needs to know how many lines the lyric takes at the large size: measured once
    // per line, on a hidden copy with the same pieces and without the two-line cut.
    useLayoutEffect(() => {
        const height = measureRef.current?.offsetHeight ?? 0;
        const lines = Math.max(1, Math.round(height / LARGE_LINE_HEIGHT_PX));
        setMainLinesAtLarge(previous => (previous === lines ? previous : lines));
    }, [segments, line.fullText]);

    useEffect(() => {
        const painted: number[] = [];
        const paint = () => {
            const time = clock.getTime() - lyricOffsetSec;
            segments.forEach((segment, index) => {
                const node = nodesRef.current[index];
                if (!node) {
                    return;
                }

                const span = segment.endTime - segment.startTime;
                const fill = segment.timed && span > 0
                    ? Math.round(Math.max(0, Math.min(1, (time - segment.startTime) / span)) * 1000) / 10
                    : (time >= segment.startTime ? 100 : 0);
                if (painted[index] === fill) {
                    return;
                }
                painted[index] = fill;
                // Sung and not yet sung are plain text; only the piece in between is a gradient.
                node.dataset.fill = fill >= 100 ? 'full' : fill <= 0 ? 'none' : 'part';
                if (fill > 0 && fill < 100) {
                    node.style.setProperty('--remote-fill', `${fill}%`);
                }
            });
        };

        paint();
        return clock.subscribe(paint);
    }, [segments, clock, lyricOffsetSec]);

    const fit = resolveRemoteLyricFit({
        mainLinesAtLarge,
        hasRomanization: Boolean(texts.romanization),
        hasSecond: Boolean(texts.second),
    });

    return (
        <>
            <div ref={measureRef} className="remote-lyric__hero remote-lyric__measure" aria-hidden>
                {renderSegments(segments, line)}
            </div>
            <div className="remote-lyric__hero" data-size={fit.size} data-remote-shade="">
                {renderSegments(segments, line, (index, node) => {
                    nodesRef.current[index] = node;
                })}
            </div>
            {fit.showRomanization && texts.romanization && (
                <div className="remote-lyric__roma" data-remote-shade="">{texts.romanization}</div>
            )}
            {texts.second && fit.secondMaxLines > 0 && (
                <div
                    className="remote-lyric__sub"
                    data-kind={texts.second.kind}
                    data-lines={fit.secondMaxLines}
                    data-remote-shade=""
                >
                    {texts.second.text}
                </div>
            )}
        </>
    );
};

type RemoteLyricBlockProps = {
    line: Line | null;
    nextLine: Line | null;
    /** False in a gap inside the song: the last line stays, dimmed. */
    isSinging: boolean;
    subtitleContentMode: SubtitleContentMode;
    clock: RemoteClock;
    lyricOffsetSec: number;
    reduceMotion: boolean;
};

const RemoteLyricBlock: React.FC<RemoteLyricBlockProps> = ({
    line,
    nextLine,
    isSinging,
    subtitleContentMode,
    clock,
    lyricOffsetSec,
    reduceMotion,
}) => {
    const texts = useMemo(
        () => resolveRemoteLyricTexts(subtitleContentMode, line, nextLine),
        [subtitleContentMode, line, nextLine],
    );
    const rise = reduceMotion ? 0 : 6;

    return (
        <div className="remote-lyric" data-shown={Boolean(line)}>
            {/* 换行：旧的一对先淡出并上移 6px，走完之后新的一对再从下方 6px 进来。两句不叠在一起。 */}
            <AnimatePresence initial={false} mode="wait">
                {line && (
                    <motion.div
                        key={getLineKey(line)}
                        className="remote-lyric__pair"
                        data-dim={!isSinging}
                        initial={{ opacity: 0, y: rise }}
                        animate={{
                            opacity: 1,
                            y: 0,
                            transition: { duration: reduceMotion ? 0 : 0.26, ease: [0.2, 0.8, 0.2, 1] },
                        }}
                        exit={{
                            opacity: 0,
                            y: -rise,
                            transition: { duration: reduceMotion ? 0 : 0.18, ease: 'easeIn' },
                        }}
                    >
                        <RemoteLyricLine line={line} texts={texts} clock={clock} lyricOffsetSec={lyricOffsetSec} />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default RemoteLyricBlock;
