import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';

export type ToastTone = 'info' | 'good' | 'warning' | 'critical';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  text?: string;
  href?: string;
}

interface ToastState {
  push: (toast: Omit<Toast, 'id'>) => void;
}

const ToastContext = createContext<ToastState | null>(null);

const ICONS: Record<ToastTone, 'info' | 'check' | 'alert' | 'siren'> = {
  info: 'info',
  good: 'check',
  warning: 'alert',
  critical: 'siren',
};

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = nextId.current++;
    setToasts((current) => [...current.slice(-4), { ...toast, id }]);
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 7_000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast" data-tone={toast.tone}>
            <Icon name={ICONS[toast.tone]} size={16} />
            <div style={{ minWidth: 0 }}>
              <div className="toast-title">{toast.title}</div>
              {toast.text ? <div className="toast-text">{toast.text}</div> : null}
              {toast.href ? (
                <a className="toast-text" href={toast.href}>
                  Bileti ac
                </a>
              ) : null}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              style={{ marginLeft: 'auto', alignSelf: 'flex-start' }}
              onClick={() => dismiss(toast.id)}
              aria-label="Bildirimi kapat"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastState {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast yalnizca ToastProvider icinde kullanilabilir');
  return context;
}
