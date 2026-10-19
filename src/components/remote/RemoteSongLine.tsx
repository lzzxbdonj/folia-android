import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { RemoteTrackHandoff } from './useRemoteTrackHandoff';

// src/components/remote/RemoteSongLine.tsx
// The song in the remote window, in its two forms: one small line above the lyric (cover 22),
// or the title card that stands in for the lyric when no line is being sung (cover 56).
// One cover element serves both and changes size between them, and it is also the sleeve's large
// cover when the window is not in use; the two texts cross-fade.
// A song change cross-fades the faces the hand-off hook hands over.

/** 换歌：封面和歌名一起淡入淡出。 */
const SWITCH_SECONDS = 0.3;
/** 音频交接：进出场交给本地的不透明度时间轴，外层只需要一个线性的短过渡。 */
const HANDOFF_TRANSITION = { duration: 0.55, ease: 'linear' } as const;

/** A cover as a CSS background. Quoted: a cover address may hold brackets, which end a bare url(). */
export const remoteCoverImage = (url: string | null): string | undefined => (
    url ? `url(${JSON.stringify(url)})` : undefined
);

type RemoteCoverFacesProps = {
    handoff: RemoteTrackHandoff;
    /** The class of each picture layer: the small cover and the blurred card background share this component. */
    imageClassName: string;
    reduceMotion: boolean;
};

/** One picture per face. During an audio hand-off the two pictures trade opacity on the hand-off's own clock. */
export const RemoteCoverFaces: React.FC<RemoteCoverFacesProps> = ({ handoff, imageClassName, reduceMotion }) => (
    // 交接的不透明度单独挂在内层：外层只管进出场，两层 opacity 天然相乘，
    // 本地 MotionValue 就不会和 initial/animate/exit 抢同一个 opacity。
    <AnimatePresence initial={false}>
        {handoff.coverFaces.map(face => {
            const handoffOpacity = face.mode === 'incoming'
                ? handoff.handoffIncomingOpacity
                : handoff.isHandoffActive && handoff.hasIncomingCoverFace ? handoff.handoffOutgoingOpacity : undefined;
            return (
                <motion.div
                    key={`cover-${face.key}`}
                    className="remote-cover__face"
                    initial={{ opacity: face.mode === 'incoming' ? 1 : 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={face.mode === 'incoming'
                        ? HANDOFF_TRANSITION
                        : { duration: reduceMotion ? 0 : SWITCH_SECONDS, ease: 'easeInOut' }}
                >
                    <motion.div
                        className={imageClassName}
                        style={{
                            backgroundImage: remoteCoverImage(face.coverUrl),
                            ...(handoffOpacity ? { opacity: handoffOpacity } : {}),
                        }}
                    />
                </motion.div>
            );
        })}
    </AnimatePresence>
);

type RemoteSongLineProps = {
    /** 'line': a lyric line is on screen and the song is the small line. 'card': the song is the title card. */
    mode: 'line' | 'card';
    handoff: RemoteTrackHandoff;
    reduceMotion: boolean;
};

const RemoteSongLine: React.FC<RemoteSongLineProps> = ({ mode, handoff, reduceMotion }) => {
    const enterOffset = reduceMotion ? 0 : handoff.trackEnterOffset;
    const renderFaces = (form: 'line' | 'card') => (
        <AnimatePresence initial={false}>
            {handoff.faces.map(face => {
                const handoffOpacity = face.mode === 'incoming'
                    ? handoff.handoffIncomingOpacity
                    : handoff.isHandoffActive ? handoff.handoffOutgoingOpacity : undefined;
                // The soft shade of the transparent background is sized to the text that is showing.
                const shade = form === mode && face.mode === 'current' ? '' : undefined;
                return (
                    <motion.div
                        key={`${form}-${face.key}`}
                        className="remote-song__face"
                        initial={face.mode === 'incoming' ? { opacity: 1, x: 0 } : { opacity: 0, x: enterOffset }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -enterOffset }}
                        transition={face.mode === 'incoming'
                            ? HANDOFF_TRANSITION
                            : { duration: reduceMotion ? 0 : SWITCH_SECONDS, ease: 'easeInOut' }}
                    >
                        {form === 'line' ? (
                            <motion.div
                                className="remote-song__row"
                                data-remote-shade={shade}
                                style={handoffOpacity ? { opacity: handoffOpacity } : undefined}
                            >
                                <span className="remote-song__title">{face.title}</span>
                                {face.artist && <span className="remote-song__artist">{face.artist}</span>}
                            </motion.div>
                        ) : (
                            <motion.div
                                className="remote-song__cardtext"
                                data-remote-shade={shade}
                                style={handoffOpacity ? { opacity: handoffOpacity } : undefined}
                            >
                                <div className="remote-song__cardtitle">{face.title}</div>
                                {face.artist && <div className="remote-song__cardartist">{face.artist}</div>}
                            </motion.div>
                        )}
                    </motion.div>
                );
            })}
        </AnimatePresence>
    );

    return (
        <div className="remote-song" data-mode={mode}>
            {/* Not under the transparent background's shade: large, it carries its own shadow. */}
            <div className="remote-cover">
                {!handoff.currentCoverUrl && <div className="remote-cover__blank">F</div>}
                <RemoteCoverFaces handoff={handoff} imageClassName="remote-cover__image" reduceMotion={reduceMotion} />
            </div>
            <div className="remote-song__line" aria-hidden={mode !== 'line'}>{renderFaces('line')}</div>
            <div className="remote-song__card" aria-hidden={mode !== 'card'}>{renderFaces('card')}</div>
        </div>
    );
};

export default RemoteSongLine;
