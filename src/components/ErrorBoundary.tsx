import React from 'react';
import { reportError } from '@/lib/error-reporter';

interface Props {
  fallback: React.ReactNode;
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Render paytidagi xatolarni ushlaydi — asosan native modul (yamap)
 * mavjud bo'lmagan muhitda (Expo Go) app qulamasligi uchun.
 * Ushlangan xato superadmin panelga ham yuboriladi (fatal emas).
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    reportError(error, {
      isFatal: false,
      extra: info.componentStack ? { componentStack: info.componentStack.slice(0, 4000) } : undefined,
    });
  }

  render(): React.ReactNode {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}
