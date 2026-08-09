export interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { user?: { id?: number | string } };
  expand: () => void;
  ready: () => void;
  showAlert?: (message: string) => void;
  showConfirm?: (message: string, callback: (confirmed: boolean) => void) => void;
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
  };
}

declare global {
  interface Window {
    Telegram: {
      WebApp: TelegramWebApp;
    };
  }
}
