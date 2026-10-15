import React from 'react';
import { cn, fuzzyMatch } from '@/lib/utils';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useChatSessionSelection } from './chatColumnSession';
import { selectCommandsForDirectory, useCommandsStore } from '@/stores/useCommandsStore';
import { selectSkillsForDirectory, useSkillsStore } from '@/stores/useSkillsStore';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { Icon } from "@/components/icon/Icon";
import { useI18n } from '@/lib/i18n';
import { useUIStore } from '@/stores/useUIStore';
import { isVSCodeRuntime } from '@/lib/desktop';
import { useMobileAutocompleteMaxHeight } from './useMobileAutocompleteMaxHeight';
import { commandMatchesSearch, mergeCommandAutocompleteItems } from './commandAutocompleteItems';
import { useGuestCommands } from '@/hooks/useGuestSurfaces';
import { AutocompleteRowTooltip } from './composer/ui/AutocompleteRowTooltip';

type CommandSource = 'alcode' | 'opencode' | 'skill' | 'extension';

export interface CommandInfo {
  id: string;
  name: string;
  source: CommandSource;
  description?: string;
  searchAliases?: string[];
  agent?: string;
  model?: string;
  isBuiltIn?: boolean;
  isAlcode?: boolean;
  isSkill?: boolean;
  scope?: string;
  /** Name of the extension that contributed the command; shown as its badge. */
  extensionName?: string;
}

// Every name the composer runs itself; an extension command with one of
// these names is dropped before it reaches the list.
const LOCAL_COMMAND_NAMES = [
  'init', 'review', 'undo', 'redo', 'timeline', 'compact', 'fork', 'btw', 'summary', 'workspace-review', 'handoff-review',
  'plan-feature', 'craft-goal', 'schedule-task', 'catch-up', 'debug', 'weigh', 'explore',
];

/**
 * Namespace prefixes accepted before a command name (`/alcode:btw`,
 * `/openchamber:btw`). The `openchamber:` twin is the pre-rename form and stays
 * resolvable; both map to the same command. Matching strips the prefix (see
 * `normalizeCommandSearchQuery`), so either spelling surfaces the command.
 */
export const COMMAND_NAMESPACE_ALIASES = {
  'alcode:': 'alcode:',
  'openchamber:': 'alcode:',
} as const;

/** Strip a leading `alcode:`/`openchamber:` namespace from a typed query. */
export const normalizeCommandSearchQuery = (query: string): string => {
  const lower = query.toLowerCase();
  for (const prefix of Object.keys(COMMAND_NAMESPACE_ALIASES)) {
    if (lower.startsWith(prefix)) return query.slice(prefix.length);
  }
  return query;
};

export interface CommandAutocompleteHandle {
  handleKeyDown: (key: string) => void;
}

const BASE_BADGE_CLASS = "text-[10px] leading-none uppercase font-bold tracking-tight px-1.5 py-1 rounded border flex-shrink-0";
const TYPE_BADGE_CLASS = cn(
  BASE_BADGE_CLASS,
  "bg-[color-mix(in_srgb,var(--primary-base)_12%,transparent)] text-[color-mix(in_srgb,var(--primary-base)_70%,transparent)] border-[color-mix(in_srgb,var(--primary-base)_24%,transparent)]"
);
const USER_BADGE_CLASS = cn(
  BASE_BADGE_CLASS,
  "bg-[color-mix(in_srgb,var(--status-success)_12%,transparent)] text-[color-mix(in_srgb,var(--status-success)_70%,transparent)] border-[color-mix(in_srgb,var(--status-success)_24%,transparent)]"
);
const PROJECT_BADGE_CLASS = cn(
  BASE_BADGE_CLASS,
  "bg-[color-mix(in_srgb,var(--status-info)_12%,transparent)] text-[color-mix(in_srgb,var(--status-info)_70%,transparent)] border-[color-mix(in_srgb,var(--status-info)_24%,transparent)]"
);
const NEUTRAL_BADGE_CLASS = cn(
  BASE_BADGE_CLASS,
  "bg-[var(--surface-muted)] text-muted-foreground border-[var(--interactive-border)]/60"
);

interface CommandAutocompleteProps {
  searchQuery: string;
  onCommandSelect: (command: CommandInfo) => void;
  onClose: () => void;
  style?: React.CSSProperties;
}

