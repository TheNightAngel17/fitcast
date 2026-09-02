import React from 'react';

interface Props {
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

const typeColors = {
  info: 'var(--text-secondary)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  error: 'var(--error)',
};

export function StatusBar({ message, type }: Props): React.ReactElement {
  return (
    <div
      style={{
        padding: '8px 24px',
        background: 'var(--bg-secondary)',
        borderTop: '1px solid var(--border)',
        fontSize: 13,
        color: typeColors[type],
      }}
    >
      {message}
    </div>
  );
}
