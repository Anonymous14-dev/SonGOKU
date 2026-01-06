console.clear()
console.log('🟢 CARGANDO...')

import { join, dirname } from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { setupMaster, fork } from 'cluster'
import { watchFile, unwatchFile } from 'fs'
import cfonts from 'cfonts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(__dirname)

import { cleanPremiums } from "./lib/cleanPremium.js";

// correr la limpieza cada hora (puedes ajustar ms)
setInterval(() => {
  cleanPremiums();
}, 1000 * 60 * 60);

cfonts.say('Son-Goku', {
  font: 'block',        
  align: 'center',
  gradient: ['cyan', 'magenta'],
  env: 'node'
})


cfonts.say('Made by Wilker', {
  font: 'console',     
  align: 'center',
  gradient: ['cyan', 'white'],
  env: 'node'
})

let isWorking = false

async function launch(scripts) {
  if (isWorking) return
  isWorking = true

  for (const script of scripts) {
    const args = [join(__dirname, script), ...process.argv.slice(2)]

    setupMaster({
      exec: args[0],
      args: args.slice(1),
    })

    let child = fork()

    child.on('exit', (code) => {
      console.log(`⚠️ Proceso terminado con código ${code}`)
      isWorking = false
      launch(scripts)

      if (code === 0) return
      watchFile(args[0], () => {
        unwatchFile(args[0])
        console.log('🔄 Archivo actualizado, reiniciando...')
        launch(scripts)
      })
    })
  }
}

launch(['SonGoku.js'])