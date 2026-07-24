import { Input, InputNumber, Select } from 'antd'

function optionsFor (parameter, capabilities = {}) {
  if (parameter.source === 'services') {
    return (capabilities.services || []).map(service => ({
      label: service.name,
      value: service.name
    }))
  }
  if (parameter.source === 'interfaces') {
    return [
      { label: '任意网卡', value: 'any' },
      ...(capabilities.interfaces || []).map(item => ({
        label: `${item.name}${item.cidr ? ` · ${item.cidr}` : ''}${item.state ? ` · ${item.state}` : ''}`,
        value: item.name
      }))
    ]
  }
  return (parameter.options || []).map(option => {
    if (typeof option === 'string') return { label: option, value: option }
    return option
  })
}

export function buildParameterDefaults (tool) {
  return Object.fromEntries(
    (tool?.parameters || []).map(parameter => [
      parameter.id,
      parameter.defaultValue ?? (parameter.type === 'multi-select' ? [] : '')
    ])
  )
}

export default function ParameterForm ({
  tool,
  values,
  capabilities,
  disabled,
  onChange
}) {
  if (!tool?.parameters?.length) {
    return (
      <div className='operations-parameter-empty'>
        此诊断无需填写参数，可直接运行。
      </div>
    )
  }
  return (
    <div className='operations-parameter-grid'>
      {tool.parameters.map(parameter => {
        const options = optionsFor(parameter, capabilities)
        const common = {
          disabled,
          value: values[parameter.id],
          onChange: value => onChange(parameter.id, value)
        }
        return (
          <label className='operations-parameter-field' key={parameter.id}>
            <span>{parameter.label}</span>
            {parameter.type === 'number' || parameter.type === 'port'
              ? <InputNumber {...common} min={parameter.type === 'port' ? 1 : undefined} max={parameter.type === 'port' ? 65535 : undefined} />
              : parameter.type === 'select' || parameter.type === 'multi-select'
                ? (
                  <Select
                    {...common}
                    mode={parameter.type === 'multi-select' ? 'multiple' : undefined}
                    options={options}
                    showSearch
                    optionFilterProp='label'
                    placeholder={options.length ? '请选择' : '连接后自动读取'}
                  />
                  )
                : <Input {...common} placeholder={parameter.placeholder || `请输入${parameter.label}`} />}
            {parameter.help ? <small>{parameter.help}</small> : null}
          </label>
        )
      })}
    </div>
  )
}
