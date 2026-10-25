/**
 * The places of isolated spaces in Settings (journey step 9, and decision 12): each
 * place with how many spaces run and stand stopped there, the disk its image, tools and spaces take,
 * the spaces whose container is gone, and "Clean up…", which removes what Alcode can make again.
 * The server decides what goes, see `places/docker-disk.js`; this screen only shows and asks.
 *
 * A place that cannot be reached says so and what to do, never a count of zero: the spaces this
 * window last saw are listed as out of reach, and nothing is when it saw none. Nothing polls, except
 * the disk while the host downloads the image, which "Download image" starts ahead of the first
 * space (journey step 0); "Try again" reads the place again. Rendered only while the switch is on
 * (decision 19).
 */

import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { Spinner } from '@/components/ui/spinner';
import { DockerSetupNotice } from '@/components/session/spaces/DockerSetupNotice';
import { SpaceRow } from '@/components/session/spaces/SpaceRow';
import { failureOfError, spaceFailureText } from '@/components/session/spaces/spaceFailureText';
import { Button } from '@/components/ui/button';

import { useI18n, type I18nKey } from '@/lib/i18n';
import { Input } from '@/components/ui/input';
import { reportSettingsSaveState } from '@/lib/persistence';
import { SSH_PLACE_ID, listSpacePlaces, setSpaceMachine, type SpaceEntry, type SpacePlace } from '@/lib/spaces/spaces-api';
import { refreshSpacesJourney, useSpacesJourneyRead } from '@/lib/spaces/spaces-store';

import { useUIStore } from '@/stores/useUIStore';
import { SettingsControlGroup, SettingsFieldRow } from '../shared/SettingsSection';


// Decimal units, as Docker and the Mac's own disk tools count; only the number is localised.


type Read<T> = { kind: 'reading' } | { kind: 'read'; value: T } | { kind: 'failed'; error: Error };

/**
 * Reads once when mounted and again on `retry`; a failure is kept apart, never read as empty.
 * `replace` and `fail` let a later read of the caller's own stand in for the last answer.
 */
const useRead = <T,>(load: (signal: AbortSignal) => Promise<T>): [Read<T>, () => void, (value: T) => void, (error: Error) => void] => {
  const [state, setState] = React.useState<Read<T>>({ kind: 'reading' });
  const [turn, setTurn] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'reading' });
    load(controller.signal).then(
      (value) => { if (!controller.signal.aborted) setState({ kind: 'read', value }); },
      (error: Error) => { if (!controller.signal.aborted) setState({ kind: 'failed', error }); },
    );
    return () => controller.abort();
  }, [load, turn]);
  const retry = React.useCallback(() => setTurn((current) => current + 1), []);
  const replace = React.useCallback((value: T) => setState({ kind: 'read', value }), []);
  const fail = React.useCallback((error: Error) => setState({ kind: 'failed', error }), []);
  return [state, retry, replace, fail];
};


// The places the host has, by the name the user knows them by; a place from a later version keeps its id.
const PLACE_NAMES: ReadonlyMap<string, I18nKey> = new Map<string, I18nKey>([['docker', 'settings.alcode.spaces.places.docker']]);

/** Whether a place runs Docker, whose version the block names. */

/**
 * The block of a place: what runs there, its disk, the spaces left behind; or, for one out of
 * reach, what to do and the spaces this window last saw, never a count of zero. `title` is the
 * block's own, and `field` sits above the rest: the machine's field, for the other machine.
 */
