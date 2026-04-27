import { supabase } from './lib/supabase'

// Normalize Supabase row → shape expected by existing components
function normalizeBook(row) {
  return {
    id:          row.id,
    title:       row.title,
    fileName:    row.filename,
    pageCount:   row.total_pages  ?? 0,
    cover:       row.cover_image  ?? null,
    currentPage: row.current_page ?? 1,
    storagePath: row.storage_path,
    addedAt:     new Date(row.created_at).getTime(),
  }
}

function safeName(filename) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_')
}

// ── Books ────────────────────────────────────────────────

export async function getAllBooks() {
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(normalizeBook)
}

export async function addBook(id, metadata, pdfBuffer) {
  const storagePath = `${id}-${safeName(metadata.fileName)}`
  const blob = new Blob([pdfBuffer], { type: 'application/pdf' })

  // Ensure bucket exists (no-op if already created from Dashboard)
  await supabase.storage.createBucket('books', { public: false }).catch(() => {})

  const { error: uploadError } = await supabase.storage
    .from('books')
    .upload(storagePath, blob, { contentType: 'application/pdf', upsert: false })
  if (uploadError) throw uploadError

  const { error: insertError } = await supabase
    .from('books')
    .insert({
      id,
      title:        metadata.title,
      filename:     metadata.fileName,
      total_pages:  metadata.pageCount ?? 0,
      current_page: 1,
      storage_path: storagePath,
      cover_image:  metadata.cover ?? null,
    })
  if (insertError) throw insertError
}

export async function getPDF(bookId, onProgress = null) {
  const { data: book, error: bookError } = await supabase
    .from('books')
    .select('storage_path')
    .eq('id', bookId)
    .single()
  if (bookError) throw bookError

  const { data: urlData } = supabase.storage.from('books').getPublicUrl(book.storage_path)
  const response = await fetch(urlData.publicUrl)
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`)

  const contentLength = +response.headers.get('content-length')
  if (!onProgress || !response.body || !contentLength) {
    return response.arrayBuffer()
  }

  // Stream with progress
  const reader = response.body.getReader()
  const chunks = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onProgress(Math.round((received / contentLength) * 100))
  }
  const total = chunks.reduce((s, c) => s + c.length, 0)
  const buf = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { buf.set(chunk, offset); offset += chunk.length }
  return buf.buffer
}

export async function deleteBook(bookId) {
  const { data: book } = await supabase
    .from('books')
    .select('storage_path')
    .eq('id', bookId)
    .single()

  // Delete row (cascades to vocabulary)
  await supabase.from('books').delete().eq('id', bookId)

  // Delete file from storage
  if (book?.storage_path) {
    await supabase.storage.from('books').remove([book.storage_path])
  }
}

export async function saveProgress(bookId, page) {
  await supabase
    .from('books')
    .update({ current_page: page, updated_at: new Date().toISOString() })
    .eq('id', bookId)
}

export async function getProgress(bookId) {
  const { data } = await supabase
    .from('books')
    .select('current_page')
    .eq('id', bookId)
    .single()
  return data?.current_page ?? 1
}

export async function updateBookCover(bookId, coverDataUrl) {
  await supabase
    .from('books')
    .update({ cover_image: coverDataUrl, updated_at: new Date().toISOString() })
    .eq('id', bookId)
}

export async function updateBookPageCount(bookId, count) {
  await supabase
    .from('books')
    .update({ total_pages: count, updated_at: new Date().toISOString() })
    .eq('id', bookId)
}

export async function updateBookTitle(bookId, title) {
  await supabase
    .from('books')
    .update({ title, updated_at: new Date().toISOString() })
    .eq('id', bookId)
}

// ── Vocabulary ───────────────────────────────────────────

export async function saveWord(entry) {
  const { error } = await supabase
    .from('vocabulary')
    .upsert({
      id:            entry.id ?? crypto.randomUUID(),
      word:          entry.word,
      definition_fr: entry.definition_fr,
      example_en:    entry.example_en,
      level:         entry.level,
      book_id:       entry.bookId ?? null,
    })
  if (error) throw error
}

export async function getAllWords() {
  const { data, error } = await supabase
    .from('vocabulary')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function deleteWord(id) {
  await supabase.from('vocabulary').delete().eq('id', id)
}
