import yts from 'yt-search'

const MAX_SECONDS = 90 * 60
const HTTP_TIMEOUT_MS = 90 * 1000

// Configuración de la API
const API_BASE_URL = 'https://api-adonix.ultraplus.click'
const API_ENDPOINT = '/download/ytaudio'

function parseDurationToSeconds(d) {
  if (d == null) return null
  if (typeof d === 'number' && Number.isFinite(d)) return Math.max(0, Math.floor(d))
  const s = String(d).trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return Math.max(0, parseInt(s, 10))
  const parts = s.split(':').map((x) => x.trim()).filter(Boolean)
  if (!parts.length || parts.some((p) => !/^\d+$/.test(p))) return null
  let sec = 0
  for (const p of parts) sec = sec * 60 + parseInt(p, 10)
  return Number.isFinite(sec) ? sec : null
}

function formatErr(err, maxLen = 1500) {
  const e = err ?? 'Error desconocido'
  let msg = ''

  if (e instanceof Error) msg = e.stack || `${e.name}: ${e.message}`
  else if (typeof e === 'string') msg = e
  else {
    try {
      msg = JSON.stringify(e, null, 2)
    } catch {
      msg = String(e)
    }
  }

  msg = String(msg || 'Error desconocido').trim()
  if (msg.length > maxLen) msg = msg.slice(0, maxLen) + '\n... (recortado)'
  return msg
}

async function fetchJson(url, timeoutMs = HTTP_TIMEOUT_MS) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      headers: { 
        accept: 'application/json', 
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })

    const text = await res.text().catch(() => '')
    let data = null

    try {
      data = text ? JSON.parse(text) : null
    } catch {
      throw new Error(`Respuesta no es JSON válido: ${text.slice(0, 200)}`)
    }

    if (!res.ok) {
      const msg = data?.message || data?.error || data?.info || text || `HTTP ${res.status}`
      throw new Error(`HTTP ${res.status}: ${String(msg).slice(0, 400)}`)
    }

    if (data == null) throw new Error('Respuesta JSON vacía')
    return data
  } finally {
    clearTimeout(t)
  }
}

async function fetchBuffer(url, timeoutMs = HTTP_TIMEOUT_MS) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { 
      signal: ctrl.signal, 
      headers: { 
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      } 
    })
    if (!res.ok) throw new Error(`No se pudo descargar el audio (HTTP ${res.status})`)
    const ab = await res.arrayBuffer()
    return Buffer.from(ab)
  } finally {
    clearTimeout(t)
  }
}

function guessMimeFromUrl(fileUrl = '') {
  let ext = ''
  try {
    ext = new URL(fileUrl).pathname.split('.').pop() || ''
  } catch {
    ext = String(fileUrl).split('.').pop() || ''
  }
  ext = '.' + String(ext).toLowerCase().replace(/[^a-z0-9]/g, '')
  if (ext === '.m4a') return 'audio/mp4'
  if (ext === '.opus') return 'audio/ogg; codecs=opus'
  if (ext === '.webm') return 'audio/webm'
  return 'audio/mpeg'
}

