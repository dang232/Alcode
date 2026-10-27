import React from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { UsageProgressBar } from '@/components/sections/usage/UsageProgressBar';
import { formatQuotaMoney, type AccountQuotaStatus } from './accountQuota';
import {
  entitlementMetricPercent,
  type AccountEntitlementsMetric,
  type AccountEntitlementsStatus,
} from './accountEntitlements';
import { formatPlanCap, type AccountPlanStatus } from './accountPlan';

// Reference account/usage surface inside the account popover. Composition:
//
// - plan: entitlements.plan when present, else the plan read. The name
//   renders verbatim — never mapped, never defaulted, never passed through
//   i18n — with the billing interval line and, only when the composed
//   subscription reports one, a micro/muted "Renews on {date}" line. A plan
//   NAME containing a word like "Unlimited" is data: it renders as-is and
//   never invents an unlimited badge or quota state. Only an explicit
//   plan-limit capValue null renders the Unlimited copy.
// - usage & quota: balance from entitlements.balance when present, else
//   status.quota.balance; cumulative usage always from
//   status.quota.usage (tokens, requests, cost). The status body owns the
//   account link state (loading, sign-in, expired, upstream_error,
//   session-only): the entitlements body never decides it, so an
//   entitlements upstream_error with linked plan+status still renders
//   plan + balance + usage. A failed plan read names "Plan unavailable"
//   and keeps balance/usage.
// - usage: one metric card per dimension the entitlements payload reports
//   (used / limit with a bar plus percent only from a finite limit above
//   zero). When it reports none, tokens/requests/cost render as used-only
//   cards — no denominator, no bar, no percent — with the missing-limits
//   note once for the section, not per card. A limit that is missing (or
//   not finite and positive) leaves the used value without a denominator,
//   bar, or percent. The balance card shows the available amount — a
//   genuine zero renders as the zero, never a limit and never a bar — with
//   a muted plan note only when the plan includes tokens or a credit exists.
// - plan limits (cap rows from the plan read) and provider windows stay
//   separate domains; provider windows live in AccountProviderLimits below,
//   which reads the existing useQuotaStore and is independent of the cards.
//
// The panel never prints the word as a quota state: a dimension without a
// rule is unconfigured, not unlimited — there is no unlimited marker on the
// entitlements wire, so the panel never prints the word except for the
// explicit plan-limit null marker.

const isFiniteAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const DAY_MS = 86_400_000;

interface MetricCardView {
  dimension: string;
  label: string;
  icon: 'stack' | 'pulse' | 'money-dollar-circle';
  tileClass: string;
  usedText: string;
  limitText: string | null;
  percent: number | null;
}

const RefreshButton: React.FC<{ isRefreshing: boolean; onRefresh: () => void }> = ({
  isRefreshing,
  onRefresh,
}) => {
  const { t } = useI18n();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      data-testid="account-quota-refresh"
      className="size-6 shrink-0 text-muted-foreground"
      onClick={() => onRefresh()}
      aria-label={t('settings.usage.sidebar.actions.refreshAria')}
      aria-busy={isRefreshing}
      title={t('settings.usage.sidebar.actions.refreshTitle')}
    >
      <Icon name="refresh" className={isRefreshing ? 'size-3.5 animate-spin' : 'size-3.5'} />
    </Button>
  );
};

const MetricCard: React.FC<{ card: MetricCardView }> = ({ card }) => {
  const { t } = useI18n();
  return (
    <div
      data-testid="account-metric-card"
      data-dimension={card.dimension}
      className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-[var(--surface-elevated)] p-2.5"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden
          className={`flex size-6 shrink-0 items-center justify-center rounded-md ${card.tileClass}`}
        >
          <Icon name={card.icon} className="size-3.5" />
        </span>
        <span className="typography-micro min-w-0 truncate text-muted-foreground">{card.label}</span>
      </div>
      <div className="typography-ui-label truncate font-semibold tabular-nums text-foreground">
        {card.limitText !== null ? `${card.usedText} / ${card.limitText}` : card.usedText}
      </div>
      {card.percent !== null ? (
        <div className="flex items-center gap-1.5">
          <UsageProgressBar percent={card.percent} tonePercent={card.percent} className="h-1.5 flex-1" />
          <span className="typography-micro shrink-0 tabular-nums text-muted-foreground">
            {t('header.account.providers.used', { percent: card.percent })}
          </span>
        </div>
      ) : null}
    </div>
  );
};

