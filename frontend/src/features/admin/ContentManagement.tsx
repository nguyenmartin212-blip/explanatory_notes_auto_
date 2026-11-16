import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { getLanguages, getRegions } from '@/features/poi/api';
import { apiMediaUrl } from '@/services/apiConfig';
import {
  activatePoi, AdminApiError, createAdminAccount, createPoi, createQr, deletePoi, deleteQr,
  generateAudio, getAdminPoi, getAdminStats, getCategories, listAdminPois, listLocalizations, listQr,
  saveLocalization, streamAudioTasks, updatePoi, updateQr,
  type AdminPoi, type AdminQr, type AudioTask, type PoiInput,
} from '@/services/adminApi';

function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const run = async (action: () => Promise<unknown>, success = 'Đã lưu thay đổi.') => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      await action();
      setMessage(success);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Yêu cầu thất bại. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, run, feedback: <>
    {busy && <p role="status">Đang xử lý…</p>}
    {message && <p role="status">{message}</p>}
    {error && <p className="heritage-error" role="alert">{error}</p>}
  </> };
}

function useAdminData<T>(load: () => Promise<T>, revision: number) {
  const [value, setValue] = useState<T | null>(null);
  const [status, setStatus] = useState({ pending: true, error: '' });
  useEffect(() => {
    let active = true;
    setStatus({ pending: true, error: '' });
    void load().then((data) => {
      if (active) { setValue(data); setStatus({ pending: false, error: '' }); }
    }, (error: unknown) => {
      if (active) setStatus({ pending: false, error: error instanceof Error ? error.message : 'Không tải được dữ liệu.' });
    });
    return () => { active = false; };
  }, [load, revision]);
  return { value, ...status };
}

function DataStatus({ pending, error }: { pending: boolean; error: string }) {
  return <>
    {pending && <p role="status">Đang tải dữ liệu…</p>}
    {error && <p role="alert" className="heritage-error">{error}</p>}
  </>;
}

const button = 'heritage-button';
const primary = 'heritage-button heritage-primary';

export function CreateAccountForm({ changed }: { changed: () => void }) {
  const action = useAction();
  return <div className="admin-workflow">
    <h3>Thêm tài khoản</h3>
    <form onSubmit={(event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      void action.run(async () => {
        await createAdminAccount({
          username: String(data.get('username')).trim(), password: String(data.get('password')), role: String(data.get('role')),
        });
        form.reset();
        changed();
      }, 'Đã tạo tài khoản.');
    }}>
      <fieldset disabled={action.busy}>
        <div className="admin-workflow-fields">
          <label>Tên đăng nhập<input name="username" autoComplete="off" required minLength={3} maxLength={50} /></label>
          <label>Mật khẩu<input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} /></label>
          <label>Vai trò<select name="role" aria-label="Vai trò"><option value="admin">Admin</option><option value="super_admin">Super Admin</option></select></label>
        </div>
        <button className={primary}>Tạo tài khoản</button>
      </fieldset>
    </form>
    {action.feedback}
  </div>;
}

const getPoiData = async () => {
  const [pois, regions, categories] = await Promise.all([listAdminPois(), getRegions(), getCategories()]);
  return { pois, regions, categories };
};

export function AdminPoiPanel({ audioQueue }: { audioQueue: boolean }) {
  const [revision, setRevision] = useState(0);
  const [id, setId] = useState<number | 'new'>('new');
  const data = useAdminData(getPoiData, revision);
  const current = data.value?.pois.find((poi) => poi.id === id);
  return <section className="admin-workflow">
    <div className="admin-workflow-actions">
      <label>Điểm tham quan
        <select aria-label="Điểm tham quan" value={id} onChange={(event) => setId(event.currentTarget.value === 'new' ? 'new' : Number(event.currentTarget.value))}>
          <option value="new">Thêm điểm mới</option>
          {data.value?.pois.map((poi) => <option key={poi.id} value={poi.id}>{poi.name_vi} · {poi.is_active ? 'Công khai' : 'Đang ẩn'}</option>)}
        </select>
      </label>
      <button className={button} type="button" onClick={() => setRevision((n) => n + 1)}>Làm mới danh sách</button>
    </div>
    <DataStatus {...data} />
    {data.value && !data.value.pois.length && <p>Chưa có điểm tham quan.</p>}
    {data.value && (current || id === 'new') && <PoiEditor key={id} id={id}
      options={data.value} audioQueue={audioQueue} changed={(nextId) => { setId(nextId); setRevision((n) => n + 1); }} />}
  </section>;
}

