// Function to generate the error HTML string
function generateErrorHtml (port) {
  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>连接错误</title>
      <style>
        body {
          font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
          margin: 40px;
          line-height: 1.7;
          background: #fff;
          color: #1f2937;
        }
        h1 {
          color: #d32f2f;
        }
        .section {
          margin-bottom: 20px;
          max-width: 760px;
        }
        ul {
          margin: 10px 0;
          padding-left: 22px;
        }
        code {
          background: #f3f4f6;
          border-radius: 4px;
          padding: 2px 6px;
        }
      </style>
    </head>
    <body>
      <div class="section">
        <h1>检测到本地连接问题</h1>
        <p>工具无法连接到本地服务 <code>http://127.0.0.1:${port}</code>。这通常是代理软件、VPN、安全软件或防火墙拦截了本机回环地址导致的。</p>
        <p><strong>建议按下面顺序排查：</strong></p>
        <ul>
          <li>检查代理软件，确保 <code>127.0.0.1</code>、<code>localhost</code> 或本工具可执行文件已加入直连/排除列表。</li>
          <li>临时关闭 VPN、网络加速器或流量接管工具，再重新启动本工具。</li>
          <li>检查 Windows 防火墙、杀毒软件或终端安全策略是否阻止了本地端口。</li>
          <li>如果刚刚更新过工具，请完全退出后重新打开。</li>
        </ul>
        <p>问题仍存在时，请打开工具日志，把日志内容和当前系统环境一起提交到项目 Issue。</p>
      </div>
    </body>
    </html>
  `
}

module.exports = generateErrorHtml
