import { eq } from 'drizzle-orm';
import { notes } from '@/db/schema';
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

  it('matches a term in the transcript', () => {
    const { repo, db } = createMemoryRepository();
    const id = seed(repo, db, {
      transcript: 'we agreed on the roadmap',
      updatedAt: '2026-10-01 10:00:00',
    });

    const result = repo.getChatCandidateNotes(['roadmap'], { includePrivate: false, limit: 10 });

    expect(result.map((note) => note.id)).toEqual([id]);
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

  it('orders by most recently updated and caps at the limit', () => {
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
