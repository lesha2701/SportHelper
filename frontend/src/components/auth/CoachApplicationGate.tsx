import { useEffect, useState, type FormEvent } from 'react';
import { myApplication, resubmitApplication, type Application, type ApplicationDetails } from '../../api/coachApplications';
import { useAuth } from '../../context/AuthContext';
import { AccountSecurity } from '../profile/AccountSecurity';
import { BrandLogo } from '../shared/BrandLogo';
import { MultiFilePicker } from '../shared/FilePicker';
import { SiteFooter } from '../shared/SiteFooter';
import { Link } from '../Link';
import styles from './coachApplicationGate.module.css';

export function CoachApplicationGate() {
  const { logout, refreshUser } = useAuth();
  const [data, setData] = useState<Application | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState<ApplicationDetails>({ sport: '', qualification: '', experience: '', about: '', links: [] });
  const [files, setFiles] = useState<File[]>([]);
  const [tab, setTab] = useState<'status' | 'account' | 'help'>('status');
  const load = async () => {
    const value = await myApplication();
    setData(value);
    if (value) setDetails({ sport: value.sport, qualification: value.qualification, experience: value.experience, about: value.about, links: value.links });
  };
  const checkStatus = async () => {
    setError('');
    try { await load(); await refreshUser(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось обновить статус'); }
  };
  useEffect(() => { void load().catch((e: Error) => setError(e.message)); }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (files.some(file => file.size > 10 * 1024 * 1024)) { setError('Размер каждого документа не должен превышать 10 МБ.'); return; }
    setBusy(true); setError('');
    try { await resubmitApplication(details, files); setFiles([]); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось отправить заявку'); }
    finally { setBusy(false); }
  };
  const canResubmit = data && (data.status === 'needs_info' || (data.status === 'rejected' && (!data.resubmit_after || new Date(data.resubmit_after) <= new Date())));
  const status = data?.status ?? 'pending';
  const heading = status === 'pending' ? 'Заявка на проверке' : status === 'needs_info' ? 'Нужны уточнения' : status === 'rejected' ? 'Пока не одобрена' : 'Заявка одобрена';
  const message = status === 'pending' ? 'Мы изучаем вашу анкету и документы. О решении сообщим по email.' : status === 'needs_info' ? 'Дополните анкету с учётом комментария и отправьте её повторно.' : status === 'rejected' ? 'Подать заявку снова можно после указанной даты.' : 'Аккаунт тренера готов. Вы можете отредактировать профиль.';

  return <main className={styles.page}>
    <header className={styles.header}><Link to="/" className={styles.brand}><BrandLogo /><strong>SPORTARENAGLOBAL</strong></Link><button type="button" onClick={() => void logout()}>Выйти</button></header>
    <div className={styles.content}>
      <div className={styles.intro}><span>КАБИНЕТ КАНДИДАТА</span><h1>Заявка <em>тренера</em></h1><p>Следите за проверкой и дополняйте сведения, если они понадобятся.</p></div>
      <nav className={styles.tabs} aria-label="Разделы кандидата">
        <button type="button" aria-current={tab === 'status' ? 'page' : undefined} onClick={() => setTab('status')}>Заявка</button>
        <button type="button" aria-current={tab === 'account' ? 'page' : undefined} onClick={() => setTab('account')}>Аккаунт</button>
        <button type="button" aria-current={tab === 'help' ? 'page' : undefined} onClick={() => setTab('help')}>Помощь</button>
      </nav>
      {tab === 'account' && <section className={styles.panel}><AccountSecurity /></section>}
      {tab === 'help' && <section className={styles.panel}><h2>Нужна помощь?</h2><p>Напишите на <a href="mailto:perekrestov_bus@mail.ru">perekrestov_bus@mail.ru</a>. На письмо с решением администрации тоже можно ответить.</p></section>}
      {tab === 'status' && <div className={styles.stack}>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {!data && !error && <section className={styles.panel}>Загружаем заявку…</section>}
        {data && <>
          <section className={`${styles.statusCard} ${status === 'approved' ? styles.approved : ''}`} aria-live="polite">
            <div className={styles.statusMark}>{status === 'approved' ? '✓' : status === 'pending' ? '◷' : '!'}</div>
            <div className={styles.statusCopy}><span>СТАТУС ЗАЯВКИ</span><h2>{heading}</h2><p>{message}</p></div>
            <button type="button" className={styles.secondary} onClick={() => void checkStatus()} disabled={busy}>Обновить статус</button>
          </section>
          {data.admin_note && <section className={styles.note}><strong>Комментарий администрации</strong><p>{data.admin_note}</p></section>}
          {data.resubmit_after && <p>Повторная подача доступна с {new Date(data.resubmit_after).toLocaleDateString('ru-RU')}.</p>}
          <section className={styles.panel}><h2>Сведения из анкеты</h2><div className={styles.details}>
            <div><span>Вид спорта</span><strong>{data.sport}</strong></div><div><span>Квалификация</span><strong>{data.qualification}</strong></div>
            <div><span>Опыт</span><strong>{data.experience}</strong></div>{data.about && <div><span>О себе</span><strong>{data.about}</strong></div>}
          </div></section>
          <section className={styles.panel}><h2>Приложенные документы</h2><p className={styles.muted}>Файлы доступны только вам и администраторам. В публичном профиле они не появятся.</p>
            <ul className={styles.documents}>{data.documents.map(doc => <li key={doc.id}><a href={`/api/coach-applications/documents/${doc.id}`}>{doc.filename}</a></li>)}</ul>
          </section>
          {data.status === 'approved' && <button type="button" className={styles.primary} onClick={() => void refreshUser()}>Открыть аккаунт тренера</button>}
          {canResubmit && <form className={styles.panel} onSubmit={submit}><h2>Дополнить заявку</h2><div className={styles.fields}>
            <label>Вид спорта <input required minLength={2} maxLength={100} value={details.sport} onChange={e => setDetails({ ...details, sport: e.target.value })} /></label>
            <label>Квалификация <textarea required minLength={2} maxLength={1000} value={details.qualification} onChange={e => setDetails({ ...details, qualification: e.target.value })} /></label>
            <label>Опыт <textarea required minLength={2} maxLength={2000} value={details.experience} onChange={e => setDetails({ ...details, experience: e.target.value })} /></label>
            <label>О себе <textarea maxLength={2000} value={details.about} onChange={e => setDetails({ ...details, about: e.target.value })} /></label>
            <label>Ссылки HTTPS, по одной в строке <textarea value={details.links.join('\n')} onChange={e => setDetails({ ...details, links: e.target.value.split('\n').map(v => v.trim()).filter(Boolean) })} /></label>
            <div><span>Новые документы, если нужны (до 10 МБ каждый)</span><MultiFilePicker label="Новые документы" accept=".pdf,.jpg,.jpeg,.png,.webp" files={files} onSelect={setFiles} hint="PDF, JPG, PNG или WebP" /></div>
          </div><button className={styles.primary} disabled={busy}>{busy ? 'Отправляем…' : 'Отправить повторно'}</button></form>}
        </>}
      </div>}
    </div>
    <SiteFooter />
  </main>;
}
