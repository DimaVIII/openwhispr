import { draftPlaceholders, fillInInstruction } from '../voiceAgentFollowUp';

describe('draftPlaceholders', () => {
  it('lists each placeholder once, in order, without brackets', () => {
    expect(
      draftPlaceholders('Hi [Landlord’s Name], it’s [your name]. Thanks, [Your Name] [ date ]'),
    ).toEqual(['Landlord’s Name', 'your name', 'date']);
  });

  it.each([
    ['no brackets', 'Hi Maria, could I pay rent two days late?'],
    ['empty brackets', 'Hi [], could I pay late? [  ]'],
    ['a bracket split across lines', 'Hi [Landlord’s\nName]'],
    ['a bracket too long to be a placeholder', `Hi [${'x'.repeat(41)}]`],
  ])('finds none with %s', (_label, draft) => {
    expect(draftPlaceholders(draft)).toEqual([]);
  });
});

describe('fillInInstruction', () => {
  it.each([
    [['Landlord’s Name'], 'Say: “My landlord is Maria.”'],
    [['Your Name'], 'Say: “Sign it Alex.”'],
    [['Due Date'], 'Say: “Rent is due on the 1st.”'],
    [['New Date'], 'Say: “I can pay on the 3rd.”'],
    [['Amount'], 'Say: “It’s $1,500.”'],
    [['Unit Number'], 'Say: “I’m in unit 4B.”'],
    [['Name'], 'Say: “My landlord is Maria.”'],
  ])('suggests what to say for %s', (placeholders, say) => {
    expect(fillInInstruction(placeholders, false)).toBe(
      `Now tap Ask for changes and fill in [${placeholders[0]}]. ${say}`,
    );
  });

  it('joins two and three placeholders and their answers', () => {
    expect(fillInInstruction(['Landlord’s Name', 'Your Name'], false)).toBe(
      'Now tap Ask for changes and fill in [Landlord’s Name] and [Your Name]. Say: “My landlord is Maria, and sign it Alex.”',
    );
    expect(fillInInstruction(['Name', 'Unit', 'Your Name'], false)).toBe(
      'Now tap Ask for changes and fill in [Name], [Unit], and [Your Name]. Say: “My landlord is Maria, I’m in unit 4B, and sign it Alex.”',
    );
  });

  it('says an answer once when two placeholders mean the same thing', () => {
    expect(fillInInstruction(['Name', 'Landlord’s Name'], false)).toBe(
      'Now tap Ask for changes and fill in [Name] and [Landlord’s Name]. Say: “My landlord is Maria.”',
    );
  });

  it('names a placeholder it has no answer for without a script', () => {
    expect(fillInInstruction(['Reason', 'Your Name'], false)).toBe(
      'Now tap Ask for changes and fill in [Reason] and [Your Name]. Say what goes there.',
    );
  });

  it('stops naming them past three', () => {
    expect(fillInInstruction(['Name', 'Unit', 'Amount', 'Your Name'], false)).toBe(
      'Now tap Ask for changes and fill in the parts in brackets. Say what goes there.',
    );
  });

  it('asks again for what a changed draft still leaves in brackets', () => {
    expect(fillInInstruction(['Your Name'], true)).toBe(
      'Still missing [Your Name]. Tap Ask for changes again. Say: “Sign it Alex.”',
    );
  });
});
