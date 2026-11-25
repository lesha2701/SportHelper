import { useEffect, useState } from 'react';
import { decideApplication, listApplications, type Application } from '../../api/coachApplications';

const labels = { pending: 'На проверке', needs_info: 'Ожидает дополнения', approved: 'Одобрена', rejected: 'Отклонена' };
export function CoachApplicationsPage() {
  const [items, setItems] = useState<Application[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => listApplications().then(setItems).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);
  const current = items.find(item => item.id === selected);
  const decide = async (action: 'approve' | 'needs_info' | 'reject') => {
    if (!current) return;
    setBusy(true); setError('');
    try { await decideApplication(current.id, action, note); setNote(''); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить решение'); }
    finally { setBusy(false); }
  };
  return <section style={{ padding: '1.5rem' }}>
    <h1>Проверка тренеров</h1><p>Заявки после подтверждения email. Документы доступны только администраторам.</p>
    {error && <p role="alert">{error}</p>}
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1fr) minmax(320px,2fr)', gap: 20 }}>
      <div>{items.map(item => <button key={item.id} style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 8 }} onClick={() => { setSelected(item.id); setNote(''); }}>
        {item.first_name} {item.last_name} · {item.sport} · {labels[item.status]}
      </button>)}</div>
      <div>{current && <>
        <h2>{current.first_name} {current.last_name}</h2><p>{current.email}</p><p>Статус: {labels[current.status]}</p>
        <p><strong>Вид спорта:</strong> {current.sport}</p><p><strong>Квалификация:</strong> {current.qualification}</p><p><strong>Опыт:</strong> {current.experience}</p><p><strong>О себе:</strong> {current.about || '—'}</p>
        <ul>{current.links.map(link => <li key={link}><a href={link} target="_blank" rel="noopener noreferrer">{link}</a></li>)}</ul>
        <h3>Документы</h3><ul>{current.documents.map(doc => <li key={doc.id}><a href={`/api/admin/coach-applications/documents/${doc.id}`} target="_blank" rel="noopener noreferrer">{doc.filename}</a></li>)}</ul>
        {current.admin_note && <p>Последний комментарий: {current.admin_note}</p>}
        {current.status === 'pending' && <div style={{ display: 'grid', gap: 12 }}>
          <label>Комментарий кандидату<textarea value={note} maxLength={2000} onChange={e => setNote(e.target.value)} /></label>
          <div style={{ display: 'flex', gap: 8 }}><button disabled={busy} onClick={() => void decide('approve')}>Одобрить</button><button disabled={busy || note.trim().length < 3} onClick={() => void decide('needs_info')}>Запросить дополнение</button><button disabled={busy || note.trim().length < 3} onClick={() => void decide('reject')}>Отклонить</button></div>
        </div>}
      </>}</div>
    </div>
  </section>;
}