function PoiEditor({ id, options, audioQueue, changed }: {
  id: number | 'new'; options: Awaited<ReturnType<typeof getPoiData>>; changed: (id: number | 'new') => void;
  audioQueue: boolean;
}) {
  const load = useCallback(() => id === 'new' ? Promise.resolve(null) : getAdminPoi(id), [id]);
  const [revision, setRevision] = useState(0);
  const result = useAdminData(load, revision);
  const poi = result.value;
  const action = useAction();
  const saved = (next: AdminPoi) => {
    changed(next.id);
    setRevision((n) => n + 1);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const string = (field: string) => String(fields.get(field) ?? '').trim();
    const data: PoiInput = {
      name_vi: string('name'), description_vi: string('description'),
      latitude: Number(string('latitude')), longitude: Number(string('longitude')),
      trigger_radius: Number(string('radius')), audio_priority: Number(string('priority')),
      region_id: Number(string('region')), category_id: Number(string('category')) || null,
      cover_image_url: string('cover') || null, image_urls: string('images').split('\n').map((line) => line.trim()).filter(Boolean),
    };
    void action.run(async () => saved(poi ? await updatePoi(poi.id, data) : await createPoi(data)));
  };
  return <>
    <DataStatus {...result} />
    {!result.pending && (id === 'new' || poi) && <form key={revision} onSubmit={submit}>
      <fieldset disabled={action.busy || result.pending}>
        <div className="admin-workflow-fields">
          <label>Tên tiếng Việt<input name="name" required minLength={2} maxLength={200} defaultValue={poi?.name_vi} /></label>
          <label>Miền<select name="region" aria-label="Miền" defaultValue={poi?.region_id ?? ''} required>
            <option value="">Chọn miền</option>
            {options.regions.map((region) => <option key={region.id} value={region.id}>{region.name_vi}</option>)}
          </select></label>
          <label>Danh mục<select name="category" aria-label="Danh mục" defaultValue={poi?.category_id ?? ''}>
            <option value="">Không có danh mục</option>
            {options.categories.map((category) => <option key={category.id} value={category.id}>{category.name_vi}</option>)}
          </select></label>
          <label>Vĩ độ<input name="latitude" type="number" step="any" min={8} max={24} defaultValue={poi?.latitude} required /></label>
          <label>Kinh độ<input name="longitude" type="number" step="any" min={102} max={110} defaultValue={poi?.longitude} required /></label>
          <label>Bán kính kích hoạt (m)<input name="radius" type="number" min={10} max={500} defaultValue={poi?.trigger_radius ?? 50} required /></label>
          <label>Ưu tiên audio<input name="priority" type="number" min={0} max={100} defaultValue={poi?.audio_priority ?? 0} required /></label>
          <label>Đường dẫn ảnh bìa<input name="cover" maxLength={500} defaultValue={poi?.cover_image_url ?? ''} /></label>
          <label className="admin-workflow-wide">Ảnh bổ sung (mỗi dòng một đường dẫn)<textarea name="images" rows={3} defaultValue={poi?.image_urls?.join('\n')} /></label>
          <label className="admin-workflow-wide">Nội dung thuyết minh tiếng Việt<textarea name="description" required minLength={20} rows={5} defaultValue={poi?.description_vi} /></label>
        </div>
        <div className="admin-workflow-actions">
          <button className={primary}>{poi ? 'Lưu thông tin điểm' : 'Tạo điểm tham quan'}</button>
          {poi && <>
            <button className={button} type="button" onClick={() => {
              const label = poi.is_active ? 'Ẩn' : 'Công khai';
              if (window.confirm(`${label} điểm “${poi.name_vi}”?`)) void action.run(async () => saved(await activatePoi(poi.id, !poi.is_active)));
            }}>{poi.is_active ? 'Ẩn điểm' : 'Công khai điểm'}</button>
            <button className={button} type="button" onClick={() => {
              if (window.confirm(`Xóa điểm “${poi.name_vi}”?`)) void action.run(async () => { await deletePoi(poi.id); changed('new'); });
            }}>Xóa điểm</button>
          </>}
        </div>
      </fieldset>
    </form>}
    {action.feedback}
    {poi && <TranslationPanel id={poi.id} audioQueue={audioQueue} />}
  </>;
}

