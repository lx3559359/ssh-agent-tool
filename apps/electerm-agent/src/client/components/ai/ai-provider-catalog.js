export const recommendedAIProviders = Object.freeze([
  {
    preset: 'deepseek',
    name: 'DeepSeek',
    region: '国内',
    description: '国内访问方便，提供通用对话与推理模型。',
    tags: ['OpenAI 兼容', '推理模型'],
    website: 'https://platform.deepseek.com/'
  },
  {
    preset: 'dashscope',
    name: '阿里云百炼',
    region: '国内',
    description: '提供通义千问系列模型和 OpenAI 兼容接口。',
    tags: ['国内平台', '模型丰富'],
    website: 'https://bailian.console.aliyun.com/'
  },
  {
    preset: 'siliconflow',
    name: '硅基流动',
    region: '国内',
    description: '聚合多种开源模型，适合快速测试和切换模型。',
    tags: ['OpenAI 兼容', '开源模型'],
    website: 'https://cloud.siliconflow.cn/'
  },
  {
    preset: 'bigmodel',
    name: '智谱开放平台',
    region: '国内',
    description: '提供 GLM 系列模型和国内可用的模型接口。',
    tags: ['GLM', '国内平台'],
    website: 'https://open.bigmodel.cn/'
  },
  {
    preset: 'moonshot',
    name: 'Moonshot Kimi',
    region: '国内',
    description: '提供 Kimi 系列模型，适合长文本与通用问答。',
    tags: ['长文本', 'OpenAI 兼容'],
    website: 'https://platform.kimi.com/'
  },
  {
    preset: 'volcengine',
    name: '火山方舟',
    region: '国内',
    description: '提供豆包等模型服务和企业级模型管理能力。',
    tags: ['豆包', '企业平台'],
    website: 'https://console.volcengine.com/ark'
  },
  {
    preset: 'openai',
    name: 'OpenAI',
    region: '海外',
    description: 'OpenAI 官方 API 平台，需要可访问的网络环境。',
    tags: ['官方平台', 'GPT'],
    website: 'https://platform.openai.com/'
  },
  {
    preset: 'openrouter',
    name: 'OpenRouter',
    region: '海外',
    description: '通过统一兼容接口访问多个海外模型提供商。',
    tags: ['模型聚合', 'OpenAI 兼容'],
    website: 'https://openrouter.ai/'
  },
  {
    preset: 'ollama',
    name: 'Ollama 本地模型',
    region: '本地',
    description: '在本机运行模型，适合离线使用和隐私敏感场景。',
    tags: ['本地部署', '离线可用'],
    website: 'https://ollama.com/download'
  }
])
