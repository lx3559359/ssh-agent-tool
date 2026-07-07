const fs = require('fs')
const { writeSrc } = require('./build-common')

writeSrc('win-x64-portable.tar.gz')

const configPath = 'electron-builder.json'
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

config.win.target = ['tar.gz']
config.artifactName = 'AIGShell-${version}-${os}-${arch}-portable.${ext}' // eslint-disable-line no-template-curly-in-string

fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
