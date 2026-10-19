import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SheetButton } from '../shared/Sheet';
import ThemedDialog from '../shared/ThemedDialog';
import { settingsAnchorSubview } from './settings/navigation/settingsAnchorModel';
import { useAutomixSettingsStore } from '../../stores/useAutomixSettingsStore';
import { useSettingsModalStore } from '../../stores/useSettingsModalStore';

// src/components/modal/AutomixModelReminder.tsx
// The one interruption in the transition feature: switching blending on with no weights on disk.
//
// Mounted once at app level and self-contained, for the same reason AutomixTransitionAnimation is: it
// takes nothing from App.tsx and decides for itself whether it has anything to draw. Whether it SHOULD
// open is decided in the store, next to the switch it answers for - there are two of those switches, and
// a prompt wired to one component is missing from the other.
//
// Three buttons rather than two because "not now" and "never" are different answers, and a prompt that
// only offers the first will keep asking someone who has already decided. The download button opens the
// settings page and scrolls to the block rather than starting a download from here: two files, two
// mirrors each, and a progress bar that lives over there - starting one blind from a dialog would put the
// listener somewhere they cannot see it go wrong.

const AutomixModelReminder: React.FC<{ isDaylight: boolean }> = ({ isDaylight }) => {
    const { t } = useTranslation();
    const openSettings = useSettingsModalStore(state => state.openSettings);
    const { isOpen, dismiss } = useAutomixSettingsStore(useShallow(state => ({
        isOpen: state.isAutomixModelReminderOpen,
        dismiss: state.dismissAutomixModelReminder,
    })));

    if (!isOpen) return null;

    const goDownload = () => {
        dismiss(false);
        // Lands on the folded models group of the playback page: the settings open it and scroll to
        // it once it is on the page (it is drawn only in the desktop app, after its status loaded).
        openSettings('options', settingsAnchorSubview('automixModels'), null, 'automixModels');
    };

    return (
        <ThemedDialog
            isOpen
            onClose={() => dismiss(false)}
            isDaylight={isDaylight}
            title={t('options.modelReminderTitle')}
            description={t('options.modelReminderDesc')}
            // Left of the two dismissals and visually quieter than both: it is the answer
            // that cannot be taken back from this dialog, so it should not be the easy one.
            footerNote={(
                <button
                    type="button"
                    onClick={() => dismiss(true)}
                    className="st-t-fast rounded-md underline transition-colors hover:text-[color:var(--st-t1)]"
                >
                    {t('options.modelReminderNever')}
                </button>
            )}
            footer={(
                <>
                    <SheetButton onClick={() => dismiss(false)}>
                        {t('options.modelReminderLater')}
                    </SheetButton>
                    <SheetButton variant="primary" onClick={goDownload}>
                        <Download size={14} />
                        {t('options.modelReminderDownload')}
                    </SheetButton>
                </>
            )}
        />
    );
};

export default AutomixModelReminder;
