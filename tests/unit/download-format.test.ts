import { expect, it } from 'vitest';
import {
  downloadSize,
  downloadPercent,
  type DownloadState,
} from '../../apps/web/src/lib/downloads';

it('reports actual transfer sizes and only reports completion after the stream ends', () => {
  const state: DownloadState = {
    id: 'file',
    filename: 'file.txt',
    status: 'downloading',
    received: 1048576,
    total: 2 * 1048576,
  };
  expect(downloadSize(state)).toBe('1.00 MB / 2.00 MB');
  expect(downloadPercent(state)).toBe(50);
  expect(downloadPercent({ ...state, received: state.total! })).toBe(99);
  expect(downloadPercent({ ...state, status: 'complete', received: state.total! })).toBe(100);
  expect(downloadPercent({ ...state, total: null })).toBeNull();
  expect(downloadSize({ ...state, received: 512, total: 1024 })).toBe('0.50 KB / 1.00 KB');
  expect(downloadSize({ ...state, received: 1.24 * 1024 ** 2, total: 10.59 * 1024 ** 2 })).toBe(
    '1.24 MB / 10.59 MB',
  );
  expect(downloadSize({ ...state, received: 1.24 * 1024 ** 3, total: 10.59 * 1024 ** 3 })).toBe(
    '1.24 GB / 10.59 GB',
  );
  expect(downloadSize({ ...state, received: 512, total: 999 })).toBe('512 B / 999 B');
  expect(downloadSize({ ...state, received: 1.24 * 1024 ** 2, total: null })).toBe('1.24 MB');
});
