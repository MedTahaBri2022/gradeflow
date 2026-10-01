/**
 * Prints a CSV of grades to try the import pipeline with.
 *
 *   npm run --silent sample -- 20000 > grades.csv
 *
 * About 4% of the rows are invalid on purpose (bad score, unknown course,
 * bad date) so the error report has something to show. Each run produces a
 * different file, since the same file cannot be imported twice.
 */
const rows = Number(process.argv[2] ?? 2000);
if (!Number.isInteger(rows) || rows < 1) {
  throw new Error('Usage: npm run sample -- <number of rows>');
}

const FIRST = [
  'Amina',
  'Youssef',
  'Sara',
  'Omar',
  'Lina',
  'Karim',
  'Nora',
  'Adam',
];
const LAST = [
  'Benali',
  'Martin',
  'Haddad',
  'Dubois',
  'Idrissi',
  'Moreau',
  'Tazi',
];
const COURSES = [
  'CS101',
  'CS205',
  'CS310',
  'CS420',
  'MA101',
  'MA220',
  'PH101',
  'BU150',
];

const pick = <T>(values: T[]): T =>
  values[Math.floor(Math.random() * values.length)];
const batch = Date.now().toString(36);
const students = Math.max(10, Math.ceil(rows / COURSES.length / 4));

const lines = ['student_email,student_name,course_code,score,graded_on'];
for (let i = 0; i < rows; i++) {
  const student = i % students;
  const name = `${FIRST[student % FIRST.length]} ${LAST[student % LAST.length]}`;
  const email = `student${student}.${batch}@school.test`;
  // One grade per student, course and day: no accidental duplicates.
  const course = COURSES[Math.floor(i / students) % COURSES.length];
  const day = new Date(
    Date.UTC(2026, 0, 1 + Math.floor(i / (students * COURSES.length))),
  )
    .toISOString()
    .slice(0, 10);
  let score = (40 + Math.random() * 60).toFixed(1);
  let code = course;
  let date = day;

  const roll = Math.random();
  if (roll < 0.015) score = pick(['105', '-4', 'absent']);
  else if (roll < 0.03) code = 'XX999';
  else if (roll < 0.04) date = '2026-13-45';

  lines.push([email, name, code, score, date].join(','));
}
process.stdout.write(lines.join('\n') + '\n');
