/* 示例数据：只在空库时填充一次（?demo 打开） */

import {
  getBooks, createBook, updateBook, addTerm, updateWord, getEntry, getWordByTerm,
  adjustWeight, addLink, createCluster, createCloud, getEntriesOfBook,
} from './store.js';

/* term, 音标, 词性, 中文, 权重 */
const BOOK1 = [
  ['run', '/rʌn/', 'verb', '跑；奔跑；运行', 5],
  ['running', '/ˈrʌnɪŋ/', 'noun', '跑步；运转', 2],
  ['ran', '/ræn/', 'verb', 'run 的过去式', 2],
  ['go', '/ɡəʊ/', 'verb', '去；走；进行', 3],
  ['went', '/went/', 'verb', 'go 的过去式', 1],
  ['gone', '/ɡɒn/', 'verb', 'go 的过去分词；离开了的', 1],
  ['begin', '/bɪˈɡɪn/', 'verb', '开始；着手', 4],
  ['began', '/bɪˈɡæn/', 'verb', 'begin 的过去式', 2],
  ['beginning', '/bɪˈɡɪnɪŋ/', 'noun', '开始；开端', 2],
  ['start', '/stɑːt/', 'verb', '开始；启动', 3],
  ['commence', '/kəˈmens/', 'verb', '开始（正式用语）', 1],
  ['happy', '/ˈhæpi/', 'adjective', '快乐的；高兴的', 5],
  ['happiness', '/ˈhæpinəs/', 'noun', '幸福；快乐', 3],
  ['happily', '/ˈhæpɪli/', 'adverb', '快乐地；幸福地', 2],
  ['unhappy', '/ʌnˈhæpi/', 'adjective', '不快乐的；不幸福的', 2],
  ['glad', '/ɡlæd/', 'adjective', '高兴的；乐意的', 2],
  ['sad', '/sæd/', 'adjective', '悲伤的；令人难过的', 2],
  ['big', '/bɪɡ/', 'adjective', '大的；重要的', 4],
  ['large', '/lɑːdʒ/', 'adjective', '大的；大量的', 3],
  ['huge', '/hjuːdʒ/', 'adjective', '巨大的；庞大的', 2],
  ['small', '/smɔːl/', 'adjective', '小的；少的', 3],
  ['tiny', '/ˈtaɪni/', 'adjective', '极小的；微小的', 1],
  ['look', '/lʊk/', 'verb', '看；注视；看起来', 4],
  ['see', '/siː/', 'verb', '看见；明白', 3],
  ['watch', '/wɒtʃ/', 'verb', '观看；注视；手表', 2],
  ['glance', '/ɡlɑːns/', 'verb', '瞥一眼；扫视', 1],
  ['fast', '/fɑːst/', 'adjective', '快的；迅速的', 2],
  ['quick', '/kwɪk/', 'adjective', '快的；敏捷的', 3],
  ['rapid', '/ˈræpɪd/', 'adjective', '快速的；迅速的', 1],
  ['slow', '/sləʊ/', 'adjective', '慢的；缓慢的', 2],
];

const BOOK2 = [
  ['quite', '/kwaɪt/', 'adverb', '相当；很；完全', 3],
  ['quiet', '/ˈkwaɪət/', 'adjective', '安静的；沉默的', 2],
  ['affect', '/əˈfekt/', 'verb', '影响；感动', 2],
  ['effect', '/ɪˈfekt/', 'noun', '影响；效果；结果', 2],
  ['adapt', '/əˈdæpt/', 'verb', '适应；改编', 1],
  ['adopt', '/əˈdɒpt/', 'verb', '采用；收养', 1],
  ['desert', '/ˈdezət/', 'noun', '沙漠；荒原', 1],
  ['dessert', '/dɪˈzɜːt/', 'noun', '甜点；餐后甜食', 1],
];

