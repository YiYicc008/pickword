/* 视图状态（不持久化到数据层） */

export const vs = {
  bookId: null,
  view: 'list',
  sort: 'weight-desc',
  query: '',
  cloudId: null,
  hiddenClusters: new Set(),
  highlightId: null,
  sidebarOpen: false,
};

export function selectBook(id) {
  vs.bookId = id;
  vs.query = '';
  vs.cloudId = null;
  vs.hiddenClusters = new Set();
  try { localStorage.setItem('vn.lastBook', id); } catch { /* 忽略 */ }
}

export function lastBook() {
  try { return localStorage.getItem('vn.lastBook'); } catch { return null; }
}
