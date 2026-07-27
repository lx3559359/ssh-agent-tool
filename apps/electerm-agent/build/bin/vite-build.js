#!/bin/bash
const { exec, cd } = require('shelljs')
const { resolve } = require('path')
const { assertCurrentReleaseBaseline } = require('./release-version-baseline')

assertCurrentReleaseBaseline()

const p = resolve(__dirname, '../vite')
cd(p)

const result = exec('npm run build')
if (result.code !== 0) {
  process.exit(result.code)
}
