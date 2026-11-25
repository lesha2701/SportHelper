import { useEffect, useState, type FormEvent } from 'react';
import { myApplication, resubmitApplication, type Application, type ApplicationDetails } from '../../api/coachApplications';
import { useAuth } from '../../context/AuthContext';
import { AccountSecurity } from '../profile/AccountSecurity';

export function CoachApplicationGate() {
  const { logout, refreshUser } = useAuth();
  const [data, setData] = useState<Application | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState<ApplicationDetails>({ sport: '', qualification: '', experience: '', about: '', links: [] });
  const [files, setFiles] = useState<File[]>([]);
  const [tab, setTab] = useState<'status' | 'account' | 'help'>('status');
  const load = () => myApplication().then((value) => { setData(value); if (value) setDetails({ sport: value.sport, qualification: value.qualification, experience: value.experience, about: value.about, links: value.links }); }).catch((e: Error) => setError(e.message));
  const checkStatus = async () => { setError(''); await load(); await refreshUser(); };
  useEffect(() => { void load(); }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await resubmitApplication(details, files); setFiles([]); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось отправить заявку'); }
    finally { setBusy(false); }
  };
  return <main style={{ maxWidth: 720, margin: '3rem auto', padding: '1rem' }}>
    <h1>Заявка тренера</h1>
    <nav aria-label="Разделы кандидата" style={{ display: 'flex', gap: 12 }}>
      <button onClick={() => setTab('status')}>Заявка</button><button onClick={() => setTab('account')}>Аккаунт</button><button onClick={() => setTab('help')}>Помощь</button><button onClick={() => void logout()}>Выйти</button>
    </nav>
    {tab === 'account' && <AccountSecurity />}
    {tab === 'help' && <p>По вопросам заявки напишите на <a href="mailto:perekrestov_bus@mail.ru">perekrestov_bus@mail.ru</a>. На письмо с решением администрации тоже можно ответить.</p>}
    {tab === 'status' && <>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={() => void checkStatus()}>Проверить статус</button>
      {!data && !error && <p>Загружаем заявку…</p>}
      {data && <>
        <p>{data.status === 'pending' ? 'Заявка на проверке. Мы сообщим о решении по email.' : data.status === 'needs_info' ? 'Нужны дополнительные сведения.' : data.status === 'rejected' ? 'Сейчас мы не готовы одобрить вашу заявку.' : 'Заявка одобрена.'}</p>
        {data.admin_note && <p><strong>Комментарий:</strong> {data.admin_note}</p>}
        {data.resubmit_after && <p>Повторная подача: {new Date(data.resubmit_after).toLocaleDateString('ru-RU')}</p>}
        <p>Вид спорта: {data.sport}. Квалификация: {data.qualification}. Опыт: {data.experience}.</p>
        <ul>{data.documents.map(doc => <li key={doc.id}><a href={`/api/coach-applications/documents/${doc.id}`}>{doc.filename}</a></li>)}</ul>
        {data.status === 'approved' && <button onClick={() => void refreshUser()}>Открыть аккаунт тренера</button>}
        {(data.status === 'needs_info' || (data.status === 'rejected' && (!data.resubmit_after || new Date(data.resubmit_after) <= new Date()))) && <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
          <h2>Дополнить заявку</h2>
          <label>Вид спорта <input required minLength={2} maxLength={100} value={details.sport} onChange={e => setDetails({ ...details, sport: e.target.value })} /></label>
          <label>Квалификация <textarea required minLength={2} maxLength={1000} value={details.qualification} onChange={e => setDetails({ ...details, qualification: e.target.value })} /></label>
          <label>Опыт <textarea required minLength={2} maxLength={2000} value={details.experience} onChange={e => setDetails({ ...details, experience: e.target.value })} /></label>
          <label>О себе <textarea maxLength={2000} value={details.about} onChange={e => setDetails({ ...details, about: e.target.value })} /></label>
          <label>Ссылки HTTPS, по одной в строке <textarea value={details.links.join('\n')} onChange={e => setDetails({ ...details, links: e.target.value.split('\n').map(v => v.trim()).filter(Boolean) })} /></label>
          <label>Новые документы, если нужны <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={e => setFiles(Array.from(e.target.files ?? []))} /></label>
          <button disabled={busy}>Отправить повторно</button>
        </form>}
      </>}
    </>}
  </main>;
}
