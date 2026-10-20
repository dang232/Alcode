import type { NotificationPayload, NotificationsAPI } from '@alcode/ui/lib/api/types';
import { sendBridgeMessage } from './bridge';

// The extension host shows notifications: Chromium never displays a
// `new Notification()` from a VS Code webview frame.

const showWebviewNotification = async (payload?: NotificationPayload): Promise<boolean> => {
  if (typeof Notification === 'undefined') {
    return false;
  }

  if (Notification.permission === 'default') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return false;
    }
  }

  if (Notification.permission !== 'granted') {
    return false;
  }

  const title = typeof payload?.title === 'string' && payload.title.trim().length > 0
    ? payload.title.trim()
    : 'Alcode';
  const body = typeof payload?.body === 'string' ? payload.body : '';

  new Notification(title, { body });
  return true;
};

export const createVSCodeNotificationsAPI = (): NotificationsAPI => ({
  async notifyAgentCompletion(payload?: NotificationPayload): Promise<boolean> {
    try {
      const result = await sendBridgeMessage<{ shown?: boolean }>('api:notifications:show', {
        title: payload?.title,
        body: payload?.body,
      });
      return result?.shown === true;
    } catch {
      return false;
    }
  },
});
