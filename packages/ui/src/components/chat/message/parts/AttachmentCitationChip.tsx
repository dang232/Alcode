import React from 'react';

import { FileTypeIcon } from '@/components/icons/FileTypeIcon';
import { INLINE_REFERENCE_CHIP_CLASS, INTERACTIVE_REFERENCE_CHIP_CLASS } from '@/lib/messages/inlineMessageLinks';

// Inline minimums opt out of the mobile 36px button floor.
const INLINE_BUTTON_STYLE = { minHeight: 0, minWidth: 0 };

const AttachmentCitationChip: React.FC<{ filename: string; openable: boolean }> = ({ filename, openable }) => {
    const content = (
        <>
            <FileTypeIcon filePath={filename} className="h-[1.1em] w-[1.1em]" />
            {filename}
        </>
    );
    if (!openable) {
        return <span className={INLINE_REFERENCE_CHIP_CLASS} title={filename}>{content}</span>;
    }
    // The surrounding message text opens the file by `data-attachment-open`.
    return (
        <button
            type="button"
            className={INTERACTIVE_REFERENCE_CHIP_CLASS}
            style={INLINE_BUTTON_STYLE}
            data-attachment-open={filename}
            title={filename}
        >
            {content}
        </button>
    );
};

export default AttachmentCitationChip;
