/**
 * create edit language file link
 */

export default (lang) => {
  return `https://github.com/lx3559359/ssh-agent-tool/issues/new?title=${encodeURIComponent(`翻译反馈：${lang}`)}`
}
