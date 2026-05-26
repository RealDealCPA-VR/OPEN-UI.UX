import type { ReactNode } from 'react';

export interface SettingsSectionCardProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function SettingsSectionCard({
  title,
  description,
  actions,
  children,
}: SettingsSectionCardProps): JSX.Element {
  return (
    <article className="settings-card">
      <header className="settings-card-head">
        <div className="settings-card-head-text">
          <h2 className="settings-card-title">{title}</h2>
          {description ? <p className="settings-card-desc">{description}</p> : null}
        </div>
        {actions ? <div className="settings-card-actions">{actions}</div> : null}
      </header>
      <div className="settings-card-body">{children}</div>
    </article>
  );
}
