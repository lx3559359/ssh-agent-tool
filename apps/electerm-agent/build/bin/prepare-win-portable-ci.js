const fs = require('fs')
const { writeSrc } = require('./build-common')

writeSrc('win-x64-portable.tar.gz')

const configPath = 'electron-builder.json'
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

config.win.target = ['tar.gz']
config.artifactName = 'SSH-Agent-Tool-${version}-${os}-${arch}-portable.${ext}'

fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
