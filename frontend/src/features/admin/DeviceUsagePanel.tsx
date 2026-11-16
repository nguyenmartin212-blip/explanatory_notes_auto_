import { useEffect, useState, type FormEvent } from 'react';
import { getDeviceUsage, type DeviceUsageReport, type UsagePeriod } from '@/services/adminApi';
import './deviceUsage.css';

const REFRESH_MS = 20_000;
const INITIAL_FILTERS = { period: 'day' as UsagePeriod, from: '', to: '' };
const dateTime = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'medium',
  timeZone: 'UTC',
});
const formatTime = (value: string) => dateTime.format(new Date(value));

export function DeviceUsagePanel({ compact = false }: { compact?: boolean }) {
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [applied, setApplied] = useState(INITIAL_FILTERS);
  const [report, setReport] = useState<DeviceUsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterError, setFilterError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;

    async function load() {
      if (pending || controller.signal.aborted) return;
      pending = true;
      try {
        const result = await getDeviceUsage(applied, controller.signal);
        if (controller.signal.aborted) return;
        setReport(result);
        setError('');
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Không thể tải thống kê thiết bị.');
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const timer = window.setInterval(refreshVisible, REFRESH_MS);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [applied]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (Boolean(filters.from) !== Boolean(filters.to)) {
      setFilterError('Chọn cả ngày bắt đầu và ngày kết thúc, hoặc để trống cả hai.');
      return;
    }
    if (filters.from && filters.from > filters.to) {
      setFilterError('Ngày kết thúc phải từ ngày bắt đầu trở đi.');
      return;
    }
    setFilterError('');
    setError('');
    setLoading(true);
    setReport(null);
    setApplied({ ...filters });
  }

  return (
    <section className="device-usage" aria-label="Thống kê thiết bị">
      <h2 className="device-usage__title">Thiết bị đăng nhập</h2>
      <details className="device-usage__options" open={!compact || undefined}>
        <summary>{applied.period === 'day' ? 'Theo ngày' : 'Theo tháng'}{report ? ` · ${report.from} – ${report.to}` : ''}</summary>
        <form className="device-usage__filters" onSubmit={applyFilters}>
        <label>
          Nhóm theo
          <select
            value={filters.period}
            onChange={(event) => setFilters({ ...filters, period: event.target.value as UsagePeriod })}
          >
            <option value="day">Ngày</option>
            <option value="month">Tháng</option>
          </select>
        </label>
        <label>
          Từ ngày
          <input
            type="date"
            value={filters.from}
            onChange={(event) => setFilters({ ...filters, from: event.target.value })}
          />
        </label>
        <label>
          Đến ngày
          <input
            type="date"
            value={filters.to}
            onChange={(event) => setFilters({ ...filters, to: event.target.value })}
          />
        </label>
        <button type="submit">Áp dụng</button>
        </form>
        {filterError && <p className="device-usage__error" role="alert">{filterError}</p>}
      </details>
      {error && <p className="device-usage__error" role="alert">{error}</p>}
      {loading && <p className="device-usage__note" role="status">Đang tải thống kê…</p>}

      {report && (
        <>
          {!compact && <><dl className="device-usage__summary">
            <div>
              <dt>Thiết bị online</dt>
              <dd>{report.active_device_count.toLocaleString('vi-VN')}</dd>
            </div>
            <div>
              <dt>Phiên trong kỳ</dt>
              <dd>{report.total_sessions.toLocaleString('vi-VN')}</dd>
            </div>
          </dl>
          <p className="device-usage__note">
            Từ {report.from} đến {report.to} (UTC). Cập nhật lúc {formatTime(report.generated_at)} UTC.
          </p></>}

          {report.usage.length > 0 && <DeviceUsageChart usage={report.usage} />}

          {!compact && <section aria-labelledby="device-usage-active">
            <h2 id="device-usage-active">Thiết bị đang hoạt động</h2>
            {report.active_devices.length ? (
              <div className="device-usage__table">
                <table aria-labelledby="device-usage-active">
                  <thead><tr><th scope="col">Thiết bị</th><th scope="col">ID tài khoản</th><th scope="col">Lần cuối (UTC)</th></tr></thead>
                  <tbody>
                    {report.active_devices.map((device) => (
                      <tr key={JSON.stringify([device.user_id, device.device_id])}>
                        <td>{device.device_name}<span className="device-usage__id">{device.device_id}</span></td>
                        <td className="device-usage__id">{device.user_id}</td>
                        <td>{formatTime(device.last_seen_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="device-usage__note">Chưa có thiết bị gửi tín hiệu trong 2 phút gần đây.</p>}
          </section>}

          {!compact && <section aria-labelledby="device-usage-history">
            <h2 id="device-usage-history">Phiên sử dụng theo {report.period === 'day' ? 'ngày' : 'tháng'}</h2>
            {report.usage.length ? (
              <div className="device-usage__table">
                <table aria-labelledby="device-usage-history">
                  <thead><tr><th scope="col">Kỳ (UTC)</th><th scope="col">Số phiên</th><th scope="col">Thiết bị duy nhất</th></tr></thead>
                  <tbody>
                    {report.usage.map((row) => (
                      <tr key={row.period}>
                        <th scope="row">{row.period}</th>
                        <td>{row.sessions.toLocaleString('vi-VN')}</td>
                        <td>{row.uniqueDevices.toLocaleString('vi-VN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="device-usage__note">Chưa ghi nhận phiên sử dụng trong khoảng ngày này.</p>}
          </section>}
          {compact && report.usage.length === 0 && <p className="device-usage__note">Chưa ghi nhận phiên sử dụng trong khoảng ngày này.</p>}
        </>
      )}
    </section>
  );
}

function DeviceUsageChart({ usage }: { usage: DeviceUsageReport['usage'] }) {
  const highest = Math.max(...usage.map((row) => row.uniqueDevices), 1);
  const step = Math.ceil(highest / 4);
  const ticks = [4, 3, 2, 1, 0].map((tick) => tick * step);
  return (
    <figure className="device-usage__chart">
      <figcaption>Số thiết bị duy nhất theo thời gian</figcaption>
      <div className="device-usage__plot">
        <div className="device-usage__axis" aria-hidden="true">{ticks.map((tick) => <span key={tick}>{tick}</span>)}</div>
        <ul className="device-usage__bars" aria-label="Số thiết bị theo kỳ (UTC)">
          {usage.map((row) => (
            <li key={row.period} aria-label={`${row.period}: ${row.uniqueDevices} thiết bị`} title={`${row.period}: ${row.uniqueDevices} thiết bị`}>
              <span className="device-usage__bar" style={{ height: `${row.uniqueDevices / (step * 4) * 100}%` }} />
              <span className="device-usage__period">{row.period.length === 7 ? row.period.replace(/^(\d{4})-(\d{2})$/, '$2/$1') : row.period.slice(5).split('-').reverse().join('/')}</span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}
