// Panel strings for the alcode-builtin-dag-pane guest (project-ide todo 13).
//
// The iframe cannot consume the host React i18n context across the sandbox
// boundary, so the package ships its own dictionaries and picks one from
// `ready.locale` (see the extensions ownership doc). Every locale below
// carries a real translation; an unknown locale falls back to English
// through `stringsFor` — the fallback is a stated policy here, not an
// English placeholder inside another locale's dictionary.

export type DagPaneStrings = {
  live: string;
  history: string;
  historyEmpty: string;
  title: string;
  refresh: string;
  steer: string;
  cancel: string;
  steerPlaceholder: string;
  session: string;
  details: string;
  emptyTitle: string;
  emptyBody: string;
  errorTitle: string;
  offlineTitle: string;
  offlineBody: string;
  retry: string;
  diagnostics: string;
  flowTrace: string;
};

const en: DagPaneStrings = {
  title: 'DAG runs',
  live: 'Live',
  history: 'History',
  historyEmpty: 'No past runs',
  refresh: 'Refresh',
  steer: 'Steer',
  cancel: 'Cancel',
  steerPlaceholder: 'Steer the live run…',
  session: 'Session',
  details: 'Details',
  emptyTitle: 'No runs yet',
  emptyBody: 'Steer the session to start its first run, or refresh after the engine reports.',
  errorTitle: 'Snapshot unreadable',
  offlineTitle: 'Engine disconnected',
  offlineBody: 'Close the pane and reopen it after the engine is back.',
  retry: 'Retry',
  diagnostics: 'Diagnostics',
  flowTrace: 'Flow trace',
};

const de: DagPaneStrings = {
  title: 'DAG-Läufe',
  live: 'Live',
  history: 'Verlauf',
  historyEmpty: 'Keine früheren Läufe',
  refresh: 'Aktualisieren',
  steer: 'Steuern',
  cancel: 'Abbrechen',
  steerPlaceholder: 'Live-Ausführung steuern…',
  session: 'Sitzung',
  details: 'Details',
  emptyTitle: 'Noch keine Läufe',
  emptyBody: 'Steuern Sie die Sitzung, um den ersten Lauf zu starten, oder aktualisieren Sie nach der Engine-Meldung.',
  errorTitle: 'Snapshot unlesbar',
  offlineTitle: 'Engine getrennt',
  offlineBody: 'Schließen Sie den Bereich und öffnen Sie ihn erneut, sobald die Engine zurück ist.',
  retry: 'Erneut versuchen',
  diagnostics: 'Diagnose',
  flowTrace: 'Ablaufverfolgung',
};

const es: DagPaneStrings = {
  title: 'Ejecuciones DAG',
  live: 'En vivo',
  history: 'Historial',
  historyEmpty: 'Sin ejecuciones anteriores',
  refresh: 'Actualizar',
  steer: 'Dirigir',
  cancel: 'Cancelar',
  steerPlaceholder: 'Dirigir la ejecución…',
  session: 'Sesión',
  details: 'Detalles',
  emptyTitle: 'Sin ejecuciones',
  emptyBody: 'Dirija la sesión para iniciar la primera ejecución o actualice tras el informe del motor.',
  errorTitle: 'Instantánea ilegible',
  offlineTitle: 'Motor desconectado',
  offlineBody: 'Cierre el panel y vuelva a abrirlo cuando el motor esté disponible.',
  retry: 'Reintentar',
  diagnostics: 'Diagnóstico',
  flowTrace: 'Traza de flujo',
};

const fr: DagPaneStrings = {
  title: 'Exécutions DAG',
  live: 'En direct',
  history: 'Historique',
  historyEmpty: 'Aucune exécution passée',
  refresh: 'Actualiser',
  steer: 'Piloter',
  cancel: 'Annuler',
  steerPlaceholder: 'Piloter l’exécution…',
  session: 'Session',
  details: 'Détails',
  emptyTitle: 'Aucune exécution',
  emptyBody: 'Pilotez la session pour démarrer la première exécution, ou actualisez après le rapport du moteur.',
  errorTitle: 'Instantané illisible',
  offlineTitle: 'Moteur déconnecté',
  offlineBody: 'Fermez le panneau et rouvrez-le quand le moteur est de retour.',
  retry: 'Réessayer',
  diagnostics: 'Diagnostic',
  flowTrace: 'Trace de flux',
};

