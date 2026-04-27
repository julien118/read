import { useState, useEffect } from 'react'
import Library from './components/Library'
import Reader from './components/Reader'
import Vocabulary from './components/Vocabulary'
import { supabase } from './lib/supabase'

const THEMES = ['white', 'dark', 'night']
const THEME_META = { white: '#ffffff', dark: '#F8F1E3', night: '#1a0f00' }

export default function App() {
  const [view, setView] = useState('library') // library | reader | vocabulary
  const [currentBookId, setCurrentBookId] = useState(null)
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'white')

  useEffect(() => {
    supabase.from('books').select('count').then(({ data, error }) => {
      console.log('[Supabase] connection test:', { data, error })
    })
  }, [])

  useEffect(() => {
    localStorage.setItem('theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.content = THEME_META[theme] ?? '#1a1a2e'
  }, [theme])

  function cycleTheme() {
    setTheme(t => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length])
  }

  function openBook(id) {
    setCurrentBookId(id)
    setView('reader')
  }

  function closeReader() {
    setCurrentBookId(null)
    setView('library')
  }

  if (view === 'reader') {
    return <Reader bookId={currentBookId} onClose={closeReader} theme={theme} onToggleTheme={cycleTheme} />
  }

  return (
    <>
      {view === 'library'    && <Library    onOpenBook={openBook} theme={theme} onToggleTheme={cycleTheme} />}
      {view === 'vocabulary' && <Vocabulary />}

      <nav className="tab-bar">
        <button className={`tab-btn${view === 'library'    ? ' active' : ''}`} onClick={() => setView('library')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
          </svg>
          <span>Livres</span>
        </button>
        <button className={`tab-btn${view === 'vocabulary' ? ' active' : ''}`} onClick={() => setView('vocabulary')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" />
          </svg>
          <span>Vocab</span>
        </button>
      </nav>

      {/* Night mode amber overlay — above everything, no pointer events */}
      {theme === 'night' && <div className="night-overlay" />}
    </>
  )
}
