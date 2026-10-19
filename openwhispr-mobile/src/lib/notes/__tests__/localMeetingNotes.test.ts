jest.mock('@/lib/appleLLM', () => ({
  AppleLLM: {
    generateMeetingNotes: jest.fn(),
  },
}));

jest.mock('@/data', () => ({
  notesRepository: {
    getNoteById: jest.fn(),
    getSegments: jest.fn(),
    getSpeakers: jest.fn(),
    getActions: jest.fn(),
  },
}));

jest.mock('@/lib/localReasoning', () => ({
  LOCAL_OUTPUT_TOKEN_RESERVE: 900,
  fitsLocalReasoningBudget: jest.fn(async () => true),
  getLocalInputTokenBudget: jest.fn(() => 2896),
  getLocalReasoningReadiness: jest.fn(async () => ({
    status: 'ready',
    contextSize: 4096,
    tokenCounting: true,
  })),
  isLocalContextLimitError: (error: unknown) =>
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'APPLE_LLM_CONTEXT_LIMIT',
  isLocalOutputLimitError: (error: unknown) =>
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'APPLE_LLM_OUTPUT_LIMIT',
  toLocalReasoningError: (error: unknown) => error,
}));

import {
  generateLocalMeetingNotes,
  renderStructuredMeetingNotesToMarkdown,
} from '../localMeetingNotes';
import { AppleLLM } from '@/lib/appleLLM';
import { notesRepository } from '@/data';
import { fitsLocalReasoningBudget, getLocalInputTokenBudget } from '@/lib/localReasoning';

const mockGenerateMeetingNotes = AppleLLM.generateMeetingNotes as jest.Mock;
const mockGetNoteById = notesRepository.getNoteById as jest.Mock;
const mockGetSegments = notesRepository.getSegments as jest.Mock;
const mockGetSpeakers = notesRepository.getSpeakers as jest.Mock;
const mockGetActions = notesRepository.getActions as jest.Mock;
const mockFitsBudget = fitsLocalReasoningBudget as jest.Mock;
const mockGetInputBudget = getLocalInputTokenBudget as jest.Mock;

const outputLimit = (): Error =>
  Object.assign(new Error('decodingFailure'), { code: 'APPLE_LLM_OUTPUT_LIMIT' });

const partialNotes = (summary: string, decisions: string[] = []) => ({
  summary,
  keyDiscussionPoints: [],
  decisions,
  actionItems: [],
  followUps: [],
});

const segmentsOf = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: 100 + index,
    noteId: 7,
    startMs: index * 60_000,
    endMs: index * 60_000 + 2000,
    text: `Line ${index} about the launch plan.`,
    // Alternating speakers, since one speaker's consecutive segments read as one line.
    speakerLabel: `speaker_${index % 2}`,
    sortOrder: index,
  }));

const meetingNote = {
  id: 7,
  title: 'Planning',
  content: '',
  noteType: 'meeting',
  calendarEventId: null,
  participants: null,
  deletedAt: null,
};

const speaker = {
  id: 10,
  noteId: 7,
  speakerLabel: 'speaker_0',
  displayName: null,
  sortOrder: 0,
  speakerStatus: 'provisional',
  color: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGenerateMeetingNotes.mockReset();
  mockFitsBudget.mockResolvedValue(true);
  mockGetInputBudget.mockReturnValue(2896);
  mockGetNoteById.mockReturnValue(meetingNote);
  mockGetSegments.mockReturnValue([
    {
      id: 20,
      noteId: 7,
      startMs: 0,
      endMs: 2000,
      text: 'We need to ship the onboarding fix before launch and confirm Alice owns the checklist.',
      speakerLabel: 'speaker_0',
      sortOrder: 0,
    },
  ]);
  mockGetSpeakers.mockReturnValue([speaker]);
  mockGetActions.mockReturnValue([]);
});

