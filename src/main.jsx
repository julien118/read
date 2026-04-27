import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

window.onerror = function(msg, src, line, col, err) {
  document.body.innerHTML = `
    <div style="color:white;background:#000;padding:20px;font-size:14px;
    word-break:break-all;position:fixed;top:0;left:0;right:0;bottom:0;
    overflow:auto;z-index:99999">
      <h2>ERROR</h2>
      <p><b>Message:</b> ${msg}</p>
      <p><b>Source:</b> ${src}</p>
      <p><b>Line:</b> ${line}:${col}</p>
      <p><b>Stack:</b> ${err ? err.stack : 'none'}</p>
    </div>
  `
  return true
}

window.onunhandledrejection = function(e) {
  document.body.innerHTML = `
    <div style="color:white;background:#000;padding:20px;font-size:14px;
    word-break:break-all;position:fixed;top:0;left:0;right:0;bottom:0;
    overflow:auto;z-index:99999">
      <h2>UNHANDLED REJECTION</h2>
      <p><b>Reason:</b> ${e.reason}</p>
      <p><b>Stack:</b> ${e.reason && e.reason.stack ? e.reason.stack : 'none'}</p>
    </div>
  `
}

createRoot(document.getElementById('root')).render(<App />)
