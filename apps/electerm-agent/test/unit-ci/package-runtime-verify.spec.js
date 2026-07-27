const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  main,
  verifyRuntimePackage
} = require(path.resolve(__dirname, '../../build/bin/verify-runtime-package'))

const requiredRuntimeFiles = [
  'node_modules/form-data/lib/form_data.js',
  'node_modules/combined-stream/lib/combined_stream.js',
  'node_modules/delayed-stream/lib/delayed_stream.js',
  'node_modules/docx/dist/index.cjs',
  'node_modules/exceljs/lib/doc/workbook.js'
]

function makeRuntimePackage (files = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-runtime-package-'))
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'ssh-agent-tool',
      dependencies: {
        axios: '1.18.1'
      }
    }, null, 2)
  )
  for (const file of files) {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, 'module.exports = {}')
  }
  return root
}

test('runtime package verification rejects missing production dependency files', () => {
  const root = makeRuntimePackage(requiredRuntimeFiles.filter(file => {
    return !file.includes('combined-stream')
  }))

  assert.throws(
    () => verifyRuntimePackage({ appDir: root }),
    /combined-stream[\\/]lib[\\/]combined_stream\.js/
  )
})

test('runtime package verification rejects self file dependencies', () => {
  const root = makeRuntimePackage(requiredRuntimeFiles)
  const packagePath = path.join(root, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
  pkg.dependencies[pkg.name] = 'file:../..'
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2))

  assert.throws(
    () => verifyRuntimePackage({ appDir: root }),
    /must not depend on itself/
  )
})

test('runtime package verification accepts required production dependency files', () => {
  const root = makeRuntimePackage(requiredRuntimeFiles)

  assert.doesNotThrow(() => verifyRuntimePackage({ appDir: root }))
})

test('runtime package verification rejects missing office generator runtime files', () => {
  const root = makeRuntimePackage(requiredRuntimeFiles.filter(file => {
    return !file.includes('exceljs/lib/doc/workbook.js')
  }))

  assert.throws(
    () => verifyRuntimePackage({ appDir: root }),
    /exceljs[\\/]lib[\\/]doc[\\/]workbook\.js/
  )
})

test('runtime package verification exposes a package prepare entry point', () => {
  assert.equal(typeof main, 'function')
})
