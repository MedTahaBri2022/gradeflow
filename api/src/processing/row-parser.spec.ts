import { missingColumns, parseRow, RawRow } from './row-parser';

const today = new Date('2026-06-15T12:00:00Z');
const valid: RawRow = {
  student_email: ' Ada@Example.com ',
  student_name: 'Ada Lovelace',
  course_code: 'cs101',
  score: '87.5',
  graded_on: '2026-05-01',
};

describe('parseRow', () => {
  it('normalizes a valid row', () => {
    expect(parseRow(valid, today)).toEqual({
      ok: true,
      value: {
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        courseCode: 'CS101',
        score: 87.5,
        gradedOn: '2026-05-01',
      },
    });
  });

  it.each([
    [{ student_email: 'not-an-email' }, 'student_email is not a valid email'],
    [{ student_name: '  ' }, 'student_name is required'],
    [{ course_code: undefined }, 'course_code is required'],
    [{ score: '101' }, 'score must be a number between 0 and 100'],
    [{ score: '-3' }, 'score must be a number between 0 and 100'],
    [{ score: 'A+' }, 'score must be a number between 0 and 100'],
    [{ score: '12.345' }, 'score must be a number between 0 and 100'],
    [
      { graded_on: '01/05/2026' },
      'graded_on must be a valid date (YYYY-MM-DD)',
    ],
    [
      { graded_on: '2026-02-30' },
      'graded_on must be a valid date (YYYY-MM-DD)',
    ],
    [{ graded_on: '2026-06-16' }, 'graded_on cannot be in the future'],
  ])('rejects %j', (override, message) => {
    expect(parseRow({ ...valid, ...override }, today)).toEqual({
      ok: false,
      error: message,
    });
  });

  it('accepts the boundaries 0, 100 and today', () => {
    for (const score of ['0', '100', '100.00']) {
      expect(parseRow({ ...valid, score }, today).ok).toBe(true);
    }
    expect(parseRow({ ...valid, graded_on: '2026-06-15' }, today).ok).toBe(
      true,
    );
  });

  it('reports every problem of a row at once', () => {
    const result = parseRow({ student_email: 'x', score: '500' }, today);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.split('; ')).toHaveLength(5);
  });
});

describe('missingColumns', () => {
  it('ignores case, spacing and extra columns', () => {
    expect(
      missingColumns([
        ' Student_Email',
        'student_name',
        'course_code',
        'score',
        'graded_on',
        'comment',
      ]),
    ).toEqual([]);
  });

  it('lists what is missing', () => {
    expect(missingColumns(['student_email', 'score'])).toEqual([
      'student_name',
      'course_code',
      'graded_on',
    ]);
  });
});
