import {
  adminLogin,
  getVisitorVisits,
} from '@/services/adminApi';
import { hasAdminPermission } from '@/features/admin/permissions';

describe('admin API client', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('uses cookie credentials for login and sends the login payload', async () => {
    const responseBody = {
      user: {
        user_id: 'user-1',
        username: 'admin',
        role: 'admin',
        is_active: true,
        permissions: ['visitor:read'],
      },
      access_token: 'not-to-be-persisted',
      refresh_token: 'not-to-be-persisted',
    };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => responseBody,
    });
    global.fetch = fetchMock;

    await adminLogin('admin', 'password');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/admin\/auth\/login$/),
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ username: 'admin', password: 'password' }),
      }),
    );
  });

  it('sends pagination and POI filters to the protected visitor endpoint', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], total: 0, limit: 20, offset: 40 }),
    });
    global.fetch = fetchMock;

    await getVisitorVisits(20, 40, 'poi-hue-citadel');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/admin\/visitor-visits\?limit=20&offset=40&poi_id=poi-hue-citadel$/),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('recognizes explicit permissions and the super-admin wildcard', () => {
    expect(hasAdminPermission(['visitor:read'], 'visitor:read')).toBe(true);
    expect(hasAdminPermission(['user:read'], 'visitor:read')).toBe(false);
    expect(hasAdminPermission(['*'], 'visitor:read')).toBe(true);
    expect(hasAdminPermission(undefined, 'visitor:read')).toBe(false);
  });
});
