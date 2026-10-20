import { eq } from 'drizzle-orm';
import { dictionaryEntries } from '@/db/schema';
import { createMemoryRepository } from '@/data/local/__tests__/testDb';
import type { LocalNotesRepository } from '@/data/local/notesRepository';
import type { TestDb } from '@/data/local/__tests__/testDb';

let mockRepo: LocalNotesRepository;
let mockDatabase: TestDb;
jest.mock('@/data', () => ({
  get notesRepository() {
    return mockRepo;
  },
}));
jest.mock('@/db', () => ({
  get db() {
    return mockDatabase;
  },
}));
jest.mock('@/data/remote/dictionaryApi', () => ({
  fetchDictionary: jest.fn(),
  fetchDictionarySnapshot: jest.fn(),
}));

import { pullDictionary } from '../pullDictionary';
import { fetchDictionary, fetchDictionarySnapshot } from '@/data/remote/dictionaryApi';
import type { RemoteDictionaryEntry } from '@/data/remote/dictionaryApi';
import {
  DICTIONARY_CURSOR_ID_KEY,
  DICTIONARY_CURSOR_KEY,
  DICTIONARY_SHARED_AT_BACKFILL_KEY,
} from '../pullCursors';

const SHARED_AT = '2026-10-20T09:00:00.000Z';

const remoteEntry = (overrides: Partial<RemoteDictionaryEntry> = {}): RemoteDictionaryEntry => ({
  id: 'remote-1',
  client_dict_id: 'client-1',
  word: 'Kubernetes',
  source: 'manual',
  deleted_at: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-02T00:00:00.000Z',
  shared_at: null,
  ...overrides,
});

const insertLocal = (overrides: Partial<typeof dictionaryEntries.$inferInsert> = {}): void => {
  mockDatabase
    .insert(dictionaryEntries)
    .values({
      word: 'Kubernetes',
      source: 'manual',
      clientDictId: 'client-1',
      remoteId: 'remote-1',
      pendingSync: 0,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
      ...overrides,
    })
    .run();
};

const readRow = (): typeof dictionaryEntries.$inferSelect | undefined =>
  mockDatabase
    .select()
    .from(dictionaryEntries)
    .where(eq(dictionaryEntries.word, 'Kubernetes'))
    .get();

beforeEach(() => {
  jest.resetAllMocks();
  const memory = createMemoryRepository();
  mockRepo = memory.repo;
  mockDatabase = memory.db;
  jest.mocked(fetchDictionarySnapshot).mockResolvedValue({ entries: [], hasMore: false });
  jest.mocked(fetchDictionary).mockResolvedValue({ entries: [], hasMore: false });
  // Most tests start past the one-time backfill so the cursor stays put.
  mockRepo.setSyncState(DICTIONARY_SHARED_AT_BACKFILL_KEY, '1');
});

