import React from 'react';
import { cn } from '@/lib/utils';
import { getToolMetadata } from '@/lib/toolHelpers';
import { normalizeToolName, type ExecuteToolCall } from '@/lib/opencode/tools';
import { getToolIcon } from './toolPresentation';

const ROW_TEXT_CLASS = '!text-[length:var(--text-meta)] !leading-5 sm:!leading-6 tracking-normal';

export interface ExecuteToolCallRowsProps {
    calls: ExecuteToolCall[];
}

const describeCallName = (call: ExecuteToolCall): string => {
    const metadata = getToolMetadata(call.tool);
    return metadata.displayName || normalizeToolName(call.tool);
};

const isFailedCall = (call: ExecuteToolCall): boolean => (call.status ?? '').toLowerCase() === 'error';

const ExecuteToolCallRows: React.FC<ExecuteToolCallRowsProps> = ({ calls }) => {
    if (calls.length === 0) return null;

    return (
        <div className="flex flex-col gap-0.5 ps-5" data-testid="execute-tool-calls">
            {calls.map((call, index) => {
                const failed = isFailedCall(call);
                return (
                    <div
                        // Calls carry no stable id on the wire, so the position inside
                        // one script is the only identity available for React's key.
                        key={`${call.tool}-${index}`}
                        className="flex min-w-0 items-center gap-1.5"
                        data-tool-call={normalizeToolName(call.tool)}
                        data-tool-status={call.status ?? ''}
                    >
                        <span className="relative h-3.5 w-3.5 flex-shrink-0 flex items-center justify-center">
                            {getToolIcon(normalizeToolName(call.tool))}
                        </span>
                        <span
                            className={cn('flex-shrink-0 typography-meta font-medium', ROW_TEXT_CLASS)}
                            style={failed ? { color: 'var(--status-error)' } : undefined}
                        >
                            {describeCallName(call)}
                        </span>
                        {call.input && (
                            <span
                                className={cn('min-w-0 truncate typography-meta', ROW_TEXT_CLASS)}
                                style={{ color: 'var(--tools-description)' }}
                                title={call.input}
                            >
                                {call.input}
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

ExecuteToolCallRows.displayName = 'ExecuteToolCallRows';

export default ExecuteToolCallRows;
