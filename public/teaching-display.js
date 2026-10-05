import './teaching-ui-system.js?v=20261005-1';

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor', 'of', 'on', 'or', 'the', 'to', 'with']);
const COURSE_TONES = [
  ['#79dcb0', '#102a20'],
  ['#78bdf2', '#102332'],
  ['#d7a7f3', '#281a31'],
  ['#f1bd72', '#302313'],
  ['#ef8f9d', '#31191e'],
  ['#8fd7d5', '#112b2a'],
];

function displayName(value, fallback = 'Untitled course') {
  const clean = String(value || '').trim().replace(/\s+/g, ' ');
  if (!clean) return fallback;
  return clean.split(' ').map((word, index) => {
    if (/^[A-Z0-9&+./-]{2,}$/.test(word) || /\d/.test(word)) return word;
    if (word !== word.toLowerCase() && word !== word.toUpperCase()) return word;
    const lower = word.toLowerCase();
    if (index > 0 && SMALL_WORDS.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ');
}

function courseTone(seed) {
  let hash = 0;
  for (const char of String(seed || 'course')) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  const [accent, surface] = COURSE_TONES[Math.abs(hash) % COURSE_TONES.length];
  return { accent, surface };
}

function decorateCourse(node, course) {
  const tone = courseTone(course?.subject_id || course?.subjectId || course?.course_id || course?.courseId || course?.title);
  node.style.setProperty('--course-accent', tone.accent);
  node.style.setProperty('--course-surface', tone.surface);
  return node;
}

window.KIWITeachingDisplay = Object.freeze({ displayName, courseTone, decorateCourse });