export const AccountQuotaSection: React.FC<{
  status: AccountQuotaStatus | null;
  /**
   * Live entitlements status from useAccountEntitlements. Null while the
   * first read is in flight (or not ready). When linked it owns plan,
   * metrics, balance, and portalBase; otherwise the panel falls back to the
   * plan and status reads below instead of hiding the account numbers.
   * `undefined` is the legacy caller that never passed entitlements: the
   * panel still renders plan + balance + usage from the other reads.
   */
  entitlements?: AccountEntitlementsStatus | null;
  /**
   * Live plan status from useAccountPlan. Null while the first read is in
   * flight (or not ready). Supplies the plan fallback (and its limits and
   * portalBase) when entitlements carries no plan.
   */
  plan?: AccountPlanStatus | null;
  onRefresh: () => void;
  /**
   * The renderer has no usable UI session, so no status read may run. That is a
   * client-known fact, not a quota state: the panel names the action (sign in)
   * instead of spinning on a request it is deliberately not making.
   */
  needsSession?: boolean;
  /** Identity shown in the header; the account state never depends on it. */
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  initials?: string;
  /** Wall-clock time of the last successful read; null until one lands. */
  lastUpdated?: number | null;
  /** True while a quota, plan, or entitlements read is in flight; drives the refresh affordance. */
  isRefreshing?: boolean;
}> = ({
  status,
  entitlements,
  plan: planStatus,
  onRefresh,
  needsSession = false,
  displayName = '',
  email = '',
  avatarUrl = '',
  initials = '',
  lastUpdated = null,
  isRefreshing = false,
}) => {
  const { t } = useI18n();
  const quotaState = status === null ? (needsSession ? 'unlinked' : 'loading') : status.link;
  const linked = status !== null && status.link === 'linked' ? status : null;
  const entLinked = entitlements !== undefined && entitlements !== null && entitlements.link === 'linked'
    ? entitlements
    : null;
  const planLinked = planStatus !== undefined && planStatus !== null && planStatus.link === 'linked'
    ? planStatus
    : null;

  const showRefresh = status !== null || entitlements !== undefined || planStatus !== undefined;

  // Plan composition: the entitlements plan wins when present, otherwise the
  // plan read. Both carry the open name verbatim — never translated, mapped,
  // or title-cased downstream.
  const planReady = planLinked !== null && planLinked.detail.state === 'ready'
    ? planLinked.detail.plan
    : null;
  const plan = entLinked?.plan ?? planReady;
  const subscription = entLinked?.subscription ?? planLinked?.subscription ?? null;
  // Balance composition: the entitlements balance wins when present,
  // otherwise the status quota balance. Usage totals always come from the
  // status quota body.
  const statusBalance = linked?.quota.balance ?? null;
  const balance = entLinked?.balance ?? statusBalance;
  const statusUsage = linked?.quota.usage ?? null;
  const composedPortalBase = entLinked?.portalBase ?? planLinked?.portalBase ?? null;
  const portalBase = composedPortalBase;

  const renewsAt = (() => {
    const raw: string | number | null | undefined = subscription?.currentPeriodEnd ?? null;
    if (raw === null || raw === undefined || raw === '') return null;
    const at = typeof raw === 'number' ? raw : Date.parse(raw);
    if (!Number.isFinite(at)) return null;
    return new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  })();

  const billedText = (() => {
    if (plan === null || plan === undefined) return '';
    if (plan.intervalCount === 1) {
      switch (plan.interval) {
        case 'day':
          return t('header.account.plan.billed.day');
        case 'week':
          return t('header.account.plan.billed.week');
        case 'month':
          return t('header.account.plan.billed.month');
        case 'year':
          return t('header.account.plan.billed.year');
      }
    }
    switch (plan.interval) {
      case 'day':
        return t('header.account.plan.billed.days', { count: plan.intervalCount });
      case 'week':
        return t('header.account.plan.billed.weeks', { count: plan.intervalCount });
      case 'month':
        return t('header.account.plan.billed.months', { count: plan.intervalCount });
      case 'year':
        return t('header.account.plan.billed.years', { count: plan.intervalCount });
    }
  })();

  const formatCount = (value: number): string => new Intl.NumberFormat(undefined).format(value);

  const usageCurrency = typeof statusUsage?.currency === 'string' ? statusUsage.currency : null;
  const balanceCurrencyForSpend = typeof balance?.currency === 'string' ? balance.currency : null;
  const spendCurrency = plan?.currency ?? balanceCurrencyForSpend ?? usageCurrency;

  const formatSpendMicros = (micros: number): string => {
    if (spendCurrency !== null && spendCurrency !== undefined) return formatQuotaMoney(micros, spendCurrency);
    return `${(micros / 1_000_000).toFixed(2)}`;
  };

  const toCard = (
    metric: AccountEntitlementsMetric | undefined,
    label: string,
    icon: MetricCardView['icon'],
    tileClass: string,
    formatUsed: (used: number) => string,
    formatLimit: (limit: number) => string,
  ): MetricCardView | null => {
    if (metric === undefined || !isFiniteAmount(metric.used)) return null;
    const percent = entitlementMetricPercent(metric);
    const limitValid = isFiniteAmount(metric.limit) && metric.limit > 0;
    return {
      dimension: metric.dimension,
      label,
      icon,
      tileClass,
      usedText: formatUsed(metric.used),
      limitText: limitValid ? formatLimit(metric.limit) : null,
      // The bar and the percent exist only with a real denominator: the
      // percent helper already returns null without a finite limit > 0.
      percent: limitValid ? percent : null,
    };
  };

  const metrics = entLinked?.metrics ?? [];
  const hasMetricWindows = metrics.length > 0;
  const metricByDimension = new Map(metrics.map((metric) => [metric.dimension, metric]));
  const spendMetric = metricByDimension.get('spend_micros') ?? metricByDimension.get('spend_units');
  const spendIsMicros = spendMetric?.dimension === 'spend_micros';
  const formatSpend = (value: number): string =>
    spendIsMicros ? formatSpendMicros(value) : formatCount(value);
  const metricCards = [
    toCard(
      metricByDimension.get('tokens'),
      t('header.account.quota.tokens'),
      'stack',
      'bg-[var(--status-info)]/10 text-[var(--status-info)]',
      formatCount,
      formatCount,
    ),
    toCard(
      metricByDimension.get('requests'),
      t('header.account.quota.requests'),
      'pulse',
      'bg-[var(--status-success)]/10 text-[var(--status-success)]',
      formatCount,
      formatCount,
    ),
    toCard(
      spendMetric,
      t('header.account.quota.cost'),
      'money-dollar-circle',
      'bg-[var(--status-warning)]/10 text-[var(--status-warning)]',
      formatSpend,
      formatSpend,
    ),
  ].filter((card): card is MetricCardView => card !== null);

  // Fallback cards from the status quota usage: used values only, never a
  // denominator, bar, or percent. Rendered only when entitlements reports
  // no metric windows but the status read carries cumulative usage.
  const fallbackCards: MetricCardView[] = (() => {
    if (hasMetricWindows || statusUsage === null) return [];
    const cards: MetricCardView[] = [];
    if (isFiniteAmount(statusUsage.totalTokens)) {
      cards.push({
        dimension: 'tokens',
        label: t('header.account.quota.tokens'),
        icon: 'stack',
        tileClass: 'bg-[var(--status-info)]/10 text-[var(--status-info)]',
        usedText: formatCount(statusUsage.totalTokens),
        limitText: null,
        percent: null,
      });
    }
    if (isFiniteAmount(statusUsage.totalRequests)) {
      cards.push({
        dimension: 'requests',
        label: t('header.account.quota.requests'),
        icon: 'pulse',
        tileClass: 'bg-[var(--status-success)]/10 text-[var(--status-success)]',
        usedText: formatCount(statusUsage.totalRequests),
        limitText: null,
        percent: null,
      });
    }
    const costMicros = isFiniteAmount(statusUsage.totalCostMicros)
      ? statusUsage.totalCostMicros
      : isFiniteAmount(statusUsage.totalPriceMicros)
        ? (statusUsage.totalPriceMicros as number)
        : null;
    if (costMicros !== null) {
      cards.push({
        dimension: 'cost',
        label: t('header.account.quota.cost'),
        icon: 'money-dollar-circle',
        tileClass: 'bg-[var(--status-warning)]/10 text-[var(--status-warning)]',
        usedText: formatSpendMicros(costMicros),
        limitText: null,
        percent: null,
      });
    }
    return cards;
  })();

  const cards = hasMetricWindows ? metricCards : fallbackCards;
  const showMissingLimitsNote = !hasMetricWindows && linked !== null && (fallbackCards.length > 0);

  const widestMetric = (() => {
    let widest: AccountEntitlementsMetric | null = null;
    for (const card of cards) {
      const metric = metricByDimension.get(card.dimension);
      if (metric === undefined) continue;
      if (widest === null || metric.windowSeconds > widest.windowSeconds) widest = metric;
    }
    return widest;
  })();

  const resetsInDays = (() => {
    if (widestMetric === null) return null;
    const at = Date.parse(widestMetric.resetsAt);
    if (!Number.isFinite(at)) return null;
    return Math.max(0, Math.ceil((at - Date.now()) / DAY_MS));
  })();

  const availableMicros = balance?.availableMicros;
  const balanceCurrency = typeof balance?.currency === 'string' ? balance.currency : null;
  const hasBalance = isFiniteAmount(availableMicros) && balanceCurrency !== null;
  const availableText = hasBalance && isFiniteAmount(availableMicros) && balanceCurrency !== null
    ? formatQuotaMoney(availableMicros, balanceCurrency)
    : '';
  const amountMicros = balance?.amountMicros;
  const hasCredit = isFiniteAmount(amountMicros) && (amountMicros as number) > 0;
  const showBalanceNote = plan !== null && plan !== undefined && (plan.includedTokens !== undefined && plan.includedTokens > 0 || hasCredit);
  const balanceNote = !showBalanceNote || plan === null || plan === undefined
    ? ''
    : plan.includedTokens !== undefined && plan.includedTokens > 0
      ? t('header.account.entitlements.balanceIncludes', {
        tokens: formatCount(plan.includedTokens),
        plan: plan.name,
      })
      : t('header.account.entitlements.balanceOnPlan', { plan: plan.name });

  // Plan limits from the plan read only (entitlements carries no limit
  // rules). Each row keeps its own account-plan-limit marker; an explicit
  // null cap is the only path to the Unlimited copy — a plan NAME
  // containing the word never triggers it.
  const planLimits = planReady?.limits ?? [];
  const planCurrency = plan?.currency ?? balanceCurrency ?? usageCurrency ?? 'USD';

  const hasUsageSection = cards.length > 0 || hasBalance;
  const showStale = (entLinked !== null && entLinked.stale)
    || (planLinked !== null && planLinked.stale)
    || (linked !== null && linked.quota.state === 'stale-cached');
  // The account link (and its persistence label) is owned by the status
  // body, so an unlinked/expired status still names the session-only note.
  const showSessionOnly = (status !== null ? status.persistence : (entLinked?.persistence ?? planLinked?.persistence)) === 'ephemeral';
  const composedHasData = entLinked !== null || planLinked !== null || linked !== null;
  const showUpdated = composedHasData && typeof lastUpdated === 'number' && Number.isFinite(lastUpdated);
  const updatedText = showUpdated && typeof lastUpdated === 'number'
    ? new Date(lastUpdated).toLocaleString()
    : '';

  // Plan messaging when no plan resolved: the upstream 404 (both reads agree
  // there is no subscription) names "No active plan"; any other missing
  // plan with a linked status names "Plan unavailable" and keeps usage.
  const planDetailState = (() => {
    if (plan !== null && plan !== undefined) return 'ready' as const;
    if (linked === null) return null;
    const entPlanNull = entLinked === null || entLinked.plan === null;
    const planNone = planLinked !== null && planLinked.detail.state === 'none';
    if (entPlanNull && planNone) return 'none' as const;
    const entMissing = entitlements === undefined || entitlements === null || entitlements.link !== 'linked';
    const planMissing = planStatus === undefined || planStatus === null || planLinked === null;
    if (entMissing || planMissing || (planLinked !== null && planLinked.detail.state === 'unavailable')) {
      return 'unavailable' as const;
    }
    return 'unavailable' as const;
  })();

  const glyph = initials !== '' ? initials : displayName.slice(0, 1);

  return (
    <div data-testid="account-quota" data-quota-state={quotaState} className="px-4 py-2.5">
      <div className="flex items-start gap-3">
        {avatarUrl !== '' ? (
          <img
            src={avatarUrl}
            alt=""
            aria-hidden
            className="size-12 shrink-0 rounded-full border border-border object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-12 shrink-0 items-center justify-center rounded-full border border-border bg-[var(--surface-elevated)] typography-ui-label font-semibold text-foreground"
          >
            {glyph !== '' ? glyph : <Icon name="user" className="size-5" />}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate typography-ui-label font-semibold text-foreground">{displayName}</div>
          {email !== '' ? (
            <div className="truncate typography-micro text-muted-foreground">{email}</div>
          ) : null}
        </div>
        {plan !== null && plan !== undefined ? (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span
              data-testid="account-tier"
              className="inline-flex max-w-[12rem] items-center gap-1 truncate rounded-full border border-border bg-[var(--surface-elevated)] px-2.5 py-1 typography-micro font-medium text-foreground"
            >
              <Icon name="star-fill" className="size-3.5 shrink-0" />
              <span dir="auto" className="truncate">
                {plan.name}
              </span>
            </span>
            {renewsAt !== null ? (
              <span className="typography-micro text-muted-foreground">
                {t('header.account.plan.renewsOn', { date: renewsAt })}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {status === null && needsSession ? (
        <div className="typography-micro mt-3 text-muted-foreground">
          {t('header.account.quota.state.signInRequired')}
        </div>
      ) : status === null ? (
        <div className="typography-micro mt-3 text-muted-foreground">{t('header.account.quotaLoading')}</div>
      ) : linked === null ? (
        <div className="mt-3 flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <div className="typography-micro min-w-0 flex-1 text-muted-foreground">
              {status.link === 'upstream_error'
                ? t('header.account.quota.state.upstreamError')
                : t('header.account.quota.state.signInRequired')}
            </div>
            {showRefresh ? <RefreshButton isRefreshing={isRefreshing} onRefresh={onRefresh} /> : null}
          </div>
          {showSessionOnly ? (
            <div className="typography-micro text-muted-foreground">
              {t('header.account.quota.state.sessionOnly')}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-2.5 flex flex-col gap-2.5">
          {plan !== null && plan !== undefined ? (
            <div className="flex items-center gap-3 rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/15 via-purple-500/5 to-transparent p-2.5">
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-500"
              >
                <Icon name="star-fill" className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate typography-ui-label font-semibold text-foreground">
                  <span data-testid="account-plan-name" dir="auto">
                    {plan.name}
                  </span>
                </div>
                <div className="truncate typography-micro text-muted-foreground">{billedText}</div>
              </div>
              {portalBase !== null ? (
                <Button type="button" variant="outline" size="sm" asChild>
                  <a
                    data-testid="account-portal-cta"
                    data-destination="subscriptions"
                    href={`${portalBase}subscriptions`}
                  >
                    <span>{t('header.account.plan.manage')}</span>
                  </a>
                </Button>
              ) : null}
            </div>
          ) : planDetailState === 'none' ? (
            <div className="typography-micro text-muted-foreground">{t('header.account.plan.noActive')}</div>
          ) : planDetailState === 'unavailable' ? (
            <div className="typography-micro text-muted-foreground">{t('header.account.plan.unavailable')}</div>
          ) : null}

          {planLimits.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {planLimits.map((limit) => {
                const cap = formatPlanCap(limit, planCurrency);
                const perWindow = (() => {
                  const { unit, count } = (() => {
                    const s = limit.windowSeconds;
                    if (s % 604800 === 0) return { unit: 'week' as const, count: s / 604800 };
                    if (s % 86400 === 0) return { unit: 'day' as const, count: s / 86400 };
                    if (s % 3600 === 0) return { unit: 'hour' as const, count: s / 3600 };
                    if (s % 60 === 0) return { unit: 'minute' as const, count: s / 60 };
                    return { unit: 'seconds' as const, count: s };
                  })();
                  if (count === 1) {
                    switch (unit) {
                      case 'minute': return t('header.account.plan.duration.minute');
                      case 'hour': return t('header.account.plan.duration.hour');
                      case 'day': return t('header.account.plan.duration.day');
                      case 'week': return t('header.account.plan.duration.week');
                      case 'seconds': return t('header.account.plan.duration.second');
                    }
                  }
                  switch (unit) {
                    case 'minute': return t('header.account.plan.duration.minutes', { count });
                    case 'hour': return t('header.account.plan.duration.hours', { count });
                    case 'day': return t('header.account.plan.duration.days', { count });
                    case 'week': return t('header.account.plan.duration.weeks', { count });
                    case 'seconds': return t('header.account.plan.duration.seconds', { count });
                  }
                })();
                const label = limit.dimension === 'tokens'
                  ? t('header.account.plan.limit.tokens')
                  : limit.dimension === 'requests'
                    ? t('header.account.plan.limit.requests')
                    : limit.dimension === 'spend_micros'
                      ? t('header.account.plan.limit.spend')
                      : limit.dimension === 'spend_units'
                        ? t('header.account.plan.limit.spendUnits')
                        : limit.dimension;
                return (
                  <div
                    key={`${limit.dimension}:${limit.windowSeconds}`}
                    data-testid="account-plan-limit"
                    data-dimension={limit.dimension}
                    className="typography-micro truncate text-muted-foreground"
                  >
                    <span dir="auto">{label}</span>
                    <span>{' · '}</span>
                    <span className="tabular-nums">
                      {cap === null ? t('header.account.plan.unlimited') : cap}
                    </span>
                    <span>{` ${perWindow}`}</span>
                  </div>
                );
              })}
            </div>
          ) : null}

          {hasUsageSection ? (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="typography-ui-label min-w-0 flex-1 font-medium text-foreground">
                  {t('header.account.entitlements.usageTitle')}
                </span>
                <span
                  role="img"
                  aria-label={t('header.account.entitlements.usageHint')}
                  title={t('header.account.entitlements.usageHint')}
                  className="shrink-0 text-muted-foreground"
                >
                  <Icon name="information" className="size-3.5" />
                </span>
                {resetsInDays !== null ? (
                  <span className="inline-flex shrink-0 items-center gap-1 typography-micro text-muted-foreground">
                    <Icon name="time" className="size-3.5" />
                    {resetsInDays <= 1
                      ? t('header.account.entitlements.resetsInDay')
                      : t('header.account.entitlements.resetsInDays', { count: resetsInDays })}
                  </span>
                ) : null}
                {showRefresh ? <RefreshButton isRefreshing={isRefreshing} onRefresh={onRefresh} /> : null}
              </div>
              {showMissingLimitsNote && planLimits.length === 0 ? (
                <div className="typography-micro mb-1.5 text-muted-foreground">
                  {t('header.account.usage.noLimitNote')}
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2 max-[420px]:grid-cols-1">
                {cards.map((card) => (
                  <MetricCard key={card.dimension} card={card} />
                ))}
                {hasBalance ? (
                  <div
                    data-testid="account-metric-card"
                    data-dimension="balance"
                    className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-[var(--surface-elevated)] p-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span
                        aria-hidden
                        className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[var(--status-error)]/10 text-[var(--status-error)]"
                      >
                        <Icon name="bank-card" className="size-3.5" />
                      </span>
                      <span className="typography-micro min-w-0 truncate text-muted-foreground">
                        {t('header.account.quota.balance')}
                      </span>
                    </div>
                    <div className="typography-ui-label truncate font-semibold tabular-nums text-foreground">
                      {availableText}
                    </div>
                    {showBalanceNote ? (
                      <div className="typography-micro truncate text-muted-foreground">{balanceNote}</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {portalBase !== null && (plan !== null && plan !== undefined || hasUsageSection) ? (
            <div className="flex items-center gap-3 rounded-xl border border-teal-500/20 bg-teal-500/10 p-3">
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-teal-600 dark:text-teal-300"
              >
                <Icon name="loop-right" className="size-4" />
              </span>
              <span className="typography-micro min-w-0 flex-1 text-muted-foreground">
                {t('header.account.entitlements.capacityNote')}
              </span>
              <Button type="button" variant="outline" size="sm" asChild className="shrink-0">
                <a
                  data-testid="account-portal-cta"
                  data-destination="subscriptions"
                  href={`${portalBase}subscriptions`}
                >
                  <span>{t('header.account.entitlements.upgrade')}</span>
                </a>
              </Button>
            </div>
          ) : null}

          {portalBase !== null ? (
            <div className="flex flex-col rounded-xl border border-border">
              <a
                data-testid="account-portal-cta"
                data-destination="billing"
                href={`${portalBase}billing`}
                className="flex items-center gap-2 px-3 py-2 typography-micro text-foreground hover:bg-interactive-hover"
              >
                <Icon name="file-text" className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  {t('header.account.entitlements.planDetails')}
                </span>
                <Icon name="arrow-right-s" className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
              </a>
              <div className="border-t border-border" aria-hidden />
              <a
                data-testid="account-portal-cta"
                data-destination="usage"
                href={`${portalBase}usage`}
                className="flex items-center gap-2 px-3 py-2 typography-micro text-foreground hover:bg-interactive-hover"
              >
                <Icon name="history" className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  {t('header.account.entitlements.usageHistory')}
                </span>
                <Icon name="arrow-right-s" className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
              </a>
            </div>
          ) : null}

          {showStale ? (
            <div className="typography-micro text-muted-foreground">{t('header.account.quota.stale')}</div>
          ) : null}
          {showSessionOnly ? (
            <div className="typography-micro text-muted-foreground">
              {t('header.account.quota.state.sessionOnly')}
            </div>
          ) : null}
          {showUpdated ? (
            <div className="typography-micro text-muted-foreground">
              {t('header.account.quota.updated', { when: updatedText })}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
