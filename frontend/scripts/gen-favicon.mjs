import { copyFileSync, readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const svg = readFileSync(resolve(dir, 'favicon.svg'), 'utf8')
copyFileSync(resolve(dir, 'favicon.svg'), resolve(dir, 'favicon.ico'))
writeFileSync(resolve(dir, 'favicon.ico'), svg, 'utf8')
console.log('favicon.ico created')
