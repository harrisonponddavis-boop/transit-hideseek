// Study-mode questions are authored by the player and kept in the browser
// (no account needed). Each: { id, q, options: [string], correct: index }.
const KEY = 'ths-study-questions';

export function loadStudyQuestions() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

export function saveStudyQuestions(qs) {
  try { localStorage.setItem(KEY, JSON.stringify(qs)); } catch { /* ignore */ }
}
