import React from 'react';

import { findAttachmentCitationRanges } from '../../attachmentCitations';
import AttachmentCitationChip from './AttachmentCitationChip';

/** A run of text, or an inline element drawn inside it. */
export type InlineTextNode = string | React.ReactElement;

/**
 * Splits plain text into runs and file chips for each `[name]` citation of
 * one of `filenames`. The React counterpart of the Markdown path, for text
 * that is not rendered as Markdown: plain-mode user messages and comments.
 * A chip is a button only where `isOpenable` says its file opens on click;
 * surfaces that open nothing (the composer, the queue, context blocks) leave
 * it out and get labels.
 */
export function withAttachmentChips(
    text: string,
    filenames: readonly string[],
    keyPrefix: string,
    isOpenable?: (filename: string) => boolean,
): InlineTextNode[] {
    if (filenames.length === 0) return [text];
    const ranges = findAttachmentCitationRanges(text, [...filenames]);
    if (ranges.length === 0) return [text];
    const nodes: InlineTextNode[] = [];
    let cursor = 0;
    for (const range of ranges) {
        if (range.start > cursor) nodes.push(text.slice(cursor, range.start));
        const filename = text.slice(range.start + 1, range.end - 1).trim();
        nodes.push(
            <AttachmentCitationChip
                key={`${keyPrefix}-${range.start}`}
                filename={filename}
                openable={isOpenable?.(filename) ?? false}
            />,
        );
        cursor = range.end;
    }
    if (cursor < text.length) nodes.push(text.slice(cursor));
    return nodes;
}
