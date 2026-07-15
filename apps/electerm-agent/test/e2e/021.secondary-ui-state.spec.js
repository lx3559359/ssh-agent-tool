const fs = require('node:fs')
const path = require('node:path')
const { test, expect, chromium } = require('@playwright/test')

const projectRoot = path.resolve(__dirname, '../..')
const fixtureRoot = path.join(__dirname, 'fixtures/secondary-ui-state')
const edgeExecutable = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].find(fs.existsSync)

let viteServer
let fixtureUrl

async function launchFixture (fixture) {
  const browser = await chromium.launch({
    ...(edgeExecutable ? { executablePath: edgeExecutable } : {}),
    headless: true,
    args: ['--disable-gpu', '--disable-dev-shm-usage']
  })
  const page = await browser.newPage({ viewport: { width: 1024, height: 760 } })
  await page.goto(`${fixtureUrl}?fixture=${fixture}`)
  await page.locator('[data-fixture-ready="true"]').waitFor()
  return { browser, page }
}

test.beforeAll(async () => {
  const { createServer } = await import('vite')
  const react = (await import('@vitejs/plugin-react')).default
  viteServer = await createServer({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'error',
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      fs: {
        allow: [projectRoot]
      }
    }
  })
  await viteServer.listen()
  const address = viteServer.httpServer.address()
  fixtureUrl = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => {
  await viteServer?.close()
})

test('real AIConfig keeps draft and validation across language preview but applies changed source config', async () => {
  const { browser, page } = await launchFixture('ai')
  try {
    const apiUrl = page.locator('#baseURLAI')
    const apiKey = page.locator('#apiKeyAI')
    const role = page.locator('#roleAI')
    const profileSelect = page.getByRole('combobox').first()

    await expect(apiUrl).toHaveValue('https://stored.example.com/v1')
    await profileSelect.click()
    await expect(page.locator('.ant-select-item-option-content').filter({ hasText: 'stored-model' })).toBeVisible()
    await page.keyboard.press('Escape')
    await apiUrl.fill('not-a-valid-url')
    await apiKey.fill('draft-fixture-key')
    await role.fill('draft-role')
    await apiUrl.blur()
    await expect(page.getByText('请输入有效的 URL')).toBeVisible()
    await expect(apiUrl).toHaveAttribute('aria-invalid', 'true')

    await page.getByTestId('language-toggle').click()
    await expect(page.getByText('Quick Model API Setup')).toBeVisible()
    await profileSelect.click()
    await expect(page.locator('.ant-select-item-option-content').filter({ hasText: 'stored-model' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(apiUrl).toHaveValue('not-a-valid-url')
    await expect(apiKey).toHaveValue('draft-fixture-key')
    await expect(role).toHaveValue('draft-role')
    await expect(page.getByText('Enter a valid URL')).toBeVisible()
    await expect(apiUrl).toHaveAttribute('aria-invalid', 'true')

    await page.getByTestId('external-source').click()
    await expect(apiUrl).toHaveValue('https://external.example.com/v1')
    await expect(apiKey).toHaveValue('external-fixture-key')
    await expect(role).toHaveValue('external-role')
  } finally {
    await browser.close()
  }
})

test('real BatchOpEditor localizes new and loaded templates without rewriting a language-switched draft', async () => {
  const { browser, page } = await launchFixture('batch')
  try {
    const editor = page.locator('.simple-editor textarea')
    const englishNames = [
      'Connect SSH',
      'Create 5M test file',
      'Record file information',
      'Download 5M file',
      'Record download result',
      'Delete remote test file',
      'Upload file to remote server',
      'Record upload result',
      'Verify and clean up'
    ]
    const chineseNames = [
      '连接 SSH',
      '创建 5M 测试文件',
      '记录文件信息',
      '下载 5M 文件',
      '记录下载结果',
      '删除远程测试文件',
      '上传文件到远程服务器',
      '记录上传结果',
      '校验并清理'
    ]

    await expect.poll(async () => JSON.parse(await editor.inputValue()).map(step => step.name)).toEqual(englishNames)
    expect(await editor.inputValue()).not.toMatch(/[\u3400-\u9fff]/)
    await page.getByRole('button', { name: 'Load Template' }).click()
    expect(await editor.inputValue()).not.toMatch(/[\u3400-\u9fff]/)

    const custom = '[{"name":"custom draft","action":"command","command":"echo custom"}]'
    await editor.fill(custom)
    await page.getByTestId('language-toggle').click()
    await expect(editor).toHaveValue(custom)
    await page.getByRole('button', { name: '载入模板' }).click()
    expect(JSON.parse(await editor.inputValue()).map(step => step.name)).toEqual(chineseNames)
  } finally {
    await browser.close()
  }
})
