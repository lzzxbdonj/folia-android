import React, { useState } from 'react';
import { Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { getVisualizerModeLabel } from '../../../visualizer/registry';
import { isAndroidAiAvailable } from '../../../../services/androidAi';
import { applyScreenOrientation, getStoredScreenOrientation, type ScreenOrientationMode } from '../../../../services/androidDisplay';
import { isAndroidRuntime } from '../../../../services/androidRuntime';
import { usePlayerChromeSettingsStore } from '../../../../stores/usePlayerChromeSettingsStore';
import { openSettings } from '../../../../stores/useSettingsModalStore';
import { useThemeSettingsStore } from '../../../../stores/useThemeSettingsStore';
import { useVisualizerSettingsStore } from '../../../../stores/useVisualizerSettingsStore';
import { openAIEndpointOf } from '../../../../utils/openAIEndpoint';
import { Button, FoldedGroup, Group, NumberField, Reveal, Row, Segmented, Select, TextField, Toggle, Value, option, parseNumberText, type SettingsGroupDef, type SettingsOptionDef } from '../kit';
import { settingsAnchorSubview } from '../navigation/settingsAnchorModel';
import { AiConnectionTestReply, useAiConnectionTest } from './AiConnectionTest';
import { useSettingsPage, type AiApiKeyName } from './settingsPageContext';

// src/components/modal/settings/pages/AppearancePage.tsx
// The 外观 page: which lyric animation the player uses, light or dark, the colour theme, how a
// song's own theme is made and applied, and (desktop app) the AI provider that makes those themes.
// The lyric animation workbench and the theme colour editor are the existing overlays; their rows
// here only open them.

const LYRICS: SettingsGroupDef = { id: 'lyricsRenderer', titleKey: 'options.lyricsRenderer' };
const THEME: SettingsGroupDef = { id: 'themePresets', titleKey: 'options.settingsHeadingTheme' };
const SONG_THEME: SettingsGroupDef = { id: 'songTheme', titleKey: 'options.settingsHeadingSongTheme' };
// Phone-only shell options: the Android build is the one place where the app
// owns the window and can therefore decide its own orientation.
const ANDROID: SettingsGroupDef = { id: 'androidShell', titleKey: 'options.androidShell' };
// Shown wherever a model can be configured: the desktop main process, or the
// packaged runtime on Android (src/services/androidSettingsHost.ts).
const AI: SettingsGroupDef = { id: 'electronSettings', titleKey: 'options.electronSettings' };

// Base URLs a self-hosted build is most often pointed at. Names are brand names,
// so they stay untranslated; only the picker's own labels go through i18n.
const AI_PRESETS = [
    { id: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { id: 'deepseek', label: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    { id: 'moonshot', label: 'Kimi (Moonshot)', url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
    { id: 'zhipu', label: '智谱 GLM', url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    { id: 'siliconflow', label: 'SiliconFlow', url: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
    { id: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
] as const;

const O = {
    lyricsAnimation: option(LYRICS, 'lyricsAnimationAdjust', 'options.lyricsAnimationAdjust'),
    daylight: option(THEME, 'daylightMode', 'options.daylightMode'),
    preset: option(THEME, 'themePreset', 'options.themePresets'),
    themePark: option(THEME, 'openThemePark', 'options.openThemePark'),
    autoSwitch: option(SONG_THEME, 'autoSwitchSongTheme', 'options.autoSwitchSongTheme'),
    autoGenerate: option(SONG_THEME, 'autoGenerateSongTheme', 'options.autoGenerateSongTheme'),
    source: option(SONG_THEME, 'themeGenerationSource', 'options.themeGenerationSource'),
    preferCustom: option(SONG_THEME, 'preferCustomTheme', 'options.preferCustomTheme'),
    aiProvider: option(AI, 'aiProvider', 'options.aiProvider'),
    geminiKey: option(AI, 'geminiApiKey', 'options.geminiApiKey'),
    openaiUrl: option(AI, 'openaiApiUrl', 'options.openaiApiUrl'),
    openaiModel: option(AI, 'openaiApiModel', 'options.openaiApiModel'),
    openaiTemperature: option(AI, 'openaiApiTemperature', 'options.openaiApiTemperature'),
    openaiStream: option(AI, 'openaiApiStream', 'options.openaiApiStream'),
    openaiKey: option(AI, 'openaiApiKey', 'options.openaiApiKey'),
    aiPreset: option(AI, 'aiPreset', 'options.aiPreset'),
    aiProxy: option(AI, 'useSystemProxyAI', 'options.useSystemProxyAI'),
    orientation: option(ANDROID, 'androidScreenOrientation', 'options.androidScreenOrientation'),
};

export const OPTIONS: SettingsOptionDef[] = Object.values(O);

type DaylightChoice = 'light' | 'dark' | 'system';

type AiKeyFieldProps = {
    /** The draft of a replacement key. */
    value: string;
    onChange: (value: string) => void;
    saved: boolean;
    onClear: () => void;
    placeholder?: string;
};

/** A provider key. A saved key is never shown: the field stays empty, typing replaces it on save, and Clear removes it at once. */
const AiKeyField: React.FC<AiKeyFieldProps> = ({ value, onChange, saved, onClear, placeholder }) => {
    const { t } = useTranslation();
    return (
        <span className="flex min-w-0 items-center gap-2">
            <TextField type="password" value={value} onChange={onChange} placeholder={saved ? t('options.aiApiKeySavedPlaceholder') : placeholder} />
            {saved && <Button onClick={onClear}>{t('options.aiApiKeyClear')}</Button>}
        </span>
    );
};

const AppearancePage: React.FC = () => {
    const { t } = useTranslation();
    const { isElectron, themeControls, onOpenVisPlayground, onOpenThemePark, viewProps } = useSettingsPage();
    const { electronSettings, setElectronSettings, onSaveElectronSettings, electronSaveStatus, savedAiApiKeys, savedOpenAIKeyEndpoint, onClearAiApiKey } = viewProps.desktop.model;
    const { isDaylight, followSystemTheme, setDaylightPreference, setFollowSystemTheme } = useThemeSettingsStore(useShallow(state => ({
        isDaylight: state.isDaylight,
        followSystemTheme: state.followSystemTheme,
        setDaylightPreference: state.setDaylightPreference,
        setFollowSystemTheme: state.setFollowSystemTheme,
    })));
    const visualizerMode = useVisualizerSettingsStore(state => state.visualizerMode);
    const nativeBlurEnabled = usePlayerChromeSettingsStore(state => state.enablePlayerPageNativeBlur);
    const isAndroid = isAndroidRuntime();
    const [orientation, setOrientation] = useState<ScreenOrientationMode>(getStoredScreenOrientation);
    // Only a picker position; the URL and model it fills in are the real state.
    const [aiPreset, setAiPreset] = useState('');

    const usesOpenAi = electronSettings.AI_PROVIDER === 'openai';
    const aiTest = useAiConnectionTest(usesOpenAi
        ? {
            provider: 'openai',
            apiKey: electronSettings.OPENAI_API_KEY || '',
            apiUrl: electronSettings.OPENAI_API_URL || '',
            model: electronSettings.OPENAI_API_MODEL || '',
            stream: electronSettings.OPENAI_API_STREAM === true,
            useSystemProxy: electronSettings.USE_SYSTEM_PROXY_FOR_AI === true,
        }
        : {
            provider: 'gemini',
            apiKey: electronSettings.GEMINI_API_KEY || '',
            useSystemProxy: electronSettings.USE_SYSTEM_PROXY_FOR_AI === true,
        }, usesOpenAi ? savedAiApiKeys.OPENAI_API_KEY : savedAiApiKeys.GEMINI_API_KEY);
    const setAi = (patch: Partial<typeof electronSettings>) => setElectronSettings({ ...electronSettings, ...patch });
    const savedKeyHint = (key: AiApiKeyName) => (savedAiApiKeys[key] ? t('options.aiApiKeySavedDesc') : undefined);
    // The saved OpenAI-compatible key is sent only to the endpoint it was saved for: say so while the
    // URL in the form points elsewhere and no replacement key has been typed.
    const boundOpenAiEndpoint = savedOpenAIKeyEndpoint
        && !(electronSettings.OPENAI_API_KEY || '').trim()
        && openAIEndpointOf(electronSettings.OPENAI_API_URL) !== savedOpenAIKeyEndpoint
        ? savedOpenAIKeyEndpoint
        : null;

    return (
        <>
            {isAndroid && (
                <Group def={ANDROID}>
                    <Row option={O.orientation} note={t('options.androidScreenOrientationDesc')}>
                        <Segmented<ScreenOrientationMode>
                            value={orientation}
                            options={[
                                { value: 'auto', label: t('options.androidOrientationAuto') },
                                { value: 'portrait', label: t('options.androidOrientationPortrait') },
                                { value: 'landscape', label: t('options.androidOrientationLandscape') },
                            ]}
                            onChange={(mode) => {
                                setOrientation(mode);
                                void applyScreenOrientation(mode);
                            }}
                        />
                    </Row>
                </Group>
            )}

            <Group def={LYRICS} bare>
                {nativeBlurEnabled && <Row notice={t('options.nativeBlurBackgroundNotice')} />}
                <Row option={O.lyricsAnimation} hint={t('options.lyricsRendererDesc')} onClick={onOpenVisPlayground}>
                    <Value>{getVisualizerModeLabel(visualizerMode, t)}</Value>
                </Row>
            </Group>

            <Group def={THEME}>
                <Row option={O.daylight} note={t('options.followSystemThemeDesc')}>
                    <Segmented<DaylightChoice>
                        value={followSystemTheme ? 'system' : isDaylight ? 'light' : 'dark'}
                        options={[
                            { value: 'light', label: t('options.daylightModeLight') },
                            { value: 'dark', label: t('options.daylightModeDark') },
                            { value: 'system', label: t('options.daylightModeSystem') },
                        ]}
                        onChange={(choice) => {
                            if (choice === 'system') {
                                setFollowSystemTheme(true);
                            } else {
                                // A light or dark picked by hand also stops following the system.
                                setDaylightPreference(choice === 'light');
                            }
                        }}
                    />
                </Row>
                <Row option={O.preset}>
                    <Segmented
                        value={themeControls.bgMode}
                        options={[
                            { value: 'default', label: t('options.themePresetsDefault') },
                            { value: 'custom', label: t('options.customTheme'), disabled: !themeControls.hasCustomTheme },
                        ]}
                        onChange={mode => (mode === 'custom' ? themeControls.onApplyCustomTheme() : themeControls.onApplyDefaultTheme())}
                    />
                </Row>
                <Row option={O.themePark} onClick={onOpenThemePark} />
            </Group>

            <Group def={SONG_THEME}>
                <Row option={O.autoSwitch} note={t('options.autoSwitchSongThemeDesc')}>
                    <Toggle checked={themeControls.songThemeAutoSwitchEnabled} onChange={themeControls.onToggleSongThemeAutoSwitch} />
                </Row>
                <Reveal when={themeControls.songThemeAutoSwitchEnabled}>
                    <Row
                        sub
                        option={O.autoGenerate}
                        note={t(themeControls.themeGenerationSource === 'cover' ? 'options.autoGenerateSongThemeCoverDesc' : 'options.autoGenerateSongThemeDesc')}
                    >
                        <Toggle checked={themeControls.songThemeAutoGenerateEnabled} onChange={themeControls.onToggleSongThemeAutoGenerate} />
                    </Row>
                </Reveal>
                <Row
                    option={O.source}
                    note={t(themeControls.themeGenerationSource === 'cover' ? 'options.themeGenerationSourceCoverDesc' : 'options.themeGenerationSourceAiDesc')}
                >
                    <Segmented
                        value={themeControls.themeGenerationSource}
                        options={[
                            { value: 'ai', label: t('options.themeGenerationSourceAi'), disabled: themeControls.aiApiKeyStatus !== 'configured' },
                            { value: 'cover', label: t('options.themeGenerationSourceCover') },
                        ]}
                        onChange={themeControls.onChangeThemeGenerationSource}
                    />
                </Row>
                <Reveal when={themeControls.aiApiKeyStatus === 'missing'}>
                    <Row sub notice={t('options.themeGenerationSourceAiUnavailable')}>
                        <Button onClick={() => openSettings('options', settingsAnchorSubview('electronSettings'), null, 'electronSettings')}>
                            {t('options.configureAiApiKey')}
                        </Button>
                    </Row>
                </Reveal>
                <Row option={O.preferCustom} hint={t('options.preferCustomThemeDesc')}>
                    <Toggle
                        checked={themeControls.isCustomThemePreferred}
                        onChange={themeControls.onToggleCustomThemePreferred}
                        disabled={!themeControls.hasCustomTheme}
                    />
                </Row>
            </Group>

            {(isElectron || isAndroidAiAvailable()) && (
                <FoldedGroup def={AI} summary={usesOpenAi ? t('options.otherCompatibleApi') : 'Google Gemini'}>
                    <Row notice={t('options.aiNotice')} />
                    <Row option={O.aiProvider}>
                        <Segmented
                            value={usesOpenAi ? 'openai' : 'gemini'}
                            options={[
                                { value: 'gemini', label: 'Google Gemini' },
                                { value: 'openai', label: t('options.otherCompatibleApi') },
                            ]}
                            onChange={provider => setAi({ AI_PROVIDER: provider })}
                        />
                    </Row>
                    <Reveal when={usesOpenAi}>
                        <Row option={O.aiPreset} note={t('options.aiPresetDesc')}>
                            <Select
                                value={aiPreset}
                                options={[
                                    { value: '', label: t('options.aiPresetPlaceholder') },
                                    ...AI_PRESETS.map(preset => ({ value: preset.id, label: preset.label })),
                                ]}
                                onChange={(id) => {
                                    setAiPreset(id);
                                    const preset = AI_PRESETS.find(candidate => candidate.id === id);
                                    // Filling both fields is the whole point: the key is the only
                                    // thing a person has to bring themselves.
                                    if (preset) setAi({ OPENAI_API_URL: preset.url, OPENAI_API_MODEL: preset.model });
                                }}
                            />
                        </Row>
                        <Row option={O.openaiUrl} note={t('options.openaiApiUrlDesc')}>
                            <TextField
                                value={electronSettings.OPENAI_API_URL || ''}
                                onChange={value => setAi({ OPENAI_API_URL: value })}
                                placeholder="https://api.openai.com/v1"
                            />
                        </Row>
                        <Row option={O.openaiModel} note={t('options.openaiApiModelDesc')}>
                            <TextField
                                value={electronSettings.OPENAI_API_MODEL || ''}
                                onChange={value => setAi({ OPENAI_API_MODEL: value })}
                                placeholder="gpt-4.1-mini"
                            />
                        </Row>
                        <Row option={O.openaiTemperature} hint={t('options.openaiApiTemperatureDesc')}>
                            {/* Kept as text in the settings file; an emptied field stands for the default. */}
                            <NumberField
                                value={parseNumberText(electronSettings.OPENAI_API_TEMPERATURE)}
                                onChange={value => setAi({ OPENAI_API_TEMPERATURE: value === null ? '' : String(value) })}
                                min={0}
                                max={2}
                                step={0.1}
                                placeholder="0.7"
                            />
                        </Row>
                        <Row option={O.openaiStream} note={t('options.openaiApiStreamDesc')}>
                            <Toggle
                                checked={electronSettings.OPENAI_API_STREAM === true}
                                onChange={enabled => setAi({ OPENAI_API_STREAM: enabled })}
                            />
                        </Row>
                        <Row
                            option={O.openaiKey}
                            hint={boundOpenAiEndpoint
                                ? t('options.aiApiKeyEndpointMismatchDesc', { endpoint: boundOpenAiEndpoint })
                                : savedKeyHint('OPENAI_API_KEY')}
                        >
                            <AiKeyField
                                value={electronSettings.OPENAI_API_KEY || ''}
                                onChange={value => setAi({ OPENAI_API_KEY: value })}
                                saved={savedAiApiKeys.OPENAI_API_KEY}
                                onClear={() => void onClearAiApiKey('OPENAI_API_KEY')}
                                placeholder="sk-..."
                            />
                        </Row>
                    </Reveal>
                    <Reveal when={!usesOpenAi}>
                        <Row option={O.geminiKey} hint={savedKeyHint('GEMINI_API_KEY')} note={t('options.geminiApiKeyDesc')}>
                            <AiKeyField
                                value={electronSettings.GEMINI_API_KEY || ''}
                                onChange={value => setAi({ GEMINI_API_KEY: value })}
                                saved={savedAiApiKeys.GEMINI_API_KEY}
                                onClear={() => void onClearAiApiKey('GEMINI_API_KEY')}
                            />
                        </Row>
                    </Reveal>
                    <Row option={O.aiProxy} hint={t('options.useSystemProxyAIDesc')}>
                        <Toggle
                            checked={electronSettings.USE_SYSTEM_PROXY_FOR_AI}
                            onChange={enabled => setAi({ USE_SYSTEM_PROXY_FOR_AI: enabled })}
                        />
                    </Row>
                    <Row below={aiTest.result && <AiConnectionTestReply result={aiTest.result} />}>
                        {electronSaveStatus === 'saved' && <Value>{t('options.settingsSaved')}</Value>}
                        <Button icon={Zap} tip={t('options.aiTestConnectionDesc')} onClick={() => void aiTest.run()} disabled={aiTest.running}>
                            {aiTest.running ? t('options.aiTestRunning') : t('options.aiTestConnection')}
                        </Button>
                        <Button variant="primary" onClick={() => void onSaveElectronSettings()} disabled={electronSaveStatus === 'saving'}>
                            {electronSaveStatus === 'saving' ? t('options.settingsSaving') : t('options.save')}
                        </Button>
                    </Row>
                </FoldedGroup>
            )}
        </>
    );
};

export default AppearancePage;