const ja: DagPaneStrings = {
  title: 'DAG実行',
  live: '実行中',
  history: '履歴',
  historyEmpty: '過去の実行はありません',
  refresh: '更新',
  steer: '誘導',
  cancel: 'キャンセル',
  steerPlaceholder: '実行を誘導…',
  session: 'セッション',
  details: '詳細',
  emptyTitle: '実行なし',
  emptyBody: 'セッションを誘導して最初の実行を開始するか、エンジンの報告後に更新してください。',
  errorTitle: 'スナップショットを読めません',
  offlineTitle: 'エンジン切断',
  offlineBody: 'エンジン復帰後にペインを閉じて開き直してください。',
  retry: '再試行',
  diagnostics: '診断',
  flowTrace: 'フロートレース',
};

const ko: DagPaneStrings = {
  title: 'DAG 실행',
  live: '실행 중',
  history: '기록',
  historyEmpty: '이전 실행 없음',
  refresh: '새로 고침',
  steer: '조정',
  cancel: '취소',
  steerPlaceholder: '실행 조정…',
  session: '세션',
  details: '세부 정보',
  emptyTitle: '실행 없음',
  emptyBody: '세션을 조정해 첫 실행을 시작하거나 엔진 보고 후 새로 고침하세요.',
  errorTitle: '스냅샷을 읽을 수 없음',
  offlineTitle: '엔진 연결 끊김',
  offlineBody: '엔진이 돌아온 뒤 창을 닫았다가 다시 여세요.',
  retry: '다시 시도',
  diagnostics: '진단',
  flowTrace: '흐름 추적',
};

const nl: DagPaneStrings = {
  title: 'DAG-uitvoeringen',
  live: 'Live',
  history: 'Geschiedenis',
  historyEmpty: 'Geen eerdere runs',
  refresh: 'Vernieuwen',
  steer: 'Bijsturen',
  cancel: 'Annuleren',
  steerPlaceholder: 'Live-uitvoering bijsturen…',
  session: 'Sessie',
  details: 'Details',
  emptyTitle: 'Nog geen uitvoeringen',
  emptyBody: 'Stuur de sessie bij om de eerste uitvoering te starten, of vernieuw na de engine-melding.',
  errorTitle: 'Snapshot onleesbaar',
  offlineTitle: 'Engine verbroken',
  offlineBody: 'Sluit het paneel en open het opnieuw als de engine terug is.',
  retry: 'Opnieuw proberen',
  diagnostics: 'Diagnostiek',
  flowTrace: 'Flowtrace',
};

const pl: DagPaneStrings = {
  title: 'Uruchomienia DAG',
  live: 'Na żywo',
  history: 'Historia',
  historyEmpty: 'Brak wcześniejszych uruchomień',
  refresh: 'Odśwież',
  steer: 'Steruj',
  cancel: 'Anuluj',
  steerPlaceholder: 'Steruj uruchomieniem…',
  session: 'Sesja',
  details: 'Szczegóły',
  emptyTitle: 'Brak uruchomień',
  emptyBody: 'Steruj sesją, aby rozpocząć pierwsze uruchomienie, lub odśwież po raporcie silnika.',
  errorTitle: 'Migawka nieczytelna',
  offlineTitle: 'Silnik rozłączony',
  offlineBody: 'Zamknij panel i otwórz go ponownie, gdy silnik wróci.',
  retry: 'Ponów',
  diagnostics: 'Diagnostyka',
  flowTrace: 'Śledzenie przepływu',
};

const ptBr: DagPaneStrings = {
  title: 'Execuções DAG',
  live: 'Ao vivo',
  history: 'Histórico',
  historyEmpty: 'Nenhuma execução anterior',
  refresh: 'Atualizar',
  steer: 'Direcionar',
  cancel: 'Cancelar',
  steerPlaceholder: 'Direcionar a execução…',
  session: 'Sessão',
  details: 'Detalhes',
  emptyTitle: 'Sem execuções',
  emptyBody: 'Direcione a sessão para iniciar a primeira execução ou atualize após o informe do mecanismo.',
  errorTitle: 'Instantâneo ilegível',
  offlineTitle: 'Mecanismo desconectado',
  offlineBody: 'Feche o painel e reabra-o quando o mecanismo voltar.',
  retry: 'Repetir',
  diagnostics: 'Diagnóstico',
  flowTrace: 'Rastreamento de fluxo',
};

