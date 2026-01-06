import { execSync } from 'child_process'
let handler = async (m, { conn, text }) => {
await m.react('⏳')
if (conn.user.jid == conn.user.jid) {
let stdout = execSync('git pull' + (m.fromMe && text ? ' ' + text : ''))
await conn.reply(m.chat, stdout.toString(), m)
await m.react('✅')
}}
handler.help = ['carga']
handler.tags = ['owner']
handler.command = ['update', 'actualizar', 'carga', 'carga'] 
handler.rowner = false

export default handler