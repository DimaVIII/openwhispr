import { eq } from 'drizzle-orm';
import { notes, transcriptSegments } from '@/db/schema';
import { createMemoryRepository, type TestDb } from './testDb';

type SeedNote = {
  title?: string;
  content?: string;
  enhancedContent?: string | null;
  transcript?: string | null;
  isPrivate?: number;
  leftTeam?: number;
  deletedAt?: string | null;
  updatedAt: string;
};

const seed = (
  repo: ReturnType<typeof createMemoryRepository>['repo'],
  db: TestDb,
  { updatedAt, ...fields }: SeedNote,
): number => {
  const note = repo.createNote(fields.title ?? 'Untitled', fields.content ?? '');
  db.update(notes)
    .set({ ...fields, updatedAt })
    .where(eq(notes.id, note.id))
    .run();
  return note.id;
};

describe('LocalNotesRepository.getChatCandidateNotes', () => {
  it('matches a term in the AI summary', () => {
    const { repo, db } = createMemoryRepository();
    const id = seed(repo, db, {
      title: 'Budget sync',
      content: 'plain content',
      enhancedContent: 'Team stays at $12',
      updatedAt: '2026-10-01 10:00:00',
    });
    seed(repo, db, { title: 'Other', content: 'nothing', updatedAt: '2026-10-02 10:00:00' });

    const result = repo.getChatCandidateNotes(['$12'], { includePrivate: false, limit: 10 });

    expect(result.map((note) => note.id)).toEqual([id]);
  });

  it('matches a term in the transcript segments', () => {
    const { repo, db } = createMemoryRepository();
    // A note created first gives the segments ids that differ from their note's id.
    seed(repo, db, { title: 'Other', updatedAt: '2026-10-01 09:00:00' });
    const id = repo.createNote('Weekly sync', '').id;
    repo.replaceSegments(id, [
      { noteId: id, startMs: 0, endMs: 1000, text: 'hello everyone' },
      { noteId: id, startMs: 1000, endMs: 2000, text: 'we agreed on the roadmap' },
    ]);

    const result = repo.getChatCandidateNotes(['roadmap'], { includePrivate: false, limit: 10 });

    expect(result.map((note) => note.id)).toEqual([id]);
  });

  it('never matches the keys of the transcript JSON', () => {
    const { repo, db } = createMemoryRepository();
    seed(repo, db, {
      title: 'Weekly sync',
      transcript: JSON.stringify([{ source: 'system', text: 'hi', speakerLockSource: 'user' }]),
      updatedAt: '2026-10-01 10:00:00',
    });

    for (const term of ['source', 'system', 'text', 'user']) {
      expect(repo.getChatCandidateNotes([term], { includePrivate: false, limit: 10 })).toEqual([]);
    }
  });

  it('ignores deleted transcript segments', () => {
    const { repo, db } = createMemoryRepository();
    const id = repo.createNote('Weekly sync', '').id;
    repo.replaceSegments(id, [{ noteId: id, startMs: 0, endMs: 1000, text: 'roadmap' }]);
    db.update(transcriptSegments).set({ deletedAt: '2026-10-01 10:00:00' }).run();

    expect(repo.getChatCandidateNotes(['roadmap'], { includePrivate: false, limit: 10 })).toEqual(
      [],
    );
  });

  it('keeps the notes matching the most terms when the pool is cut', () => {
    const { repo, db } = createMemoryRepository();
    const acme = seed(repo, db, {
      title: 'Acme kickoff',
      content: 'Kickoff with Acme on the 4th.',
      updatedAt: '2026-09-01 10:00:00',
    });
    const bodyOnly = seed(repo, db, {
      content: 'acme and kickoff both mentioned',
      updatedAt: '2026-09-02 10:00:00',
    });
    for (let day = 10; day < 20; day += 1) {
      seed(repo, db, { content: 'another kickoff', updatedAt: `2026-10-${day} 10:00:00` });
    }

    const result = repo.getChatCandidateNotes(['acme', 'kickoff'], {
      includePrivate: false,
      limit: 2,
    });

    expect(result.map((note) => note.id)).toEqual([acme, bodyOnly]);
  });

  it('ranks a meeting matching every term in its transcript above newer single matches', () => {
    const { repo, db } = createMemoryRepository();
    const meeting = seed(repo, db, { title: 'Leadership sync', updatedAt: '2026-09-01 10:00:00' });
    repo.replaceSegments(meeting, [
      { noteId: meeting, startMs: 0, endMs: 1000, text: 'The hiring freeze holds.' },
    ]);
    for (let day = 10; day < 14; day += 1) {
      seed(repo, db, { content: 'A hiring update.', updatedAt: `2026-10-${day} 10:00:00` });
    }

    const result = repo.getChatCandidateNotes(['hiring', 'freeze'], {
      includePrivate: false,
      limit: 4,
    });

    expect(result[0].id).toBe(meeting);
    expect(result).toHaveLength(4);
  });

  it('treats % and _ in a term literally', () => {
    const { repo, db } = createMemoryRepository();
    const id = seed(repo, db, { content: 'grew 50% this year', updatedAt: '2026-10-01 10:00:00' });
    seed(repo, db, { content: 'grew 500 this year', updatedAt: '2026-10-02 10:00:00' });

    const result = repo.getChatCandidateNotes(['50%'], { includePrivate: false, limit: 10 });

    expect(result.map((note) => note.id)).toEqual([id]);
  });

  it('excludes private notes unless asked', () => {
    const { repo, db } = createMemoryRepository();
    const id = seed(repo, db, {
      content: 'secret plan',
      isPrivate: 1,
      updatedAt: '2026-10-01 10:00:00',
    });

    expect(repo.getChatCandidateNotes(['secret'], { includePrivate: false, limit: 10 })).toEqual(
      [],
    );
    expect(
      repo.getChatCandidateNotes(['secret'], { includePrivate: true, limit: 10 }).map((n) => n.id),
    ).toEqual([id]);
  });

  it('excludes deleted and left-team notes', () => {
    const { repo, db } = createMemoryRepository();
    seed(repo, db, {
      content: 'match deleted',
      deletedAt: '2026-10-01 09:00:00',
      updatedAt: '2026-10-01 10:00:00',
    });
    seed(repo, db, { content: 'match left', leftTeam: 1, updatedAt: '2026-10-01 11:00:00' });
    const keptId = seed(repo, db, { content: 'match kept', updatedAt: '2026-10-01 12:00:00' });

    const result = repo.getChatCandidateNotes(['match'], { includePrivate: true, limit: 10 });

    expect(result.map((note) => note.id)).toEqual([keptId]);
  });

  it('orders equal matches by most recently updated and caps at the limit', () => {
    const { repo, db } = createMemoryRepository();
    seed(repo, db, { content: 'alpha old', updatedAt: '2026-10-01 10:00:00' });
    const newest = seed(repo, db, { content: 'alpha new', updatedAt: '2026-10-03 10:00:00' });
    const middle = seed(repo, db, { content: 'alpha mid', updatedAt: '2026-10-02 10:00:00' });

    const result = repo.getChatCandidateNotes(['alpha'], { includePrivate: false, limit: 2 });

    expect(result.map((note) => note.id)).toEqual([newest, middle]);
  });

  it('returns recent notes when there are no terms', () => {
    const { repo, db } = createMemoryRepository();
    seed(repo, db, { content: 'oldest', updatedAt: '2026-10-01 10:00:00' });
    const newest = seed(repo, db, { content: 'newest', updatedAt: '2026-10-03 10:00:00' });
    const middle = seed(repo, db, { content: 'middle', updatedAt: '2026-10-02 10:00:00' });
    seed(repo, db, { content: 'gone', leftTeam: 1, updatedAt: '2026-10-04 10:00:00' });

    const result = repo.getChatCandidateNotes([], { includePrivate: false, limit: 2 });

    expect(result.map((note) => note.id)).toEqual([newest, middle]);
  });
});
