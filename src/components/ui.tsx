import { useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { STATUS_LABEL, type ItemStatus } from '../lib/types';

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet stack" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="row"><h2 className="grow">{title}</h2><button className="btn sm ghost" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}

export const StatusChip = ({ s }: { s: ItemStatus }) => <span className={`chip ${s}`}>{STATUS_LABEL[s]}</span>;

export function PhotoField({ value, onChange, required }: { value: Blob | null; onChange: (b: Blob | null) => void; required?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!value) { setUrl(null); return; }
    const u = URL.createObjectURL(value); setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [value]);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <label className="btn" style={{ textAlign: 'center' }}>
        {value ? 'Retake photo' : required ? 'Add photo (required)' : 'Add photo'}
        <input type="file" accept="image/*" capture="environment" className="sr"
          onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      </label>
      {url && <img src={url} alt="Selected proof" className="photo" style={{ maxHeight: 220, objectFit: 'contain' }} />}
    </div>
  );
}

const signed = new Map<string, string>();
export function StoredPhoto({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(signed.get(path) ?? null);
  useEffect(() => {
    if (url) return;
    supabase.storage.from('proofs').createSignedUrl(path, 3600).then(({ data }) => {
      if (data?.signedUrl) { signed.set(path, data.signedUrl); setUrl(data.signedUrl); }
    });
  }, [path, url]);
  if (!url) return <span className="small muted">Loading photo…</span>;
  return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Proof photo" className="photo" style={{ maxHeight: 240, objectFit: 'contain' }} /></a>;
}
