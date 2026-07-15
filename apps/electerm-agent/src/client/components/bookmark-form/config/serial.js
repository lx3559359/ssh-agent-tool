import { formItemLayout } from '../../../common/form-layout.js'
import { terminalSerialType, commonBaudRates, commonDataBits, commonStopBits, commonParities, commonTxLineEndings, commonRxLineEndings } from '../../../common/constants.js'
import defaultSettings from '../../../common/default-setting.js'
import { createBaseInitValues, getTerminalBackgroundDefaults } from '../common/init-values.js'
import { commonFields } from './common-fields.js'
import { createShellPilotRequiredRule } from '../../../common/shellpilot-i18n-overrides.js'

const e = window.translate

const serialConfig = {
  key: 'serial',
  type: terminalSerialType,
  initValues: (props) => {
    return createBaseInitValues(props, terminalSerialType, {
      baudRate: 9600,
      dataBits: 8,
      lock: true,
      stopBits: 1,
      parity: 'none',
      rtscts: false,
      xon: false,
      xoff: false,
      xany: false,
      term: defaultSettings.terminalType,
      displayRaw: false,
      runScripts: [{}],
      ignoreKeyboardInteractive: false,
      ...getTerminalBackgroundDefaults(defaultSettings)
    })
  },
  layout: formItemLayout,
  tabs: () => [
    {
      key: 'auth',
      label: e('auth'),
      fields: [
        commonFields.category,
        commonFields.colorTitle,
        commonFields.labels,
        { type: 'serialPathSelector', name: 'path', label: () => e('path'), rules: [createShellPilotRequiredRule(e, 'path')] },
        {
          type: 'autocomplete',
          name: 'baudRate',
          label: () => e('shellpilotSerialBaudRate'),
          options: commonBaudRates.map(d => ({ value: d.toString(), label: d.toString() })),
          normalize: (value) => {
            if (value === '' || value == null) {
              return undefined
            }
            const numValue = Number(value)
            return isNaN(numValue) ? undefined : numValue
          }
        },
        { type: 'select', name: 'dataBits', label: () => e('shellpilotSerialDataBits'), options: commonDataBits.map(d => ({ value: d, label: d })) },
        { type: 'select', name: 'stopBits', label: () => e('shellpilotSerialStopBits'), options: commonStopBits.map(d => ({ value: d, label: d })) },
        { type: 'select', name: 'parity', label: () => e('shellpilotSerialParity'), options: commonParities.map(d => ({ value: d, label: d })) },
        { type: 'switch', name: 'lock', label: () => e('shellpilotSerialLock'), valuePropName: 'checked' },
        { type: 'switch', name: 'rtscts', label: () => e('shellpilotSerialRtsCts'), valuePropName: 'checked' },
        { type: 'switch', name: 'xon', label: () => e('shellpilotSerialXon'), valuePropName: 'checked' },
        { type: 'switch', name: 'xoff', label: () => e('shellpilotSerialXoff'), valuePropName: 'checked' },
        { type: 'switch', name: 'xany', label: () => e('shellpilotSerialXany'), valuePropName: 'checked' },
        { type: 'select', name: 'txLineEnding', label: () => e('shellpilotSerialTxLineEnding'), options: commonTxLineEndings.map(d => ({ value: d.value, label: d.label })) },
        { type: 'select', name: 'rxLineEnding', label: () => e('shellpilotSerialRxLineEnding'), options: commonRxLineEndings.map(d => ({ value: d.value, label: d.label })) },
        commonFields.runScripts,
        commonFields.description,
        { type: 'input', name: 'type', label: 'type', hidden: true }
      ]
    },
    {
      key: 'settings',
      label: e('settings'),
      fields: [
        { type: 'terminalBackground', name: 'terminalBackground', label: () => e('terminalBackgroundImage') }
      ]
    },
    {
      key: 'quickCommands',
      label: e('quickCommands'),
      fields: [
        { type: 'quickCommands', name: '__quick__', label: '' }
      ]
    }
  ]
}

export default serialConfig
