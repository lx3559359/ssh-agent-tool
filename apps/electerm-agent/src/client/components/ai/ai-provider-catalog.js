export const recommendedAIProviders = Object.freeze([
  {
    preset: 'deepseek',
    name: 'DeepSeek',
    region: 'domestic',
    openAICompatible: true,
    description: '提供通用对话与推理模型，国内访问方便。',
    tags: ['推理模型', '中文'],
    website: 'https://platform.deepseek.com/'
  },
  {
    preset: 'dashscope',
    name: '阿里云百炼',
    region: 'domestic',
    openAICompatible: true,
    description: '提供通义千问系列模型与兼容接口。',
    tags: ['通义千问', '企业服务'],
    website: 'https://bailian.console.aliyun.com/'
  },
  {
    preset: 'siliconflow',
    name: '硅基流动',
    region: 'domestic',
    openAICompatible: true,
    description: '聚合多种开源模型，适合快速试用和模型切换。',
    tags: ['开源模型', '模型聚合'],
    website: 'https://cloud.siliconflow.cn/'
  },
  {
    preset: 'bigmodel',
    name: '智谱开放平台',
    region: 'domestic',
    openAICompatible: true,
    description: '提供 GLM 系列模型和国内可用的模型接口。',
    tags: ['GLM', '国产模型'],
    website: 'https://open.bigmodel.cn/'
  },
  {
    preset: 'moonshot',
    name: 'Moonshot Kimi',
    region: 'domestic',
    openAICompatible: true,
    description: '适合长文本处理和通用问答。',
    tags: ['长文本', '中文'],
    website: 'https://platform.kimi.com/'
  },
  {
    preset: 'volcengine',
    name: '火山方舟',
    region: 'domestic',
    openAICompatible: true,
    description: '提供豆包等模型服务与企业级模型管理能力。',
    tags: ['豆包', '企业服务'],
    website: 'https://console.volcengine.com/ark'
  },
  {
    preset: 'openai',
    name: 'OpenAI',
    region: 'international',
    openAICompatible: true,
    description: '官方 API 平台，需要可访问的网络环境。',
    tags: ['官方平台', 'GPT'],
    website: 'https://platform.openai.com/'
  },
  {
    preset: 'openrouter',
    name: 'OpenRouter',
    region: 'international',
    openAICompatible: true,
    description: '通过统一接口访问多个海外模型提供商。',
    tags: ['模型聚合', '多提供商'],
    website: 'https://openrouter.ai/'
  },
  {
    preset: 'ollama',
    name: 'Ollama 本地模型',
    region: 'local',
    openAICompatible: true,
    description: '在本机运行模型，适合离线或隐私敏感场景。',
    tags: ['本地部署', '离线可用'],
    website: 'https://ollama.com/download'
  }
])