const taskLabel = { queued: 'Đang chờ', running: 'Đang xử lý', completed: 'Hoàn thành', failed: 'Thất bại' };
const audioLabel: Record<string, string> = { none: 'Chưa có audio', processing: 'Đang xử lý', ready: 'Audio sẵn sàng', failed: 'Tạo audio thất bại' };

function TranslationPanel({ id, audioQueue }: { id: number; audioQueue: boolean }) {
  const [revision, setRevision] = useState(0);
  const [lang, setLang] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [tasks, setTasks] = useState<AudioTask[]>([]);
  const [streamStatus, setStreamStatus] = useState('');
  const load = useCallback(async () => {
    const [languages, localizations] = await Promise.all([getLanguages(), listLocalizations(id)]);
    return { languages, localizations };
  }, [id]);
  const result = useAdminData(load, revision);
  const action = useAction();
  const effectiveLang = lang || result.value?.languages.find(({ code }) => code !== 'vi')?.code || '';
  const loc = result.value?.localizations.find(({ lang_code }) => lang_code === effectiveLang);

  useEffect(() => {
    if (!audioQueue) {
      const interval = window.setInterval(() => setRevision((n) => n + 1), 5000);
      return () => window.clearInterval(interval);
    }
    const controller = new AbortController();
    let retry: number | undefined;
    let initialized = false;
    const connect = () => {
      void streamAudioTasks(controller.signal, (incoming, snapshot) => {
        setStreamStatus('');
        const current = incoming.filter((task) => task.poi_id === id);
        setTasks((previous) => snapshot ? current : [
          ...current, ...previous.filter((task) => !current.some((item) => item.task_id === task.task_id)),
        ].slice(0, 20));
        if ((snapshot && initialized) || (!snapshot && current.some((task) => task.status === 'completed' || task.status === 'failed'))) {
          setRevision((n) => n + 1);
        }
        initialized = true;
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setStreamStatus(error instanceof AdminApiError && error.status === 401
          ? 'Phiên quản trị đã hết hạn.' : 'Mất kết nối theo dõi tác vụ. Đang thử lại…');
      }).finally(() => {
        if (!controller.signal.aborted) retry = window.setTimeout(connect, 3000);
      });
    };
    connect();
    return () => { controller.abort(); window.clearTimeout(retry); };
  }, [id, audioQueue]);

  return <section className="admin-workflow-subsection">
    <h3>Bản dịch và audio</h3>
    <DataStatus {...result} />
    {result.value && <>
      <label>Ngôn ngữ bản dịch<select aria-label="Ngôn ngữ bản dịch" value={effectiveLang} onChange={(event) => setLang(event.currentTarget.value)}>
        {!effectiveLang && <option value="">Chưa có ngôn ngữ dịch</option>}
        {result.value.languages.filter(({ code }) => code !== 'vi').map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
      </select></label>
      {effectiveLang && <>
        <p>{loc ? `${loc.is_machine_translated ? 'Dịch tự động' : 'Bản sửa thủ công'} · ${audioLabel[loc.audio_status] ?? loc.audio_status}` : 'Chưa có bản dịch.'}</p>
        {loc?.audio_status === 'ready' && loc.audio_url && <audio controls preload="none" src={apiMediaUrl(loc.audio_url)} />}
        <form key={`${effectiveLang}:${loc?.name}:${loc?.description}`} onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void action.run(async () => {
            await saveLocalization(id, effectiveLang, String(data.get('name')).trim(), String(data.get('description')).trim());
            setRevision((n) => n + 1);
          }, 'Đã lưu bản dịch thủ công và xếp hàng tạo audio.');
        }}>
          <fieldset disabled={action.busy}>
            <div className="admin-workflow-fields">
              <label>Tên điểm<input name="name" required maxLength={200} defaultValue={loc?.name} /></label>
              <label className="admin-workflow-wide">Nội dung<textarea name="description" rows={4} required minLength={10} defaultValue={loc?.description} /></label>
            </div>
            <button className={button}>Lưu bản dịch</button>
          </fieldset>
        </form>
      </>}
      <fieldset disabled={action.busy}>
        <legend>Ngôn ngữ cần sinh audio</legend>
        <div className="admin-workflow-actions">
          {result.value.languages.map(({ code, name }) => <label className="admin-workflow-check" key={code}><input type="checkbox"
            checked={selected.includes(code)} onChange={(event) => {
              const checked = event.currentTarget.checked;
              setSelected((current) => checked ? [...current, code] : current.filter((item) => item !== code));
            }} />{name}</label>)}
        </div>
        <button className={primary} type="button" disabled={!selected.length} onClick={() => void action.run(async () => {
          const { task_id } = await generateAudio(id, selected);
          if (task_id === null) {
            setRevision((n) => n + 1);
            return;
          }
          const queued: AudioTask = {
            task_id, poi_id: id, status: 'queued', progress: 0, error: null, updated_at: new Date().toISOString(),
          };
          setTasks((previous) => previous.some((task) => task.task_id === task_id) ? previous : [queued, ...previous].slice(0, 20));
        }, audioQueue ? 'Đã đưa yêu cầu vào hàng đợi.' : 'Đã gửi yêu cầu tạo audio. Theo dõi ở trạng thái bản dịch.')}>Sinh hoặc chạy lại audio</button>
      </fieldset>
    </>}
    {action.feedback}
    {streamStatus && <p role="status">{streamStatus}</p>}
    {audioQueue && (tasks.length ? <ul className="admin-task-list">{tasks.map((task) => <li key={task.task_id}>
      <strong>#{task.task_id} · {taskLabel[task.status]}</strong>
      <progress aria-label={`Tiến trình tác vụ ${task.task_id}`} value={task.progress} max={100} />
      <span>{task.progress}%</span>
      {task.error && <span role="status">{task.error}</span>}
    </li>)}</ul> : <p>Chưa có tác vụ audio cho điểm này.</p>)}
  </section>;
}

