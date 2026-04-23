import type { ReactNode } from 'react';

export interface MessageAction {
  id: 'reply' | 'copy' | 'edit' | 'delete' | 'deleteForMe' | 'select';
  label: string;
  icon: ReactNode;
  variant?: 'default' | 'destructive';
  onClick: () => void;
  disabled?: boolean;
}