describe('pullDictionary shared_at', () => {
  it('stores shared_at on an existing row', async () => {
    insertLocal();
    mockRepo.setSyncState(DICTIONARY_CURSOR_KEY, '2026-10-02T00:00:00.000Z');
    jest
      .mocked(fetchDictionary)
      .mockResolvedValueOnce({ entries: [remoteEntry({ shared_at: SHARED_AT })], hasMore: false });

    await pullDictionary();

    expect(readRow()?.sharedAt).toBe(SHARED_AT);
  });

  it('stores shared_at on insert', async () => {
    jest
      .mocked(fetchDictionarySnapshot)
      .mockResolvedValueOnce({ entries: [remoteEntry({ shared_at: SHARED_AT })], hasMore: false });

    await pullDictionary();

    expect(readRow()?.sharedAt).toBe(SHARED_AT);
  });

  it('applies an update that changes only shared_at (same updated_at)', async () => {
    insertLocal({ sharedAt: null });
    mockRepo.setSyncState(DICTIONARY_CURSOR_KEY, '2026-10-02T00:00:00.000Z');
    jest
      .mocked(fetchDictionary)
      .mockResolvedValueOnce({ entries: [remoteEntry({ shared_at: SHARED_AT })], hasMore: false });

    await pullDictionary();

    expect(readRow()).toMatchObject({ sharedAt: SHARED_AT, updatedAt: '2026-10-02T00:00:00.000Z' });
  });

  it('clears shared_at when the payload sends an explicit null', async () => {
    insertLocal({ sharedAt: SHARED_AT });
    mockRepo.setSyncState(DICTIONARY_CURSOR_KEY, '2026-10-02T00:00:00.000Z');
    jest
      .mocked(fetchDictionary)
      .mockResolvedValueOnce({ entries: [remoteEntry({ shared_at: null })], hasMore: false });

    await pullDictionary();

    expect(readRow()?.sharedAt).toBeNull();
  });

  it('keeps the local shared_at when an older API omits the field', async () => {
    insertLocal({ sharedAt: SHARED_AT });
    mockRepo.setSyncState(DICTIONARY_CURSOR_KEY, '2026-10-02T00:00:00.000Z');
    const legacy: Partial<RemoteDictionaryEntry> = remoteEntry();
    delete legacy.shared_at;
    jest.mocked(fetchDictionary).mockResolvedValueOnce({
      entries: [legacy as RemoteDictionaryEntry],
      hasMore: false,
    });

    await pullDictionary();

    expect(readRow()?.sharedAt).toBe(SHARED_AT);
  });

  it('still records shared_at on a row with a pending local edit', async () => {
    insertLocal({ pendingSync: 1, word: 'Kubernetes' });
    mockRepo.setSyncState(DICTIONARY_CURSOR_KEY, '2026-10-02T00:00:00.000Z');
    jest.mocked(fetchDictionary).mockResolvedValueOnce({
      entries: [remoteEntry({ word: 'Kubernetes', shared_at: SHARED_AT })],
      hasMore: false,
    });

    await pullDictionary();

    expect(readRow()).toMatchObject({ sharedAt: SHARED_AT, pendingSync: 1 });
  });
});

describe('pullDictionary shared_at backfill', () => {
  it('clears the dictionary cursor exactly once', async () => {
    mockRepo.clearSyncState(DICTIONARY_SHARED_AT_BACKFILL_KEY);
    mockRepo.setSyncState(DICTIONARY_CURSOR_KEY, '2026-10-02T00:00:00.000Z');
    mockRepo.setSyncState(DICTIONARY_CURSOR_ID_KEY, 'remote-1');
    jest
      .mocked(fetchDictionarySnapshot)
      .mockResolvedValueOnce({ entries: [remoteEntry({ shared_at: SHARED_AT })], hasMore: false });

    await pullDictionary();

    // First run walked the snapshot, so the cursor was cleared and then rebuilt from it.
    expect(fetchDictionarySnapshot).toHaveBeenCalledTimes(1);
    expect(fetchDictionary).not.toHaveBeenCalled();
    expect(mockRepo.getSyncState(DICTIONARY_SHARED_AT_BACKFILL_KEY)).toBeTruthy();
    expect(mockRepo.getSyncState(DICTIONARY_CURSOR_KEY)).toBe('2026-10-02T00:00:00.000Z');

    await pullDictionary();

    // Second run is a plain delta from the saved cursor.
    expect(fetchDictionarySnapshot).toHaveBeenCalledTimes(1);
    expect(fetchDictionary).toHaveBeenCalledTimes(1);
    expect(jest.mocked(fetchDictionary).mock.calls[0][0]).toBe('2026-10-02T00:00:00.000Z');
  });

  it('refreshes shared_at on a row a cursor had already passed', async () => {
    insertLocal();
    mockRepo.clearSyncState(DICTIONARY_SHARED_AT_BACKFILL_KEY);
    mockRepo.setSyncState(DICTIONARY_CURSOR_KEY, '2026-10-05T00:00:00.000Z');
    jest
      .mocked(fetchDictionarySnapshot)
      .mockResolvedValueOnce({ entries: [remoteEntry({ shared_at: SHARED_AT })], hasMore: false });

    await pullDictionary();

    expect(readRow()?.sharedAt).toBe(SHARED_AT);
  });

  it('keeps the cursor and runs a delta when the backfill already happened', async () => {
    mockRepo.setSyncState(DICTIONARY_CURSOR_KEY, '2026-10-05T00:00:00.000Z');

    await pullDictionary();

    expect(fetchDictionarySnapshot).not.toHaveBeenCalled();
    expect(jest.mocked(fetchDictionary).mock.calls[0][0]).toBe('2026-10-05T00:00:00.000Z');
  });
});
