// 本地存储（IndexedDB）。文档和每一页的图片都只存在这台设备上。
// docs:  { id, name, created, updated, pageIds[], cover }
//        同步用字段：dirty（本机有改动待上传）、deleted（已删除标记）、pageVers（每页的版本）
// pages: { id, docId, img(Blob 成品), src(Blob 原图，从别的设备同步来的页面按需再下载), thumb, w, h, corners, filter, rot,
//          ver（内容版本）, up（已上传到服务器的版本） }

let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('scanner', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('docs', { keyPath: 'id' });
      db.createObjectStore('pages', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('存储失败'));
    result = fn(tx);
  });
}

const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// 本机每次改动后通知同步模块
let onChange = () => {};
export const setOnChange = (fn) => { onChange = fn; };

/** 含"已删除"标记的全部记录，同步用。 */
export async function listAllDocs() {
  const db = await open();
  return req(db.transaction('docs').objectStore('docs').getAll());
}

export async function listDocs() {
  return (await listAllDocs()).filter((d) => !d.deleted).sort((a, b) => b.updated - a.updated);
}

export async function getDocRaw(id) {
  const db = await open();
  return req(db.transaction('docs').objectStore('docs').get(id));
}

export async function getDoc(id) {
  const doc = await getDocRaw(id);
  return doc && !doc.deleted ? doc : undefined;
}

/** 同步模块写入用：不打"待上传"标记。 */
export const putDocRaw = (doc) => run('docs', 'readwrite', (tx) => { tx.objectStore('docs').put(doc); });

/** 本机改动：标记为待上传。 */
export async function putDoc(doc) {
  doc.dirty = true;
  await putDocRaw(doc);
  onChange();
}

/** 本机删除：图片立即删掉，文档留一条"已删除"标记，等同步给其他设备。 */
export async function deleteDoc(doc) {
  await run(['docs', 'pages'], 'readwrite', (tx) => {
    tx.objectStore('docs').put({ id: doc.id, deleted: true, updated: Date.now(), dirty: true, pageIds: [] });
    for (const id of doc.pageIds) tx.objectStore('pages').delete(id);
  });
  onChange();
}

/** 彻底移除文档和它的页面（同步模块用）。 */
export const removeDoc = (doc) => run(['docs', 'pages'], 'readwrite', (tx) => {
  tx.objectStore('docs').delete(doc.id);
  for (const id of doc.pageIds || []) tx.objectStore('pages').delete(id);
});

export async function getPage(id) {
  const db = await open();
  return req(db.transaction('pages').objectStore('pages').get(id));
}

export async function getPages(ids) {
  const db = await open();
  const store = db.transaction('pages').objectStore('pages');
  const pages = await Promise.all(ids.map((id) => req(store.get(id))));
  return pages.filter(Boolean);
}

export const putPage = (page) => run('pages', 'readwrite', (tx) => { tx.objectStore('pages').put(page); });
export const deletePage = (id) => run('pages', 'readwrite', (tx) => { tx.objectStore('pages').delete(id); });
