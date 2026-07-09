const fs = require('fs')
const { writeSrc } = require('./build-common')

writeSrc('win-x64-portable.zip')

const configPath = 'electron-builder.json'
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

config.win.target = ['zip']
config.artifactName = 'ShellPilot-${version}-${os}-${arch}-portable.${ext}' // eslint-disable-line no-template-curly-in-string

fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
