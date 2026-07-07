export const COMMAND_POLICY_ACTIONS = {
  allow: "allow",
  review: "review",
  block: "block",
};

const READONLY_PATTERNS = [
  /^(?:sudo\s+)?(?:uptime|whoami|id|hostname|date|pwd)\b/,
  /^(?:sudo\s+)?(?:df|du|free|top|ps|ss|netstat|lsof|vmstat|iostat)\b/,
  /^(?:sudo\s+)?(?:cat|less|more|head|tail|grep|egrep|fgrep|awk|sed)\b/,
  /^(?:sudo\s+)?(?:journalctl|systemctl\s+(?:status|is-active|is-failed|list-units))\b/,
  /^(?:sudo\s+)?(?:docker\s+(?:ps|logs|inspect|stats)|kubectl\s+(?:get|describe|logs))\b/,
  /^(?:sudo\s+)?(?:nginx\s+-t|mysqladmin\s+status)\b/,
];

const REVIEW_PATTERNS = [
  /\bsudo\b/,
  /\bsystemctl\s+(?:restart|reload|stop|start|enable|disable)\b/,
  /\bservice\s+\S+\s+(?:restart|reload|stop|start)\b/,
  /\bdocker\s+(?:restart|stop|start|exec|rm|compose\s+(?:up|down|restart))\b/,
  /\bkubectl\s+(?:delete|apply|scale|rollout|exec|patch)\b/,
  /\b(?:vim|vi|nano)\b/,
];

const BLOCK_PATTERNS = [
  /\brm\s+.*-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)\b/,
  /\brm\s+-rf\s+\/(?:\s|$)/,
  /\bmkfs(?:\.\w+)?\b/,
  /\bdd\s+.*\bof=\/dev\//,
  /\bshutdown\b|\breboot\b|\bpoweroff\b/,
  /\bchmod\s+-R\s+777\b/,
  /\bchown\s+-R\b/,
  /\b(?:userdel|groupdel|passwd)\b/,
  />\s*\/(?:etc|boot|usr|bin|sbin|lib|lib64)\//,
  /\btruncate\s+.*\/(?:etc|boot|usr|bin|sbin|lib|lib64)\//,
  /\bcurl\b.*\|\s*(?:sh|bash)\b/,
  /\bwget\b.*\|\s*(?:sh|bash)\b/,
];

export function evaluateCommandPolicy(command) {
  const normalized = normalizeCommand(command);
  if (!normalized) {
    return buildDecision(COMMAND_POLICY_ACTIONS.block, "高", "命令为空，已阻断。", "empty");
  }

  const segments = splitCommandSegments(normalized);
  if (segments.some((segment) => matchesAny(segment, BLOCK_PATTERNS))) {
    return buildDecision(COMMAND_POLICY_ACTIONS.block, "高", "命令包含高危写入或破坏性操作，已阻断。", "destructive");
  }

  if (segments.some((segment) => matchesAny(segment, REVIEW_PATTERNS))) {
    return buildDecision(COMMAND_POLICY_ACTIONS.review, "中", "命令可能修改服务或系统状态，需要二次确认。", "mutation");
  }

  if (segments.every((segment) => matchesAny(segment, READONLY_PATTERNS))) {
    return buildDecision(COMMAND_POLICY_ACTIONS.allow, "低", "只读诊断命令，允许执行。", "readonly");
  }

  return buildDecision(COMMAND_POLICY_ACTIONS.review, "中", "命令不在只读白名单内，需要二次确认。", "unknown");
}

export function shouldRequireSecondApproval(policyDecision) {
  return policyDecision?.action === COMMAND_POLICY_ACTIONS.review;
}

export function normalizeCommand(command) {
  return String(command || "").trim().replace(/\s+/g, " ");
}

function splitCommandSegments(command) {
  return command
    .split(/\s*(?:&&|\|\||;)\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function matchesAny(command, patterns) {
  return patterns.some((pattern) => pattern.test(command));
}

function buildDecision(action, risk, message, reason) {
  return { action, risk, message, reason };
}