const LINKS = [
  ['run', 'running', 'variant'],
  ['run', 'ran', 'variant'],
  ['go', 'went', 'variant'],
  ['go', 'gone', 'variant'],
  ['begin', 'began', 'variant'],
  ['begin', 'beginning', 'variant'],
  ['happy', 'happiness', 'variant'],
  ['happy', 'happily', 'variant'],
  ['happy', 'unhappy', 'variant'],
  ['begin', 'start', 'synonym'],
  ['start', 'commence', 'synonym'],
  ['happy', 'glad', 'synonym'],
  ['big', 'large', 'synonym'],
  ['big', 'huge', 'synonym'],
  ['small', 'tiny', 'synonym'],
  ['look', 'see', 'synonym'],
  ['look', 'watch', 'synonym'],
  ['look', 'glance', 'synonym'],
  ['fast', 'quick', 'synonym'],
  ['quick', 'rapid', 'synonym'],
  ['happy', 'sad', 'antonym'],
  ['big', 'small', 'antonym'],
  ['fast', 'slow', 'antonym'],
  ['glad', 'sad', 'antonym'],
  ['quite', 'quiet', 'lookalike'],
  ['affect', 'effect', 'lookalike'],
  ['adapt', 'adopt', 'lookalike'],
  ['desert', 'dessert', 'lookalike'],
];

export function seedDemo() {
  const books = getBooks();
  if (books.length !== 1 || getEntriesOfBook(books[0].id).length > 0) return false;

  const b1 = books[0];
  updateBook(b1.id, { name: '雅思高频词', color: '#b8452f' });
  const b2 = createBook('形近词辨析', { color: '#2f5d7c' });

  const fill = (rows, bookId, baseTime) => {
    rows.forEach((row, i) => {
      const [term, phonetic, tag, meaningZh, weight] = row;
      const res = addTerm(term, [bookId]);
      if (!res) return;
      const w = res.word;
      updateWord(w.id, {
        phonetic,
        pos: [{ tag }],
        meaningZh,
        enrichState: 'done',
      });
      const entry = getEntry(bookId, w.id);
      if (entry) {
        entry.addedAt = baseTime + i * 3600 * 1000;
        entry.lastAddedAt = entry.addedAt + (weight - 1) * 7200 * 1000;
        if (weight > 1) adjustWeight(entry.id, weight - 1);
      }
    });
  };

  const now = Date.now();
  fill(BOOK1, b1.id, now - 1000 * 3600 * 24 * 21);
  fill(BOOK2, b2.id, now - 1000 * 3600 * 24 * 5);

  for (const [a, b, type] of LINKS) {
    const wa = getWordByTerm(a);
    const wb = getWordByTerm(b);
    if (wa && wb) addLink(wa.id, wb.id, type);
  }

  const ids = (list) => list.map((t) => getWordByTerm(t)?.id).filter(Boolean);
  const c1 = createCluster(b1.id, 'run 的变式', ids(['run', 'running', 'ran']));
  const c2 = createCluster(b1.id, 'go 的变式', ids(['go', 'went', 'gone']));
  const c3 = createCluster(b1.id, 'begin 的变式', ids(['begin', 'began', 'beginning']));
  const c4 = createCluster(b1.id, '开始 · 近义', ids(['begin', 'start', 'commence']));
  const c5 = createCluster(b1.id, 'happy 家族', ids(['happy', 'happiness', 'happily', 'unhappy', 'glad']));
  const c6 = createCluster(b1.id, '大小与反义', ids(['big', 'large', 'huge', 'small', 'tiny']));
  const c7 = createCluster(b1.id, '看的动作', ids(['look', 'see', 'watch', 'glance']));
  const c8 = createCluster(b1.id, '快与慢', ids(['fast', 'quick', 'rapid', 'slow']));
  const c9 = createCluster(b2.id, '形近词 · 易混', ids(['quite', 'quiet', 'affect', 'effect', 'adapt', 'adopt', 'desert', 'dessert']));

  createCloud(b1.id, '词形与词族', [c1.id, c2.id, c3.id, c5.id]);
  createCloud(b1.id, '语义网络', [c4.id, c5.id, c6.id, c7.id, c8.id]);
  createCloud(b2.id, '形近词云', [c9.id]);

  return true;
}