const getQrData = async () => {
  const [codes, pois] = await Promise.all([listQr(), listAdminPois()]);
  return { codes, pois };
};

export function AdminQrPanel() {
  const [revision, setRevision] = useState(0);
  const [id, setId] = useState<number | 'new'>('new');
  const [qrImage, setQrImage] = useState('');
  const data = useAdminData(getQrData, revision);
  const qr = data.value?.codes.find((entry) => entry.id === id);
  const action = useAction();
  const code = qr?.code;
  const link = code ? `${location.origin}/?${new URLSearchParams({ qr: code })}` : '';

  useEffect(() => {
    let active = true;
    setQrImage('');
    if (link) void import('qrcode').then(({ toDataURL }) => toDataURL(link, {
      scale: 14, margin: 4, errorCorrectionLevel: 'H',
    })).then((image) => {
      if (active) setQrImage(image);
    }).catch(() => { if (active) setQrImage('error'); });
    return () => { active = false; };
  }, [link]);

  const reload = (nextId: number | 'new') => { setId(nextId); setRevision((n) => n + 1); };
  return <section className="admin-workflow">
    <div className="admin-workflow-actions">
      <label>Mã QR<select aria-label="Mã QR" value={id} onChange={(event) => setId(event.currentTarget.value === 'new' ? 'new' : Number(event.currentTarget.value))}>
        <option value="new">Tạo mã mới</option>
        {data.value?.codes.map((entry) => <option key={entry.id} value={entry.id}>{entry.label} · {entry.code}</option>)}
      </select></label>
      <button className={button} type="button" onClick={() => setRevision((n) => n + 1)}>Làm mới danh sách</button>
    </div>
    <DataStatus {...data} />
    {data.value && !data.value.codes.length && <p>Chưa có mã QR.</p>}
    {data.value && !data.pending && (qr || id === 'new') && <form key={`${id}:${revision}`} onSubmit={(event) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const label = String(fields.get('label')).trim();
      const poi_id = Number(fields.get('poi')) || null;
      const is_active = fields.has('active');
      if (qr && qr.is_active !== is_active && !window.confirm(`${is_active ? 'Bật' : 'Tắt'} mã “${qr.code}”?`)) return;
      void action.run(async () => {
        const saved: AdminQr = qr ? await updateQr(qr.id, { label, poi_id, is_active })
          : await createQr({ code: String(fields.get('code')).trim(), label, poi_id });
        reload(saved.id);
      });
    }}>
      <fieldset disabled={action.busy || data.pending}>
        <div className="admin-workflow-fields">
          <label>Mã<input name="code" required pattern="[A-Za-z0-9_\\-]{3,40}" defaultValue={code} readOnly={Boolean(qr)} /></label>
          <label>Nhãn<input name="label" required minLength={2} maxLength={150} defaultValue={qr?.label} /></label>
          <label>Điểm liên kết<select name="poi" aria-label="Điểm liên kết" defaultValue={qr?.poi_id ?? ''}>
            <option value="">Mở trang khám phá</option>
            {data.value.pois.map((poi) => <option key={poi.id} value={poi.id}>{poi.name_vi}{poi.is_active ? '' : ' (đang ẩn)'}</option>)}
          </select></label>
          {qr && <label className="admin-workflow-check"><input name="active" type="checkbox" defaultChecked={qr.is_active} />Mã đang hoạt động</label>}
        </div>
        <div className="admin-workflow-actions">
          <button className={primary}>{qr ? 'Lưu mã QR' : 'Tạo mã QR'}</button>
          {qr && <button className={button} type="button" onClick={() => {
            if (window.confirm(`Xóa mã “${qr.code}”?`)) void action.run(async () => { await deleteQr(qr.id); reload('new'); }, 'Đã xóa mã QR.');
          }}>Xóa mã QR</button>}
        </div>
      </fieldset>
    </form>}
    {action.feedback}
    {qr && <div className="admin-workflow-subsection">
      {qrImage === 'error' ? <p role="alert">Không tạo được ảnh QR cho đường dẫn này.</p> : qrImage && <>
        <img className="admin-qr-image" src={qrImage} alt={`Mã QR ${qr.label}`} />
        <a className={button} href={qrImage} download={`qr-${qr.code}.png`}>Tải mã QR (PNG)</a>
      </>}
      <p><a href={link} target="_blank" rel="noreferrer">{link}</a></p>
    </div>}
  </section>;
}

