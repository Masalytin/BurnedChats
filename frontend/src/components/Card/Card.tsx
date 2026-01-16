import type { ReactNode, HTMLAttributes } from 'react';
import './Card.css';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated';
  children: ReactNode;
}

/**
 * Card container component
 */
export function Card({ 
  variant = 'default', 
  children, 
  className = '',
  ...props 
}: CardProps) {
  return (
    <div className={`card card--${variant} ${className}`} {...props}>
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function CardHeader({ title, subtitle, action }: CardHeaderProps) {
  return (
    <div className="card-header">
      <div className="card-header-content">
        <h3 className="card-title">{title}</h3>
        {subtitle && <p className="card-subtitle">{subtitle}</p>}
      </div>
      {action && <div className="card-header-action">{action}</div>}
    </div>
  );
}

interface CardContentProps {
  children: ReactNode;
  noPadding?: boolean;
}

export function CardContent({ children, noPadding = false }: CardContentProps) {
  return (
    <div className={`card-content ${noPadding ? 'card-content--no-padding' : ''}`}>
      {children}
    </div>
  );
}