async function fetchAudioFromAPI(ytUrl, apiKey) {
  const apiUrl = `${API_BASE_URL}${API_ENDPOINT}?apikey=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(ytUrl)}`

  console.log(`[API] Solicitando: ${apiUrl}`)

  const response = await fetchJson(apiUrl, HTTP_TIMEOUT_MS)

  // Verificar diferentes formatos de respuesta de la API
  if (!response || typeof response !== 'object') {
    throw new Error('Respuesta de la API inválida')
  }

  // Verificar si hay error en la respuesta
  if (response.error) {
    throw new Error(`API Error: ${response.error}`)
  }

  if (response.message) {
    throw new Error(`API Message: ${response.message}`)
  }

  // Buscar URL de audio en diferentes posibles estructuras
  let audioUrl = null
  let title = 'Audio YouTube'

  // Estructura 1: response.data.url
  if (response.data?.url) {
    audioUrl = response.data.url
    title = response.data.title || title
  }
  // Estructura 2: response.url
  else if (response.url) {
    audioUrl = response.url
    title = response.title || title
  }
  // Estructura 3: response.links o response.download
  else if (response.links?.[0]?.url) {
    audioUrl = response.links[0].url
    title = response.links[0].title || title
  }
  else if (response.download) {
    audioUrl = response.download
    title = response.title || title
  }

  if (!audioUrl) {
    console.log('[API] Estructura de respuesta:', JSON.stringify(response, null, 2))
    throw new Error('No se encontró URL de audio en la respuesta de la API')
  }

  // Asegurar que la URL sea válida
  if (!audioUrl.startsWith('http')) {
    audioUrl = `https:${audioUrl}`
  }

  return { url: audioUrl, title }
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  const chatId = m?.chat || m?.key?.remoteJid
  if (!chatId) return

  if (!text) {
    return conn.sendMessage(
      chatId,
      { text: `「✦」Escribe el nombre o link del video.\n> ✐ Ejemplo » *${usedPrefix + command} lovely*` },
      { quoted: m }
    )
  }

  await conn.sendMessage(chatId, { react: { text: '🕒', key: m.key } }).catch(() => {})

  let ytUrl = text.trim()
  let ytInfo = null

  try {
    if (!/youtu\.be|youtube\.com/i.test(ytUrl)) {
      // Búsqueda por texto
      const search = await yts({ query: ytUrl, pages: 1 })
      const first = search?.videos?.[0]
      if (!first) {
        await conn.sendMessage(chatId, { text: '「✦」No se encontraron resultados.' }, { quoted: m })
        return
      }
      ytInfo = first
      ytUrl = first.url
    } else {
      // Búsqueda por URL
      const search = await yts({ query: ytUrl, pages: 1 })
      if (search?.videos?.length) ytInfo = search.videos[0]
    }
  } catch (e) {
    await conn.sendMessage(
      chatId,
      { text: `「✦」Error buscando en YouTube.\n\n> 🧩 Error:\n\`\`\`\n${formatErr(e)}\n\`\`\`` },
      { quoted: m }
    )
    return
  }

  // Verificar duración
  const durSec =
    parseDurationToSeconds(ytInfo?.duration?.seconds) ??
    parseDurationToSeconds(ytInfo?.seconds) ??
    parseDurationToSeconds(ytInfo?.duration) ??
    parseDurationToSeconds(ytInfo?.timestamp)

  if (durSec && durSec > MAX_SECONDS) {
    await conn.sendMessage(
      chatId,
      { text: `「✦」Audio muy largo.\n> Máx: ${Math.floor(MAX_SECONDS / 60)} min.` },
      { quoted: m }
    )
    return
  }

  const title = ytInfo?.title || 'Audio'
  const author = ytInfo?.author?.name || ytInfo?.author || 'Desconocido'
  const duration = ytInfo?.timestamp || 'Desconocida'
  const thumbnail = ytInfo?.thumbnail

  const caption =
    `「✦」Enviando *${title}*\n\n` +
    `> ❀ Canal » *${author}*\n` +
    `> ⴵ Duración » *${duration}*\n` +
    `> 🜸 Link » ${ytUrl}`

  try {
    if (thumbnail) {
      await conn.sendMessage(chatId, { 
        image: { url: thumbnail }, 
        caption 
      }, { quoted: m })
    } else {
      await conn.sendMessage(chatId, { text: caption }, { quoted: m })
    }
  } catch {}

  // Obtener API key
  const apiKey = globalThis.apikey || 'WilkerKeydukz9l6871'

  if (!apiKey || apiKey === 'TU_API_KEY_AQUI') {
    await conn.sendMessage(
      chatId, 
      { 
        text: `「✦」API key no configurada.\n\n> Configura globalThis.apikey en tu archivo principal o usa:\n> \`globalThis.apikey = 'WilkerKeydukz9l6871'\`` 
      }, 
      { quoted: m }
    )
    return
  }

  let audioData = null

  try {
    audioData = await fetchAudioFromAPI(ytUrl, apiKey)
  } catch (e) {
    await conn.sendMessage(
      chatId,
      { 
        text: `「✦」Error obteniendo audio de la API.\n\n> 🧩 Error:\n\`\`\`\n${formatErr(e)}\n\`\`\`` 
      },
      { quoted: m }
    )
    return
  }

  // Intentar descargar y enviar el audio
  try {
    const audioBuffer = await fetchBuffer(audioData.url, HTTP_TIMEOUT_MS)
    const mime = guessMimeFromUrl(audioData.url)

    // Limpiar nombre del archivo
    const cleanTitle = audioData.title
      .replace(/[^\w\s.-]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 100)

    await conn.sendMessage(
      chatId,
      {
        audio: audioBuffer,
        mimetype: mime,
        fileName: `${cleanTitle}.mp3`,
        ptt: false
      },
      { quoted: m }
    )

    await conn.sendMessage(chatId, { react: { text: '✔️', key: m.key } }).catch(() => {})

  } catch (e) {
    // Si falla la descarga directa, enviar el link como alternativa
    await conn.sendMessage(
      chatId,
      { 
        text: `「✦」Error descargando el audio. Aquí tienes el link directo:\n\n${audioData.url}\n\n> 🧩 Error:\n\`\`\`\n${formatErr(e)}\n\`\`\`` 
      },
      { quoted: m }
    )
  }
}

handler.help = ['play <texto|link>']
handler.tags = ['multimedia']
handler.command = ['play', 'ytplay', 'ytaudio', 'playaudio']

// Configurar límites de uso
handler.limit = true
handler.premium = false

export default handler