const PlaceBlock: React.FC<{ place: SpacePlace; title: string; field?: React.ReactNode; spaces: SpaceEntry[] | null; spacesError: Error | null; onRetry: () => void }> = ({ place, title, field = null, spaces, spacesError, onRetry }) => {
  const { t } = useI18n();
  const isMobile = useUIStore((state) => state.isMobile);
  const setupShown = Boolean(place.setup?.remedy || place.setup?.job);

  if (!place.available) {
    return (
      <SettingsControlGroup title={title}>
        <div className="space-y-2">
          {field}
          {setupShown ? (
            // This computer: the one action that gets Docker going, or the step to take, with its own "Check again".
            <DockerSetupNotice place={place} onRecheck={onRetry} withCheck />
          ) : (
            // What the user can do about it: one line with the info mark, as Settings' own notes read.
            <p className="flex items-start gap-1.5 typography-meta text-foreground" role="status">
              <Icon name="information" className="mt-[0.2em] h-3.5 w-3.5 shrink-0 text-[var(--status-info)]" />
              <span>{spaceFailureText(t, place, place.machine === null ? undefined : { machine: place.machine })}</span>
            </p>
          )}
          {spaces && spaces.length > 0 ? (
            <div className="space-y-1">
              <p className="typography-meta text-muted-foreground">
                {spaces.length === 1
                  ? t('settings.alcode.spaces.places.lastSeenSingle')
                  : t('settings.alcode.spaces.places.lastSeenPlural', { count: spaces.length })}
              </p>
              {spaces.map((entry) => (
                <div key={entry.id} className="flex items-center gap-2 opacity-60">
                  <Icon name="box-3" className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {/* A name from the label: text to show. */}
                  <span className="typography-ui-label truncate text-foreground">{entry.name}</span>
                </div>
              ))}
            </div>
          ) : null}
          <Button size="sm" variant="outline" onClick={onRetry}>{t('settings.alcode.spaces.places.retry')}</Button>
        </div>
      </SettingsControlGroup>
    );
  }

  const running = spaces?.filter((entry) => entry.state === 'running').length ?? 0;
  const stopped = spaces?.filter((entry) => entry.state === 'exited').length ?? 0;
  const gone = spaces?.filter((entry) => entry.state === 'missing') ?? [];
  // Which engine runs Docker here, when this computer's Docker said so.
  const engine = place.setup?.memory?.engine;
  const _dockerText = engine === 'colima'
    ? t('settings.openchamber.spaces.places.dockerRunningColima', { version: place.version })
    : engine === 'docker_desktop'
      ? t('settings.openchamber.spaces.places.dockerRunningDesktop', { version: place.version })
      : t('settings.openchamber.spaces.places.dockerRunning', { version: place.version });
  return (
    <SettingsControlGroup title={title}>
      <div className="space-y-2">
        {/* A product name and its version, the same in every language. */}
        {place.id === 'docker' && place.version ? <p className="typography-meta text-muted-foreground">{`Docker ${place.version}`}</p> : null}
        {spaces ? (
          <p className="typography-meta text-muted-foreground">{t('settings.alcode.spaces.places.counts', { running, stopped })}</p>
        ) : spacesError ? (
          <p className="typography-meta text-[var(--status-error)]">{t('spaces.page.loadFailed', { reason: spaceFailureText(t, failureOfError(spacesError)) })}</p>
        ) : null}
        {gone.length > 0 ? (
          <div className="space-y-1 pt-1">
            <p className="typography-ui-label text-foreground">{t('settings.alcode.spaces.places.leftBehind')}</p>
            {gone.map((entry) => <SpaceRow key={entry.id} entry={entry} actions={isMobile ? 'sheet' : 'menu'} showFolder />)}
          </div>
        ) : null}
      </div>
    </SettingsControlGroup>
  );
};

// The machine's field: what this window is doing with it, and the host's refusal when there was one.
type MachineState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'failed'; error: Error };

/**
 * The field of the other machine (journey step 0): an SSH destination, checked and kept by the
 * host when "Check" is pressed, which also brings the place up or, with the field empty, takes it
 * away. The host refuses to take it away or change it while spaces are on the machine, and the
 * refusal shows under the field. `machine` is what the host has now, null for no place.
 */