export function VisitorStats({ revision }: { revision: number }) {
  const stats = useAdminData(getAdminStats, revision);
  const [period, setPeriod] = useState(7);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (period - 1));
  const firstDay = [cutoff.getFullYear(), String(cutoff.getMonth() + 1).padStart(2, '0'), String(cutoff.getDate()).padStart(2, '0')].join('-');
  return <section className="admin-workflow">
    <h3>Thống kê du khách</h3>
    <DataStatus {...stats} />
    {stats.value && <>
      <dl className="admin-stats-grid">{([
        ['Đang online', stats.value.online_now], ['Lượt quét QR', stats.value.total_qr_scans],
        ['Khách duy nhất', stats.value.unique_visitors], ['Phiên tham quan', stats.value.total_sessions],
      ] as const).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count.toLocaleString('vi-VN')}</dd></div>)}</dl>
      <div className="admin-workflow-fields">
        <label>Số ngày hiển thị<select aria-label="Số ngày hiển thị" value={period} onChange={(event) => setPeriod(Number(event.currentTarget.value))}>
          <option value={3}>3 ngày gần nhất</option><option value={7}>7 ngày gần nhất</option>
        </select></label>
      </div>
      <div className="admin-workflow-fields">{[
        { title: 'Lượt quét theo ngày', rows: stats.value.scans_last_7_days.filter(({ date }) => date >= firstDay).map(({ date, count }) => ({ key: date, name: date, count })) },
        { title: 'Lượt khách theo ngày', rows: stats.value.visitors_last_7_days.filter(({ date }) => date >= firstDay).map(({ date, count }) => ({ key: date, name: date, count })) },
        { title: 'Điểm được xem nhiều nhất', rows: stats.value.top_pois_by_views.map(({ poi_id, name, count }) => ({ key: poi_id, name, count })) },
        { title: 'Điểm được nghe nhiều nhất', rows: stats.value.top_pois_by_plays.map(({ poi_id, name, count }) => ({ key: poi_id, name, count })) },
      ].map(({ title, rows }) => <div key={title}><h4>{title}</h4>{rows.length ?
        <ul>{rows.map(({ key, name, count }) => <li key={key}>{name} · {count.toLocaleString('vi-VN')}</li>)}</ul> : <p>Chưa có số liệu.</p>}</div>)}</div>
    </>}
  </section>;
}
