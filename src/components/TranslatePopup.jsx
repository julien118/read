import { useState, useEffect, useRef } from 'react'
import { translateText } from '../api/claude'

export default function TranslatePopup({ text, onClose }) {
  const [phase, setPhase] = useState('loading')
  const [data, setData] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const overlayRef = useRef()
  const dragY = useRef(0)

  useEffect(() => { fetchTranslation() }, [text])

  async function fetchTranslation() {
    setPhase('loading')
    setData(null)
    try {
      const result = await translateText(text)
      setData(result)
      setPhase('result')
    } catch (e) {
      setErrorMsg(e.message)
      setPhase('error')
    }
  }

  function onTouchStart(e) { dragY.current = e.touches[0].clientY }
  function onTouchEnd(e) {
    if (e.changedTouches[0].clientY - dragY.current > 80) onClose()
  }

  return (
    <div
      className="popup-overlay"
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose() }}
    >
      <div className="popup-sheet" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="popup-handle" />

        <p className="translate-source">« {text.length > 120 ? text.slice(0, 120) + '…' : text} »</p>

        {phase === 'loading' && (
          <div className="popup-loading"><span className="spinner large" /></div>
        )}

        {phase === 'error' && (
          <div className="popup-error">
            <p>Erreur : {errorMsg}</p>
            <button className="popup-retry" onClick={fetchTranslation}>Réessayer</button>
          </div>
        )}

        {phase === 'result' && data && (
          <div className="popup-translation">
            <p className="popup-translation-text">{data.translation_fr}</p>
            <p className="popup-translation-explain">{data.explanation_fr}</p>
          </div>
        )}

        <div className="popup-actions" style={{ marginTop: 16 }}>
          <button className="popup-action secondary" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  )
}