const tr: DagPaneStrings = {
  title: 'DAG çalıştırmaları',
  live: 'Canlı',
  history: 'Geçmiş',
  historyEmpty: 'Önceki çalıştırma yok',
  refresh: 'Yenile',
  steer: 'Yönlendir',
  cancel: 'İptal',
  steerPlaceholder: 'Canlı çalıştırmayı yönlendir…',
  session: 'Oturum',
  details: 'Ayrıntılar',
  emptyTitle: 'Henüz çalıştırma yok',
  emptyBody: 'İlk çalıştırmayı başlatmak için oturumu yönlendirin veya motor raporundan sonra yenileyin.',
  errorTitle: 'Anlık görüntü okunamıyor',
  offlineTitle: 'Motor bağlantısı kesildi',
  offlineBody: 'Motor döndükten sonra bölmeyi kapatıp yeniden açın.',
  retry: 'Yeniden dene',
  diagnostics: 'Tanılama',
  flowTrace: 'Akış izleme',
};

const uk: DagPaneStrings = {
  title: 'Запуски DAG',
  live: 'Наживо',
  history: 'Історія',
  historyEmpty: 'Немає минулих запусків',
  refresh: 'Оновити',
  steer: 'Скерувати',
  cancel: 'Скасувати',
  steerPlaceholder: 'Скерувати виконання…',
  session: 'Сеанс',
  details: 'Деталі',
  emptyTitle: 'Запусків ще немає',
  emptyBody: 'Скеруйте сеанс, щоб почати перший запуск, або оновіть після звіту рушія.',
  errorTitle: 'Знімок нечитабельний',
  offlineTitle: 'Рушій від’єднано',
  offlineBody: 'Закрийте панель і відкрийте її знову, коли рушій повернеться.',
  retry: 'Повторити',
  diagnostics: 'Діагностика',
  flowTrace: 'Трасування потоку',
};

const zhCn: DagPaneStrings = {
  title: 'DAG 运行',
  live: '运行中',
  history: '历史',
  historyEmpty: '暂无历史运行',
  refresh: '刷新',
  steer: '引导',
  cancel: '取消',
  steerPlaceholder: '引导实时运行…',
  session: '会话',
  details: '详情',
  emptyTitle: '暂无运行',
  emptyBody: '引导会话以开始首次运行，或在引擎上报后刷新。',
  errorTitle: '快照无法读取',
  offlineTitle: '引擎已断开',
  offlineBody: '引擎恢复后关闭窗格并重新打开。',
  retry: '重试',
  diagnostics: '诊断',
  flowTrace: '流程跟踪',
};

const zhTw: DagPaneStrings = {
  title: 'DAG 執行',
  live: '執行中',
  history: '歷史',
  historyEmpty: '尚無歷史執行',
  refresh: '重新整理',
  steer: '引導',
  cancel: '取消',
  steerPlaceholder: '引導即時執行…',
  session: '工作階段',
  details: '詳細資訊',
  emptyTitle: '尚無執行',
  emptyBody: '引導工作階段以開始首次執行，或在引擎回報後重新整理。',
  errorTitle: '快照無法讀取',
  offlineTitle: '引擎已中斷連線',
  offlineBody: '引擎恢復後關閉窗格並重新開啟。',
  retry: '重試',
  diagnostics: '診斷',
  flowTrace: '流程追蹤',
};

const DICTIONARIES = {
  en, de, es, fr, ja, ko, nl, pl, 'pt-br': ptBr, tr, uk, 'zh-cn': zhCn, 'zh-tw': zhTw,
} satisfies Record<string, DagPaneStrings>;

export const DAG_PANE_LOCALES = Object.keys(DICTIONARIES);

/** Pick the dictionary for a host locale: exact match, then language prefix, then English. */
export const stringsFor = (locale: string | null | undefined): DagPaneStrings => {
  const normalized = String(locale ?? '').trim().toLowerCase().replace('_', '-');
  if (normalized && DICTIONARIES[normalized]) {
    return DICTIONARIES[normalized];
  }
  const prefix = normalized.split('-')[0];
  if (prefix) {
    const hit = Object.keys(DICTIONARIES).find((key) => key === prefix || key.startsWith(`${prefix}-`));
    if (hit) {
      return DICTIONARIES[hit];
    }
  }
  return en;
};
