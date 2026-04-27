import { openDB } from 'idb'

const DB_NAME = 'read-app'
const DB_VERSION = 2

function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const s = db.createObjectStore('books', { keyPath: 'id' })
        s.createIndex('addedAt', 'addedAt')
        db.createObjectStore('pdfs', { keyPath: 'id' })
        db.createObjectStore('progress', { keyPath: 'bookId' })
      }
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains('vocabulary')) {
          const v = db.createObjectStore('vocabulary', { keyPath: 'id' })
          v.createIndex('savedAt', 'savedAt')
        }
      }
    },
  })
}

export async function getAllBooks() {
  const db = await getDB()
  return db.getAllFromIndex('books', 'addedAt')
}

export async function addBook(id, metadata, pdfBuffer) {
  const db = await getDB()
  const tx = db.transaction(['books', 'pdfs'], 'readwrite')
  await tx.objectStore('books').put(metadata)
  await tx.objectStore('pdfs').put({ id, data: pdfBuffer })
  await tx.done
}

export async function getPDF(bookId) {
  const db = await getDB()
  const record = await db.get('pdfs', bookId)
  return record?.data ?? null
}

export async function deleteBook(bookId) {
  const db = await getDB()
  const tx = db.transaction(['books', 'pdfs', 'progress'], 'readwrite')
  await tx.objectStore('books').delete(bookId)
  await tx.objectStore('pdfs').delete(bookId)
  await tx.objectStore('progress').delete(bookId)
  await tx.done
}

export async function saveProgress(bookId, page) {
  const db = await getDB()
  await db.put('progress', { bookId, page })
}

export async function getProgress(bookId) {
  const db = await getDB()
  const record = await db.get('progress', bookId)
  return record?.page ?? 1
}

export async function updateBookCover(bookId, coverDataUrl) {
  const db = await getDB()
  const book = await db.get('books', bookId)
  if (book) await db.put('books', { ...book, cover: coverDataUrl })
}

export async function updateBookPageCount(bookId, count) {
  const db = await getDB()
  const book = await db.get('books', bookId)
  if (book && book.pageCount !== count) await db.put('books', { ...book, pageCount: count })
}

export async function updateBookTitle(bookId, title) {
  const db = await getDB()
  const book = await db.get('books', bookId)
  if (book) await db.put('books', { ...book, title })
}

// ── Vocabulary ────────────────────────────────────────────
export async function saveWord(entry) {
  const db = await getDB()
  await db.put('vocabulary', { ...entry, id: entry.id ?? crypto.randomUUID(), savedAt: entry.savedAt ?? Date.now() })
}

export async function getAllWords() {
  const db = await getDB()
  const words = await db.getAllFromIndex('vocabulary', 'savedAt')
  return words.reverse() // newest first
}

export async function deleteWord(id) {
  const db = await getDB()
  await db.delete('vocabulary', id)
}