export const CommandAutocomplete = React.forwardRef<CommandAutocompleteHandle, CommandAutocompleteProps>(({
  searchQuery,
  onCommandSelect,
  onClose,
  style,
}, ref) => {
  const { t } = useI18n();
  const currentSessionId = useChatSessionSelection().sessionId;
  const hasSession = Boolean(currentSessionId);
  const hasNewSessionDraft = useSessionUIStore((state) => Boolean(state.newSessionDraft?.open));
  const canStartSessionCommand = hasSession || hasNewSessionDraft;
  const isMobile = useUIStore((state) => state.isMobile);
  const canUseReviewHandoffFlow = hasSession && !isMobile && !isVSCodeRuntime();

  const [commands, setCommands] = React.useState<CommandInfo[]>([]);
  const [loading, setLoading] = React.useState(false);
  // Commands and skills belong to the directory the composer sends to — the
  // session's own directory, or the Chats root for a chat draft — not to the
  // project the app was on last.
  const effectiveDirectory = useEffectiveDirectory();
  const commandsWithMetadata = useCommandsStore((s) => selectCommandsForDirectory(s, effectiveDirectory));
  const loadCommandsForDirectory = useCommandsStore((s) => s.loadCommands);
  const skills = useSkillsStore((s) => selectSkillsForDirectory(s, effectiveDirectory));
  const loadSkillsForDirectory = useSkillsStore((s) => s.loadSkills);
  const refreshCommands = React.useCallback(() => loadCommandsForDirectory(effectiveDirectory), [effectiveDirectory, loadCommandsForDirectory]);
  const refreshSkills = React.useCallback(() => loadSkillsForDirectory(effectiveDirectory), [effectiveDirectory, loadSkillsForDirectory]);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const selectedIndexRef = React.useRef(0);
  const keyboardNavigationRef = React.useRef(false);
  const itemRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mobileMaxHeight = useMobileAutocompleteMaxHeight(containerRef, true);
  const ignoreClickRef = React.useRef(false);
  const pointerStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const pointerMovedRef = React.useRef(false);

  React.useEffect(() => {
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target || !containerRef.current) {
        return;
      }
      if (containerRef.current.contains(target)) {
        return;
      }
      onClose();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [onClose]);

  React.useEffect(() => {
    // Force refresh to get latest project context when mounting
    void refreshCommands();
    void refreshSkills();
  }, [refreshCommands, refreshSkills]);

  const reservedCommandNames = React.useMemo(() => {
    const names = new Set<string>(LOCAL_COMMAND_NAMES);
    for (const command of commandsWithMetadata) names.add(command.name.toLowerCase());
    for (const skill of skills) names.add(skill.name.toLowerCase());
    return names;
  }, [commandsWithMetadata, skills]);
  const guestCommands = useGuestCommands(reservedCommandNames);

  React.useEffect(() => {
    const loadCommands = async () => {
      setLoading(true);
      try {
        const skillNames = new Set(skills.map((skill) => skill.name));
        const customCommands: CommandInfo[] = commandsWithMetadata.map((cmd, index) => ({
          id: `opencode:${cmd.scope ?? 'global'}:${cmd.name}:${cmd.agent ?? ''}:${cmd.model ?? ''}:${index}`,
          name: cmd.name,
          source: 'opencode',
          description: cmd.description,
          agent: cmd.agent ?? undefined,
          model: cmd.model ?? undefined,
          isBuiltIn: cmd.name === 'init' || cmd.name === 'review',
          isSkill: cmd.source === 'skill' || skillNames.has(cmd.name),
          scope: cmd.scope,
        }));
        const skillCommands: CommandInfo[] = skills.map((skill, index) => ({
          id: `skill:${skill.scope}:${skill.source ?? 'opencode'}:${skill.name}:${index}`,
          name: skill.name,
          source: 'skill',
          description: skill.description,
          isSkill: true,
          scope: skill.scope,
        }));

        const builtInCommands: CommandInfo[] = [
          ...(hasSession
            ? [{ id: 'alcode:init', name: 'init', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.initDescription'), isBuiltIn: true }]
            : []
          ),
          ...(hasSession  // Show when session exists, not when hasMessages
            ? [
                { id: 'alcode:undo', name: 'undo', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.undoDescription'), isBuiltIn: true },
                { id: 'alcode:redo', name: 'redo', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.redoDescription'), isBuiltIn: true },
                { id: 'alcode:timeline', name: 'timeline', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.timelineDescription'), isBuiltIn: true },
                { id: 'alcode:compact', name: 'compact', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.compactDescription'), isBuiltIn: true },
              ]
            : []
          ),
          ...(hasSession
            ? [{ id: 'alcode:btw', name: 'btw', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.btwDescription'), isAlcode: true }]
            : []
          ),
          ...(hasSession
            ? [{ id: 'alcode:fork', name: 'fork', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.forkDescription'), isAlcode: true }]
            : []
          ),
          ...(hasSession
            ? [{ id: 'alcode:summary', name: 'summary', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.summaryDescription'), isAlcode: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'alcode:workspace-review', name: 'workspace-review', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.workspaceReviewDescription'), isAlcode: true }]
            : []
          ),
          ...(canUseReviewHandoffFlow
            ? [{ id: 'alcode:handoff-review', name: 'handoff-review', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.handoffReviewDescription'), isAlcode: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'alcode:plan-feature', name: 'plan-feature', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.featurePlanDescription'), isAlcode: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'alcode:craft-goal', name: 'craft-goal', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.craftGoalDescription'), isAlcode: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'alcode:schedule-task', name: 'schedule-task', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.scheduleTaskDescription'), isAlcode: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'alcode:catch-up', name: 'catch-up', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.catchUpDescription'), isAlcode: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'alcode:debug', name: 'debug', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.debugDescription'), isAlcode: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'alcode:weigh', name: 'weigh', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.weighDescription'), isAlcode: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'alcode:explore', name: 'explore', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.exploreDescription'), isAlcode: true }]
            : []
          ),
        ];
        const extensionCommands: CommandInfo[] = guestCommands.map((entry) => ({
          id: `extension:${entry.guestId}:${entry.command.name}`,
          name: entry.command.name,
          source: 'extension',
          description: entry.command.description,
          extensionName: entry.guestName,
        }));
        const allCommands = [
          ...mergeCommandAutocompleteItems(builtInCommands, customCommands, skillCommands),
          ...extensionCommands,
        ];

        // Either namespace spelling (`/alcode:btw`, `/openchamber:btw`) matches
        // the same command; the prefix is not part of the command name.
        const effectiveQuery = normalizeCommandSearchQuery(searchQuery);
        const filtered = effectiveQuery
          ? allCommands.filter(cmd => commandMatchesSearch(cmd, effectiveQuery))
          : allCommands;

        filtered.sort((a, b) => {
          const aStartsWith = a.name.toLowerCase().startsWith(effectiveQuery.toLowerCase());
          const bStartsWith = b.name.toLowerCase().startsWith(effectiveQuery.toLowerCase());
          if (aStartsWith && !bStartsWith) return -1;
          if (!aStartsWith && bStartsWith) return 1;
          return a.name.localeCompare(b.name);
        });

        setCommands(filtered);
      } catch {

        const builtInCommands: CommandInfo[] = [
          ...(hasSession
            ? [{ id: 'alcode:init', name: 'init', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.initDescription'), isBuiltIn: true }]
            : []
          ),
          ...(hasSession  // Show when session exists, not when hasMessages
            ? [
                { id: 'alcode:undo', name: 'undo', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.undoDescription'), isBuiltIn: true },
                { id: 'alcode:redo', name: 'redo', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.redoDescription'), isBuiltIn: true },
                { id: 'alcode:timeline', name: 'timeline', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.timelineDescription'), isBuiltIn: true },
              ]
            : []
          ),
          { id: 'alcode:compact', name: 'compact', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.compactDescription'), isBuiltIn: true },
          ...(hasSession
            ? [{ id: 'alcode:btw', name: 'btw', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.btwDescription'), isAlcode: true }]
            : []
          ),
          ...(hasSession
            ? [{ id: 'alcode:fork', name: 'fork', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.forkDescription'), isAlcode: true }]
            : []
          ),
          ...(hasSession
            ? [{ id: 'alcode:summary', name: 'summary', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.summaryDescription'), isAlcode: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'alcode:workspace-review', name: 'workspace-review', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.workspaceReviewDescription'), isAlcode: true }]
            : []
          ),
          ...(canUseReviewHandoffFlow
            ? [{ id: 'alcode:handoff-review', name: 'handoff-review', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.handoffReviewDescription'), isAlcode: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'alcode:plan-feature', name: 'plan-feature', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.featurePlanDescription'), isAlcode: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'alcode:craft-goal', name: 'craft-goal', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.craftGoalDescription'), isAlcode: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'alcode:schedule-task', name: 'schedule-task', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.scheduleTaskDescription'), isAlcode: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'alcode:catch-up', name: 'catch-up', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.catchUpDescription'), isAlcode: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'alcode:debug', name: 'debug', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.debugDescription'), isAlcode: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'alcode:weigh', name: 'weigh', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.weighDescription'), isAlcode: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'alcode:explore', name: 'explore', source: 'alcode' as const, description: t('chat.commandAutocomplete.command.exploreDescription'), isAlcode: true }]
            : []
          ),
        ];

        const effectiveQuery = normalizeCommandSearchQuery(searchQuery);
        const filtered = effectiveQuery
          ? builtInCommands.filter(cmd =>
              fuzzyMatch(cmd.name, effectiveQuery) ||
              (cmd.description && fuzzyMatch(cmd.description, effectiveQuery))
            )
          : builtInCommands;

        setCommands(filtered);
      } finally {
        setLoading(false);
      }
    };

    loadCommands();
  }, [searchQuery, hasSession, canStartSessionCommand, canUseReviewHandoffFlow, commandsWithMetadata, guestCommands, skills, t]);

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [commands]);

  React.useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  React.useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({
      block: 'nearest'
    });
  }, [selectedIndex]);

  React.useImperativeHandle(ref, () => ({
    handleKeyDown: (key: string) => {
      const total = commands.length;
      if (key === 'Escape') {
        onClose();
        return;
      }

      if (total === 0) {
        return;
      }

      if (key === 'ArrowDown') {
        keyboardNavigationRef.current = true;
        setSelectedIndex((prev) => (prev + 1) % total);
        return;
      }

      if (key === 'ArrowUp') {
        keyboardNavigationRef.current = true;
        setSelectedIndex((prev) => (prev - 1 + total) % total);
        return;
      }

      if (key === 'Enter' || key === 'Tab') {
        const safeIndex = ((selectedIndexRef.current % total) + total) % total;
        const command = commands[safeIndex];
        if (command) {
          onCommandSelect(command);
        }
      }
    }
  }), [commands, onClose, onCommandSelect]);

  const getCommandIcon = (command: CommandInfo) => {

    switch (command.name) {
      case 'init':
        return <Icon name="file" className="h-3.5 w-3.5 text-muted-foreground" />;
      case 'undo':
        return <Icon name="arrow-go-back" className="h-3.5 w-3.5 text-muted-foreground" />;
      case 'redo':
        return <Icon name="arrow-go-forward" className="h-3.5 w-3.5 text-muted-foreground" />;
      case 'timeline':
        return <Icon name="time" className="h-3.5 w-3.5" />;
      case 'compact':
        return <Icon name="scissors" className="h-3.5 w-3.5 text-muted-foreground" />;
      case 'review':
        return <Icon name="search-eye" className="h-3.5 w-3.5 text-muted-foreground" />;
      case 'test':
      case 'build':
      case 'run':
        return <Icon name="terminal-box" className="h-3.5 w-3.5 text-cyan-500" />;
      default:
        if (command.isBuiltIn) {
          return <Icon name="flashlight" className="h-3.5 w-3.5 text-muted-foreground" />;
        }
        if (command.source === 'extension') {
          return <Icon name="window" className="h-3.5 w-3.5 text-muted-foreground" />;
        }
        return <Icon name="command" className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  return (
    <div
      ref={containerRef}
      className="absolute z-[100] min-w-0 w-full max-w-[450px] max-h-64 oc-glass-popover border-2 border-border/60 rounded-xl shadow-none bottom-full mb-2 left-0 flex flex-col"
      style={mobileMaxHeight !== undefined ? { ...style, maxHeight: mobileMaxHeight } : style}
    >
      <ScrollableOverlay preventOverscroll outerClassName="flex-1 min-h-0" className="px-0 pb-2">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Icon name="refresh" className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div>
            {commands.map((command, index) => {
              const isSystem = command.isBuiltIn;
              const isAlcodeBadge = command.isAlcode;
              return (
                <AutocompleteRowTooltip description={command.description} active={!isMobile && index === selectedIndex}>
                <div
                  key={command.id}
                  ref={(el) => { itemRefs.current[index] = el; }}
                  className={cn(
                    "flex gap-2 px-3 py-2 cursor-pointer rounded-lg",
                    isMobile ? "items-center" : "items-start",
                    index === selectedIndex && "bg-interactive-selection"
                  )}
                  // Block the focus transfer the tap would perform: the textarea
                  // must stay focused so selecting a command doesn't dismiss the
                  // soft keyboard (the blur raced the keyboard-hide trigger and
                  // won against the deferred refocus).
                  onMouseDown={(event) => event.preventDefault()}
                  onPointerDown={(event) => {
                    if (event.pointerType !== 'touch') {
                      return;
                    }
                    pointerStartRef.current = { x: event.clientX, y: event.clientY };
                    pointerMovedRef.current = false;
                  }}
                  onPointerMove={(event) => {
                    if (event.pointerType !== 'touch' || !pointerStartRef.current) {
                      return;
                    }
                    const dx = event.clientX - pointerStartRef.current.x;
                    const dy = event.clientY - pointerStartRef.current.y;
                    if (Math.hypot(dx, dy) > 6) {
                      pointerMovedRef.current = true;
                    }
                  }}
                  onPointerUp={(event) => {
                    if (event.pointerType !== 'touch') {
                      return;
                    }
                    const didMove = pointerMovedRef.current;
                    pointerStartRef.current = null;
                    pointerMovedRef.current = false;
                    if (didMove) {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    ignoreClickRef.current = true;
                    onCommandSelect(command);
                  }}
                  onPointerCancel={() => {
                    pointerStartRef.current = null;
                    pointerMovedRef.current = false;
                  }}
                  onClick={() => {
                    if (ignoreClickRef.current) {
                      ignoreClickRef.current = false;
                      return;
                    }
                    onCommandSelect(command);
                  }}
                  onMouseMove={() => {
                    keyboardNavigationRef.current = false;
                    setSelectedIndex(index);
                  }}
                >
                  <div className={cn(!isMobile && "mt-0.5")}>
                    {getCommandIcon(command)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="typography-ui-label font-medium">/{command.name}</span>
                      {command.isSkill ? (
                        <span className={TYPE_BADGE_CLASS}>
                          {t('chat.commandAutocomplete.badge.skill')}
                        </span>
                      ) : (
                        <span className={TYPE_BADGE_CLASS}>
                          {t('chat.commandAutocomplete.badge.command')}
                        </span>
                      )}
                      {command.extensionName ? (
                        <span className={NEUTRAL_BADGE_CLASS}>
                          {command.extensionName}
                        </span>
                      ) : isAlcodeBadge ? (
                        <span className={NEUTRAL_BADGE_CLASS}>
                          Alcode
                        </span>
                      ) : isSystem ? (
                        <span className={NEUTRAL_BADGE_CLASS}>
                          {t('chat.commandAutocomplete.badge.system')}
                        </span>
                      ) : command.scope ? (
                        <span className={command.scope === 'project' ? PROJECT_BADGE_CLASS : USER_BADGE_CLASS}>
                          {command.scope}
                        </span>
                      ) : null}
                      {command.agent && (
                        <span className={NEUTRAL_BADGE_CLASS}>
                          {command.agent}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                </AutocompleteRowTooltip>
              );
            })}
            {commands.length === 0 && (
              <div className="px-3 py-2 typography-ui-label text-muted-foreground">
                {t('chat.commandAutocomplete.empty')}
              </div>
            )}
          </div>
        )}
      </ScrollableOverlay>
      {!isMobile && (
        <div className="px-3 pt-1 pb-1.5 border-t typography-meta text-muted-foreground">
          {t('chat.autocomplete.keyboardHint')}
        </div>
      )}
    </div>
  );
});

CommandAutocomplete.displayName = 'CommandAutocomplete';
