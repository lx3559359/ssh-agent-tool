# SFTP `su` 身份跟随与隐藏提示符修复设计

> 结论：保留每次远程文件操作前的当前 PTY 有效身份核验；修复密码输入覆盖 Shell 切换状态的问题，并让 SFTP 内部 PTY 任务只驱动命令追踪器、不再向可见终端追加提示符。

## 背景

ShellPilot v0.4.49 允许 SSH 登录用户在当前交互终端执行 `su`、`su -` 或 `sudo -i` 后，以当前 Shell 的有效身份浏览和修改远程文件。登录身份仍用于建立 SSH/SFTP 连接；当有效 UID 为 `0` 时，文件操作通过同一 PTY 的受控 root 后端执行。

真实 HikvisionOS 会话暴露了两个关联缺陷：

1. 使用普通账号 `hik` 浏览 SFTP 时，每次双击目录都会在可见终端追加一次 `[hik@HikvisionOS ~]$`。
2. 在终端执行裸 `su` 并输入密码后，root Shell 显示 `bash: __e_cmd: command not found`；随后 SFTP 显示文件操作身份未知，并拒绝远程文件操作。

## 根因

### 目录导航产生重复提示符

远程目录刷新统一通过 `withRemoteFileOperation()` 获取文件能力。能力获取会在当前 PTY 执行受控身份探测。内部命令和协议内容已被输出抑制隐藏，但任务结束后的自然 Shell 提示符仍被写入 xterm。目录双击触发一次目录刷新，因此每次都会追加一个可见提示符。

### 密码回车破坏 `su` 切换恢复

登录 Shell 注入的 Bash Integration 设置 `PROMPT_COMMAND=__e_cmd`。`su` 启动的 root Bash 继承该变量，但不会继承未导出的 `__e_cmd` 函数，所以 root Shell 首次绘制提示符时报告命令不存在。

ShellPilot 已能识别交互式 `su` 并记录待恢复的子 Shell 候选，但终端输入处理在密码模式下仍先执行普通命令识别。密码回车读取到旧的 `su` 命令状态后，会用一个未认证候选覆盖已经由原 Shell Integration 认证的候选。root 输出到达后，受控 PTY 准备逻辑无法证明当前子 Shell 来自已认证的 `su`，因而不会执行当前 Shell 重注入，最终安全地拒绝 SFTP 身份探测。

## 目标

- 连续双击或刷新 SFTP 目录不向可见终端追加提示符或内部命令。
- 裸 `su`、`su -`、`su root` 和 `sudo -i` 成功进入 root Shell 后，SFTP 自动使用当前 root 身份。
- 从 root Shell 执行 `exit` 后，SFTP 自动恢复登录用户身份。
- 保留每次远程文件操作前的精确会话、PTY 和有效身份校验。
- 失败、取消、超时、断线和重连路径不泄漏内部协议、不锁死键盘、不遗留 PTY 租约。

## 非目标

- 不缓存有效 UID 或基于时间推测当前身份。
- 不使用额外 root 密码、密钥或第二条 root SSH/SFTP 连接。
- 不放宽现有 root 文件协议、路径绑定、恢复记录或端点校验。
- 不改变普通用户命令、普通终端提示符或非受控终端输出的显示行为。
- 不处理服务器自身不允许 `su`、root 登录或目标目录访问的权限配置问题。

## 设计

### 1. 密码输入不参与普通命令识别

终端 `onData` 在处理输入前读取可靠的密码模式状态。密码模式由 Attach Addon 的实际密码检测状态提供；命令建议组件的密码状态仅作为界面辅助，不能成为唯一信号。

密码模式为真时：

- 不调用普通 `handleInputEvent`，因此密码字符和密码回车不会写入命令历史、`exit` 判断或 Shell 切换候选状态。
- 保留现有密码建议关闭和密码状态清理行为。
- 密码仍通过原有输入通道发送到远端，不改变回显与安全处理。

