import React, { useCallback, useRef, useState } from 'react';

interface Props {
  onFileSelect: (filePath: string) => void;
  loading: boolean;
}

export function FileDropZone({ onFileSelect, loading }: Props): React.ReactElement {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) {
        // Electron gives us the path via the File object
        const filePath = (file as File & { path?: string }).path;
        if (filePath && filePath.endsWith('.fit')) {
          onFileSelect(filePath);
        }
      }
    },
    [onFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleBrowse = useCallback(async () => {
    const path = await window.fitcast.openFitDialog();
    if (path) onFileSelect(path);
  }, [onFileSelect]);

  return (
    <div
      className={`drop-zone ${dragOver ? 'drag-over' : ''} ${loading ? 'loading' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={handleBrowse}
      role="button"
      tabIndex={0}
    >
      <input ref={inputRef} type="file" accept=".fit" style={{ display: 'none' }} />
      {loading ? (
        <span className="drop-text">Parsing...</span>
      ) : (
        <>
          <span className="drop-icon">📂</span>
          <span className="drop-text">
            Drop a <strong>.fit</strong> file here or click to browse
          </span>
        </>
      )}

      <style>{`
        .drop-zone {
          border: 2px dashed var(--border);
          border-radius: var(--radius);
          padding: 32px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s;
          background: var(--bg-card);
        }
        .drop-zone:hover, .drop-zone.drag-over {
          border-color: var(--accent);
          background: rgba(15, 138, 249, 0.05);
        }
        .drop-zone.loading {
          opacity: 0.7;
          pointer-events: none;
        }
        .drop-icon {
          font-size: 32px;
          display: block;
          margin-bottom: 8px;
        }
        .drop-text {
          font-size: 14px;
          color: var(--text-secondary);
        }
      `}</style>
    </div>
  );
}
