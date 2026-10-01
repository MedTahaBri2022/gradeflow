export const REQUIRED_COLUMNS = [
  'student_email',
  'student_name',
  'course_code',
  'score',
  'graded_on',
] as const;

export type RawRow = Record<string, string | undefined>;

export interface GradeRow {
  email: string;
  name: string;
  courseCode: string;
  score: number;
  gradedOn: string; // ISO date, YYYY-MM-DD
}

export type ParsedRow =
  { ok: true; value: GradeRow } | { ok: false; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SCORE = /^\d{1,3}(\.\d{1,2})?$/;

/** Columns of the header that are required but absent. */
export function missingColumns(header: string[]): string[] {
  const present = new Set(header.map((column) => column.trim().toLowerCase()));
  return REQUIRED_COLUMNS.filter((column) => !present.has(column));
}

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  // Rejects impossible dates such as 2025-02-30, which Date would roll over.
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * Validates and normalizes one CSV record. Pure: no I/O, so every rule is
 * unit-tested. All problems of a row are reported at once.
 */
export function parseRow(raw: RawRow, today = new Date()): ParsedRow {
  const email = raw.student_email?.trim().toLowerCase() ?? '';
  const name = raw.student_name?.trim() ?? '';
  const courseCode = raw.course_code?.trim().toUpperCase() ?? '';
  const score = raw.score?.trim() ?? '';
  const gradedOn = raw.graded_on?.trim() ?? '';

  const problems: string[] = [];
  if (!EMAIL.test(email)) problems.push('student_email is not a valid email');
  if (!name) problems.push('student_name is required');
  if (!courseCode) problems.push('course_code is required');
  if (!SCORE.test(score) || Number(score) > 100) {
    problems.push('score must be a number between 0 and 100');
  }
  if (!isRealDate(gradedOn)) {
    problems.push('graded_on must be a valid date (YYYY-MM-DD)');
  } else if (gradedOn > today.toISOString().slice(0, 10)) {
    problems.push('graded_on cannot be in the future');
  }

  if (problems.length) return { ok: false, error: problems.join('; ') };
  return {
    ok: true,
    value: { email, name, courseCode, score: Number(score), gradedOn },
  };
}