describe('local meeting notes', () => {
  it('renders structured notes to markdown sections', () => {
    expect(
      renderStructuredMeetingNotesToMarkdown({
        summary: 'The team reviewed launch readiness.',
        keyDiscussionPoints: ['Onboarding is the main launch risk.'],
        decisions: ['Ship the onboarding fix first.'],
        actionItems: [{ text: 'Confirm the launch checklist.', owner: 'Alice' }],
        followUps: ['Review progress next week.'],
      }),
    ).toBe(
      [
        'The team reviewed launch readiness.',
        '## Key Discussion Points\n- Onboarding is the main launch risk.',
        '## Decisions Made\n- Ship the onboarding fix first.',
        '## Action Items\n- [ ] Alice: Confirm the launch checklist.',
        '## Follow-ups\n- Review progress next week.',
      ].join('\n\n'),
    );
  });

  it('splits and retries a chunk on local context-limit errors', async () => {
    mockGenerateMeetingNotes
      .mockRejectedValueOnce(
        Object.assign(new Error('too large'), { code: 'APPLE_LLM_CONTEXT_LIMIT' }),
      )
      .mockResolvedValueOnce({
        summary: 'First half',
        keyDiscussionPoints: ['Onboarding fix discussed.'],
        decisions: [],
        actionItems: [],
        followUps: [],
      })
      .mockResolvedValueOnce({
        summary: 'Second half',
        keyDiscussionPoints: [],
        decisions: ['Alice owns the checklist.'],
        actionItems: [{ text: 'Confirm the checklist.', owner: 'Alice' }],
        followUps: [],
      })
      .mockResolvedValueOnce({
        summary: 'Merged summary',
        keyDiscussionPoints: ['Onboarding fix discussed.'],
        decisions: ['Alice owns the checklist.'],
        actionItems: [{ text: 'Confirm the checklist.', owner: 'Alice' }],
        followUps: [],
      });

    await expect(generateLocalMeetingNotes(7)).resolves.toContain('Merged summary');
    expect(mockGenerateMeetingNotes).toHaveBeenCalledTimes(4);
    expect(mockGenerateMeetingNotes.mock.calls[1][0].prompt).toContain('[0:00] Speaker 1:');
    expect(mockGenerateMeetingNotes.mock.calls[2][0].prompt).toContain(
      'Previous chunk summary for continuity:\nFirst half',
    );
  });

  it('omits unknown speaker labels from local meeting-note prompts', async () => {
    mockGetSegments.mockReturnValue([
      {
        id: 20,
        noteId: 7,
        startMs: 0,
        endMs: 2000,
        text: 'Ship the onboarding fix.',
        speakerLabel: null,
        sortOrder: 0,
      },
    ]);
    mockGetSpeakers.mockReturnValue([]);
    mockGenerateMeetingNotes.mockResolvedValue({
      summary: 'The onboarding fix needs to ship.',
      keyDiscussionPoints: [],
      decisions: [],
      actionItems: [{ text: 'Ship the onboarding fix.', owner: null }],
      followUps: [],
    });

    await generateLocalMeetingNotes(7);

    expect(mockGenerateMeetingNotes.mock.calls[0][0].prompt).toContain(
      'Meeting transcript:\n[0:00] Ship the onboarding fix.',
    );
    expect(mockGenerateMeetingNotes.mock.calls[0][0].prompt).not.toContain('Unknown speaker');
  });

  // Guided generation cut off by the output cap can't be decoded (FoundationModels'
  // decodingFailure), which the native module reports as APPLE_LLM_OUTPUT_LIMIT.
  it('halves a chunk whose notes run past the output cap and retries it', async () => {
    mockGetSegments.mockReturnValue(segmentsOf(2));
    mockGenerateMeetingNotes
      .mockRejectedValueOnce(outputLimit())
      .mockResolvedValueOnce(partialNotes('First half'))
      .mockResolvedValueOnce(partialNotes('Second half'))
      .mockResolvedValueOnce(partialNotes('Merged summary'));

    await expect(generateLocalMeetingNotes(7)).resolves.toContain('Merged summary');
    expect(mockGenerateMeetingNotes).toHaveBeenCalledTimes(4);
    expect(mockGenerateMeetingNotes.mock.calls[1][0].prompt).toContain('Line 0');
    expect(mockGenerateMeetingNotes.mock.calls[1][0].prompt).not.toContain('Line 1');
    expect(mockGenerateMeetingNotes.mock.calls[2][0].prompt).toContain('Line 1');
  });

  it('does not split one line by words when its notes run past the output cap', async () => {
    mockGenerateMeetingNotes.mockRejectedValue(outputLimit());

    await expect(generateLocalMeetingNotes(7)).rejects.toMatchObject({
      code: 'APPLE_LLM_OUTPUT_LIMIT',
    });
    expect(mockGenerateMeetingNotes).toHaveBeenCalledTimes(1);
  });

  it('stops halving a chunk whose notes keep running past the output cap', async () => {
    mockGetSegments.mockReturnValue(segmentsOf(8));
    mockGenerateMeetingNotes.mockRejectedValue(outputLimit());

    await expect(generateLocalMeetingNotes(7)).rejects.toMatchObject({
      code: 'APPLE_LLM_OUTPUT_LIMIT',
    });
    // The chunk, its first half, then that half's first quarter, which ends the note.
    expect(mockGenerateMeetingNotes).toHaveBeenCalledTimes(3);
  });

  it('merges partial notes by hand when the merged notes run past the output cap', async () => {
    mockGetSegments.mockReturnValue(segmentsOf(2));
    mockFitsBudget.mockImplementation(
      async ({ prompt }: { prompt: string }) =>
        // One line per chunk, so the transcript maps in two runs; the merge prompt fits.
        prompt.includes('Merge these') || !(prompt.includes('Line 0') && prompt.includes('Line 1')),
    );
    mockGenerateMeetingNotes
      .mockResolvedValueOnce(partialNotes('First chunk.', ['Ship Friday.']))
      .mockResolvedValueOnce(partialNotes('Second chunk.', ['Alice owns QA.']))
      .mockRejectedValueOnce(outputLimit());

    const markdown = await generateLocalMeetingNotes(7);

    expect(mockGenerateMeetingNotes).toHaveBeenCalledTimes(3);
    expect(markdown).toContain('First chunk. Second chunk.');
    expect(markdown).toContain('- Ship Friday.\n- Alice owns QA.');
  });

  it.each([2896, 6992])(
    'holds each chunk under the output-safe size whatever the context (budget %i)',
    async (inputBudget) => {
      mockGetInputBudget.mockReturnValue(inputBudget);
      mockGenerateMeetingNotes.mockResolvedValue(partialNotes('Notes'));

      await generateLocalMeetingNotes(7);

      expect(mockFitsBudget).toHaveBeenCalledWith(expect.objectContaining({ budget: 2000 }));
    },
  );
});