const MachineField: React.FC<{ machine: string | null; onChange: (place: SpacePlace | null) => void }> = ({ machine, onChange }) => {
  const { t } = useI18n();
  const [draft, setDraft] = React.useState(machine ?? '');
  const [state, setState] = React.useState<MachineState>({ kind: 'idle' });
  // The host's word replaces a draft that was never changed; one the user is typing stays.
  const [edited, setEdited] = React.useState(false);
  React.useEffect(() => {
    if (!edited) setDraft(machine ?? '');
  }, [edited, machine]);

  const save = async (value: string) => {
    setState({ kind: 'saving' });
    reportSettingsSaveState('saving');
    try {
      const place = await setSpaceMachine(value.trim());
      reportSettingsSaveState('saved');
      setState({ kind: 'idle' });
      setEdited(false);
      onChange(place);
    } catch (error) {
      reportSettingsSaveState('error');
      if (!(error instanceof Error)) throw error;
      setState({ kind: 'failed', error });
    }
  };
  const saving = state.kind === 'saving';
  const unchanged = draft.trim() === (machine ?? '');

  return (
    <div className="space-y-1">
      <SettingsFieldRow
        settingsItem="general.isolated-spaces-machine"
        label={t('settings.openchamber.spaces.places.machine.label')}
        info={t('settings.openchamber.spaces.places.machine.info')}
        alignEnd={false}
        // On a narrow pane the buttons go under the field rather than squeezing the name out of it.
        controlClassName="flex-wrap"
      >
        <Input
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setEdited(true); if (state.kind === 'failed') setState({ kind: 'idle' }); }}
          onKeyDown={(event) => { if (event.key === 'Enter' && !saving && !unchanged) { event.preventDefault(); void save(draft); } }}
          placeholder={t('settings.openchamber.spaces.places.machine.placeholder')}
          aria-label={t('settings.openchamber.spaces.places.machine.label')}
          className="h-8 min-w-[14rem] flex-1 max-w-[24rem] font-mono"
          autoComplete="off"
          spellCheck={false}
          disabled={saving}
        />
        <Button size="sm" variant="outline" className="shrink-0" disabled={saving || unchanged} onClick={() => void save(draft)}>
          {saving ? (
            <>
              <Spinner className="size-3.5" />
              {t('settings.openchamber.spaces.places.machine.checking')}
            </>
          ) : t('settings.openchamber.spaces.places.machine.check')}
        </Button>
        {machine !== null ? (
          <Button size="sm" variant="ghost" className="shrink-0 !font-normal" disabled={saving} onClick={() => void save('')}>
            {t('settings.openchamber.spaces.places.machine.remove')}
          </Button>
        ) : null}
      </SettingsFieldRow>
      {state.kind === 'failed' ? (
        <p className="typography-meta text-[var(--status-error)]" role="alert">{spaceFailureText(t, failureOfError(state.error))}</p>
      ) : null}
    </div>
  );
};

export const SpacePlacesSettings: React.FC = () => {
  const { t } = useI18n();
  const isMobile = useUIStore((state) => state.isMobile);
  const [places, retryPlaces, replacePlaces] = useRead(listSpacePlaces);
  const { journey, error: journeyError } = useSpacesJourneyRead();
  const spaces = journey ? Array.from(journey.values()) : null;
  const retry = () => {
    retryPlaces();
    void refreshSpacesJourney().catch(() => undefined);
  };
  // The machine changed: the host answered the place as it is now, or none; the list reads again
  // afterwards, since the spaces are routed by the new host.
  const machineChanged = (place: SpacePlace | null) => {
    if (places.kind !== 'read') return;
    const others = places.value.filter((candidate) => candidate.id !== SSH_PLACE_ID);
    replacePlaces(place ? [...others, place] : others);
    void refreshSpacesJourney().catch(() => undefined);
  };

  if (places.kind === 'reading') return <p className="typography-meta text-muted-foreground">{t('settings.alcode.spaces.places.reading')}</p>;
  if (places.kind === 'failed') {
    return (
      <div className="space-y-2">
        <p className="typography-meta text-[var(--status-error)]">{t('settings.alcode.spaces.places.readFailed', { reason: spaceFailureText(t, failureOfError(places.error)) })}</p>
        <Button size="sm" variant="outline" onClick={retry}>{t('settings.alcode.spaces.places.retry')}</Button>
      </div>
    );
  }
  const sshPlace = places.value.find((place) => place.id === SSH_PLACE_ID) ?? null;
  const field = <MachineField machine={sshPlace?.machine ?? null} onChange={machineChanged} />;
  const leftBehind = sshPlace ? [] : spaces?.filter((entry) => entry.placeId === SSH_PLACE_ID) ?? [];
  const titleOf = (place: SpacePlace) => {
    const nameKey = PLACE_NAMES.get(place.id);
    return place.machine ?? (nameKey ? t(nameKey) : place.id);
  };
  return (
    <div className="space-y-6">
      {places.value.map((place) => (
        <PlaceBlock
          key={place.id}
          place={place}
          title={titleOf(place)}
          field={place.id === SSH_PLACE_ID ? field : undefined}
          // Each block counts its own spaces; an unreachable one is listed by its block as last seen.
          spaces={spaces?.filter((entry) => entry.placeId === place.id) ?? null}
          spacesError={journeyError}
          onRetry={retry}
        />
      ))}
      {sshPlace ? null : (
        <SettingsControlGroup title={t('settings.openchamber.spaces.places.machine.title')}>
          <div className="space-y-2">
            {field}
            {/* Spaces recorded on a machine the file no longer names: unreachable, with the delete that forgets them. */}
            {leftBehind.length > 0 ? (
              <div className="space-y-1 pt-1">
                {leftBehind.map((entry) => <SpaceRow key={entry.id} entry={entry} actions={isMobile ? 'sheet' : 'menu'} showFolder />)}
              </div>
            ) : null}
          </div>
        </SettingsControlGroup>
      )}
    </div>
  );
};