这样，原登录 Shell 通过认证 OSC 命令记录建立的 `su` 切换候选不会被密码回车覆盖。

### 2. Shell Integration hook 不泄漏到子 Shell

Bash Integration 设置新的 `PROMPT_COMMAND` 后，显式使用 `export -n PROMPT_COMMAND` 清除该变量可能从用户环境继承的 export 属性。ShellPilot 的提示符 hook 只属于当前交互 Shell，不应作为环境变量传播到 `su`、`bash` 或其他子 Shell。

现有 `__e_old_prompt_command` 仍在当前 Shell 内按原逻辑执行；此改动只阻止 ShellPilot 覆盖后的 `PROMPT_COMMAND=__e_cmd` 被子进程继承。即使用户原环境曾导出 `PROMPT_COMMAND`，ShellPilot 注入期间也不得向子进程传播仅在当前进程定义的函数名。这样，新 root Bash 的第一个提示符不会尝试调用不存在的 `__e_cmd`。

### 3. 在已认证的当前子 Shell 重建 Integration

当 `su`/`sudo -i` 候选已经由旧 Shell Integration 认证，并且其后观察到新的远端输出时，受控 PTY 准备流程继续使用现有的安静窗口：

1. 等待当前子 Shell 输出稳定。
2. 使用当前会话 nonce 生成 Current Shell Integration 命令。
3. 先清除继承的 `ELECTERM_SHELL_INTEGRATION` 标志，再按实际 Bash/Zsh 环境重建函数、hook 和提示符标记。
4. 收到当前 nonce 的认证提示符与命令输入帧后，才允许身份探测。

重注入只允许发生在已认证的交互式 Shell 切换候选上。任意普通命令输出、未经认证的提示符文本或单纯的用户名变化都不能触发重注入。

### 4. SFTP 内部 PTY 任务隐藏自然提示符

受控 PTY 输出抑制继续完成两项不同职责：

- 向远端输出订阅者发布文件协议帧，使解析器能够验证 UID、用户名、能力和操作结果。
- 向 Command Tracker 传递当前 nonce 的认证 `OSC 633` 生命周期帧，使控制器能够确认命令结束、提示符返回和空输入状态。

对 `root-file:*` 所有者的 SFTP 内部任务，表现层不得把以下内容写入可见终端：

- 内部命令回显；
- `SHELLPILOT_FILE` 和命令分帧协议内容；
- 任务结束后由 Shell 打印的自然提示符文本。

认证的 `A`（提示符开始）、`B`（命令输入开始）和 `D`（命令结束）帧仍进入 xterm 解析器/Command Tracker，但它们本身不产生可见字符。原来已经显示的用户提示符保留在屏幕上，因此内部任务结束后光标和命令输入状态恢复，而不会新增一份提示符。

该隐藏策略通过受控任务选项限定在 SFTP/root 文件任务，不改变普通命令、普通安全命令或用户主动运行的终端任务显示。

### 5. 文件后端路由保持严格

每次远程文件操作仍执行当前 PTY 身份探测，不新增身份缓存：

- 有效 UID 为 `0`：使用 `pty-root` 后端，并保留当前 PTY 租约至操作完成。
- 有效 UID 非 `0`：释放探测 PTY 租约，使用登录用户的原生 SFTP 后端。
- 身份无法确认、会话代次变化、SFTP 与终端端点不一致：拒绝操作，不降级到不确定身份。

执行 `exit` 后，登录 Shell 原有 Integration 恢复；下一次文件操作重新探测到非 root UID，并自动回到原生 SFTP 路由。

## 错误与清理

