// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdminSettings } from '../../apps/web/src/components/admin-settings';

const { request } = vi.hoisted(() => ({ request: vi.fn().mockResolvedValue({}) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../../apps/web/src/lib/utils', async (original) => ({
  ...(await original<typeof import('../../apps/web/src/lib/utils')>()),
  request,
}));
vi.mock('../../apps/web/src/components/reauthentication', () => ({
  useReauthentication: () => ({
    run: (work: () => Promise<unknown>) => work(),
    confirmation: null,
  }),
}));
afterEach(() => {
  cleanup();
  request.mockClear();
});

it('edits active policy controls without presenting an ineffective reopen setting or overwriting legacy policy', async () => {
  render(
    <AdminSettings
      policy={{
        universityName: 'دانشگاه آزمون',
        supportDescription: '',
        maxUploadBytes: 2097152,
        maxVoiceSeconds: 180,
        reopenDays: 37,
        allowUserUrgent: false,
      }}
    />,
  );
  expect(screen.queryByLabelText('مهلت بازگشایی درخواست حل‌شده (روز)')).toBeNull();
  fireEvent.change(screen.getByLabelText('حداکثر مدت وویس (ثانیه)'), { target: { value: '240' } });
  fireEvent.click(screen.getByRole('button', { name: 'ذخیره اطلاعات سامانه' }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({
    maxVoiceSeconds: 240,
    reopenDays: 37,
  });
});