- 身份探测失败：返回 `REMOTE_FILE_IDENTITY_UNAVAILABLE`，不发送远程文件读写或修改请求。
- 当前 Shell 重注入失败：不记录或复用 root 身份；终端普通输入仍可用，用户可以重试或重连。
- PTY 任务取消或超时：继续要求服务器中断确认或当前 nonce 的可信新提示符；无法确认时维持 recovery lock。
- 输出抑制的正常结束、取消、发送失败、断线和 dispose 路径都必须幂等清理扫描缓冲、待发送输入和发布状态。
- PTY 租约释放失败：维持现有粘滞不确定状态，禁止继续复用该文件能力。
- 任何错误路径都不得回放已隐藏的内部命令、协议数据、密码输入或重复提示符。

## 测试设计

### 单元回归测试

1. 模拟已认证的裸 `su` 候选和密码提示；输入密码字符及回车后，候选对象和认证状态保持不变。
2. 验证非密码模式下的普通命令、`exit` 与 Shell 切换识别行为不变。
3. 验证 Bash Integration 在设置 `PROMPT_COMMAND` 后显式取消其 export 属性，子 Shell 不会继承只能在父 Shell 中解析的 `__e_cmd`。
4. 模拟 SFTP 受控 PTY 命令的命令记录、协议结果、`D/A/B` 帧和自然提示符文本；断言：
   - 协议订阅者和解析器收到必要帧；
   - Command Tracker 回到空提示符状态；
   - xterm 缓冲区不包含内部命令、协议文本或新增提示符文本。
5. 验证普通受控终端任务未选择隐藏自然提示符时保持原有显示合同。
6. 覆盖取消、超时、同步发送失败、错误 nonce、分片字符串、二进制分片和 dispose，确认抑制状态与键盘队列均被清理。

### Electron + 本地 SSH/SFTP E2E

扩展本地 SSH 夹具，使其模拟真实 Bash 行为：

- 支持裸 `su` 后输出 `Password:` 并等待密码输入；
- 记录登录 Shell 是否把 `PROMPT_COMMAND` 限定为进程本地；缺少该约束时，root Shell 模拟继承 `PROMPT_COMMAND=__e_cmd` 并产生对应错误；
- 接受客户端在当前子 Shell 重装 Integration，并记录重装次数；
- `exit` 返回登录 Shell。

主流程验证：

1. 以 `hik` 登录并显式打开 SFTP。
2. 连续双击多个普通目录，终端可见文本不新增 `hik` 提示符。
3. 执行裸 `su`、输入密码并进入 root。
4. 打开 root 专属目录，验证身份栏为 `文件操作：root（当前终端）`。
5. 完成 root 文件浏览、编辑、新建目录和上传中的代表性操作。
6. 断言终端不存在 `__e_cmd: command not found`、内部协议和重复 root 提示符。
7. 执行 `exit`，验证 SFTP 恢复 hik 身份和权限。
8. 每个阶段确认无活动 PTY 租约、未决 settlement、输出抑制或键盘队列残留。

## 验证范围

- 针对性运行终端输入稳定性、托管 PTY 控制器、远程文件能力、SFTP 身份 UI 与路由单测。
- 运行扩展后的 `039.operations-pty-identity` E2E。
- 运行完整 `test-unit-ci`、StandardJS lint 和生产 Vite 构建。
- 若本机条件允许，再运行相关真实 SSH/SFTP 验收脚本，确认真实 HikvisionOS 风格 Bash 的行为。

## 验收标准

- 普通账号连续双击或刷新 SFTP 目录时，可见终端不新增提示符。
- 裸 `su` 密码流程不会覆盖已认证的 Shell 切换候选，也不再显示 `__e_cmd: command not found`。
- root Shell 中 SFTP 浏览和代表性文件修改通过当前 PTY root 后端成功执行。
- `exit` 后下一次 SFTP 操作自动恢复登录用户身份。
- 内部命令、协议字段、令牌和自然提示符不泄漏到终端缓冲区。
- 取消、超时、失败和断线路径不会锁死输入或遗留能力/租约。
- 相关测试、全量单测、lint 与构建全部通过。
