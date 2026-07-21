import { READ_ONLY, NEED_EDIT, step, defineCommand, inputParam, numberParam, selectParam } from './shared/definition.js'
import { withRollback } from './shared/safety-metadata.js'
import { rollbackScriptFilenameMaxLength } from './shared/validation.js'

const RECOVERY_ASSET_CLEANUP_SHELL = `cleanup_owned_recovery_asset () {
  RECOVERY_FINAL="$1"
  RECOVERY_EXPECTED_INODE="$2"
  RECOVERY_LINK_ATTEMPTED="$3"
  [ -n "$RECOVERY_FINAL" ] && [ -n "$RECOVERY_EXPECTED_INODE" ] || return 0
  [ "$RECOVERY_LINK_ATTEMPTED" = "yes" ] || return 0
  [ -f "$RECOVERY_FINAL" ] && [ ! -L "$RECOVERY_FINAL" ] || return 0
  RECOVERY_CURRENT_INODE="$(stat -c %d:%i -- "$RECOVERY_FINAL" 2>/dev/null)" || return 0
  if [ "$RECOVERY_CURRENT_INODE" = "$RECOVERY_EXPECTED_INODE" ]; then
    rm -f -- "$RECOVERY_FINAL" 2>/dev/null || true
  fi
}`

const RECOVERY_RUNTIME_SHELL = `PROC_ROOT="/proc"
RUN_LOCK_HELD=no
RUN_LOCK_OWNED=no
RUN_OWNER_OWNED=no
RUN_LOCK_INODE=""
RUN_OWNER_INODE=""
path_inode () {
  stat -c %d:%i -- "$1" 2>/dev/null
}
process_state_is_live () {
  PROCESS_PID="$1"
  case "$PROCESS_PID" in ""|*[!0-9]*) return 1 ;; esac
  if [ -r "$PROC_ROOT/$PROCESS_PID/stat" ]; then
    PROCESS_STAT="$(cat -- "$PROC_ROOT/$PROCESS_PID/stat" 2>/dev/null)" || return 1
    PROCESS_FIELDS="\${PROCESS_STAT##*) }"
    set -- $PROCESS_FIELDS
    [ "$#" -ge 1 ] || return 1
    case "$1" in Z|X) return 1 ;; esac
    return 0
  fi
  if [ -r "$PROC_ROOT/sys/kernel/random/boot_id" ]; then
    return 1
  fi
  if command -v ps >/dev/null 2>&1; then
    PROCESS_STATE="$(ps -o stat= -p "$PROCESS_PID" 2>/dev/null)" || PROCESS_STATE=""
    set -- $PROCESS_STATE
    if [ "$#" -ge 1 ]; then
      case "$1" in Z*|X*) return 1 ;; esac
    fi
  fi
  return 0
}
process_start_identity () {
  PROCESS_PID="$1"
  case "$PROCESS_PID" in ""|*[!0-9]*) return 1 ;; esac
  if [ -r "$PROC_ROOT/$PROCESS_PID/stat" ]; then
    PROCESS_STAT="$(cat -- "$PROC_ROOT/$PROCESS_PID/stat" 2>/dev/null)" || PROCESS_STAT=""
    if [ -n "$PROCESS_STAT" ]; then
      PROCESS_FIELDS="\${PROCESS_STAT##*) }"
      set -- $PROCESS_FIELDS
      if [ "$#" -ge 20 ]; then
        shift 19
        PROCESS_BOOT_ID="$(cat -- "$PROC_ROOT/sys/kernel/random/boot_id" 2>/dev/null)" || PROCESS_BOOT_ID=""
        if [ -n "$PROCESS_BOOT_ID" ]; then
          printf 'proc:%s:%s\\n' "$PROCESS_BOOT_ID" "$1"
          return 0
        fi
      fi
    fi
  fi
  command -v ps >/dev/null 2>&1 || return 1
  PROCESS_START="$(ps -o lstart= -p "$PROCESS_PID" 2>/dev/null)" || return 1
  [ -n "$PROCESS_START" ] || return 1
  printf 'ps:%s\\n' "$PROCESS_START"
}
read_running_owner () {
  OWNER_PID=""
  OWNER_START=""
  [ -f "$RUN_OWNER_FILE" ] && [ ! -L "$RUN_OWNER_FILE" ] || return 1
  {
    IFS= read -r OWNER_PID || return 1
    IFS= read -r OWNER_START || return 1
  } < "$RUN_OWNER_FILE"
}
running_owner_is_live () {
  read_running_owner || return 1
  process_state_is_live "$OWNER_PID" || return 1
  kill -0 "$OWNER_PID" 2>/dev/null || return 1
  OWNER_CURRENT_START="$(process_start_identity "$OWNER_PID")" || return 1
  [ "$OWNER_CURRENT_START" = "$OWNER_START" ]
}
remove_owned_path () {
  OWNED_PATH="$1"
  OWNED_INODE="$2"
  OWNED_FLAG="$3"
  [ "$OWNED_FLAG" = "yes" ] && [ -n "$OWNED_INODE" ] || return 0
  [ -e "$OWNED_PATH" ] && [ ! -L "$OWNED_PATH" ] || return 0
  OWNED_CURRENT_INODE="$(path_inode "$OWNED_PATH")" || return 0
  if [ "$OWNED_CURRENT_INODE" = "$OWNED_INODE" ]; then
    rm -f -- "$OWNED_PATH" 2>/dev/null || true
  fi
}
release_running_lock () {
  remove_owned_path "$RUN_OWNER_FILE" "$RUN_OWNER_INODE" "$RUN_OWNER_OWNED"
  RUN_OWNER_OWNED=no
  if [ "$RUN_LOCK_HELD" = "yes" ]; then
    if [ "$PRESERVE_RUN_LOCK" != "yes" ]; then
      remove_owned_path "$RUN_LOCK_FILE" "$RUN_LOCK_INODE" "$RUN_LOCK_OWNED"
    fi
    RUN_LOCK_OWNED=no
    flock -u 9 >/dev/null 2>&1 || true
    RUN_LOCK_HELD=no
  fi
}
acquire_running_lock () {
  [ ! -L "$RUN_LOCK_FILE" ] || { echo "$RECOVERY_LABEL \u8fd0\u884c\u9501\u4e0d\u80fd\u662f\u7b26\u53f7\u94fe\u63a5"; return 1; }
  exec 9>> "$RUN_LOCK_FILE" || { echo "\u65e0\u6cd5\u6253\u5f00 $RECOVERY_LABEL \u8fd0\u884c\u9501"; return 1; }
  if ! flock -n 9; then
    if running_owner_is_live; then
      echo "\u53e6\u4e00\u4e2a $RECOVERY_LABEL \u64cd\u4f5c\u4ecd\u5728\u8fd0\u884c"
    else
      echo "$RECOVERY_LABEL \u8fd0\u884c\u9501\u5df2\u88ab\u5360\u7528"
    fi
    return 1
  fi
  RUN_LOCK_HELD=yes
  RUN_LOCK_PATH_INODE="$(path_inode "$RUN_LOCK_FILE")" || { echo "\u65e0\u6cd5\u8bc6\u522b $RECOVERY_LABEL \u8fd0\u884c\u9501"; return 1; }
  RUN_LOCK_FD_INODE="$RUN_LOCK_PATH_INODE"
  if [ -e "$PROC_ROOT/$$/fd/9" ]; then
    RUN_LOCK_FD_INODE="$(stat -Lc %d:%i -- "$PROC_ROOT/$$/fd/9" 2>/dev/null)" ||
      { echo "\u65e0\u6cd5\u9a8c\u8bc1 $RECOVERY_LABEL \u8fd0\u884c\u9501"; return 1; }
  fi
  [ "$RUN_LOCK_PATH_INODE" = "$RUN_LOCK_FD_INODE" ] ||
    { echo "$RECOVERY_LABEL \u8fd0\u884c\u9501\u5728\u83b7\u53d6\u671f\u95f4\u88ab\u66ff\u6362"; return 1; }
  RUN_LOCK_INODE="$RUN_LOCK_FD_INODE"
  RUN_LOCK_OWNED=yes
  if [ "$REQUIRE_SECURE_STORAGE" = "yes" ]; then
    RECOVERY_UID="$(id -u 2>/dev/null)" ||
      { echo "\u65e0\u6cd5\u786e\u8ba4 $RECOVERY_LABEL \u6267\u884c\u7528\u6237"; return 1; }
    RUN_LOCK_OWNER="$(stat -c %u -- "$RUN_LOCK_FILE" 2>/dev/null)" ||
      { echo "\u65e0\u6cd5\u786e\u8ba4 $RECOVERY_LABEL \u8fd0\u884c\u9501\u6240\u6709\u8005"; return 1; }
    RUN_LOCK_MODE="$(stat -c %a -- "$RUN_LOCK_FILE" 2>/dev/null)" ||
      { echo "\u65e0\u6cd5\u786e\u8ba4 $RECOVERY_LABEL \u8fd0\u884c\u9501\u6743\u9650"; return 1; }
    [ "$RUN_LOCK_OWNER" = "$RECOVERY_UID" ] && [ "$RUN_LOCK_MODE" = "600" ] ||
      { echo "$RECOVERY_LABEL \u8fd0\u884c\u9501\u6240\u6709\u8005\u6216\u6743\u9650\u4e0d\u5b89\u5168"; return 1; }
    for RECOVERY_DIRECTORY in "\${RUN_LOCK_FILE%/*}" "\${STATE_FILE%/*}"; do
      [ -d "$RECOVERY_DIRECTORY" ] && [ ! -L "$RECOVERY_DIRECTORY" ] ||
        { echo "$RECOVERY_LABEL \u6062\u590d\u76ee\u5f55\u4e0d\u5b89\u5168"; return 1; }
      RECOVERY_DIRECTORY_OWNER="$(stat -c %u -- "$RECOVERY_DIRECTORY" 2>/dev/null)" ||
        { echo "\u65e0\u6cd5\u786e\u8ba4 $RECOVERY_LABEL \u6062\u590d\u76ee\u5f55\u6240\u6709\u8005"; return 1; }
      RECOVERY_DIRECTORY_MODE="$(stat -c %a -- "$RECOVERY_DIRECTORY" 2>/dev/null)" ||
        { echo "\u65e0\u6cd5\u786e\u8ba4 $RECOVERY_LABEL \u6062\u590d\u76ee\u5f55\u6743\u9650"; return 1; }
      [ "$RECOVERY_DIRECTORY_OWNER" = "$RECOVERY_UID" ] &&
        [ "$RECOVERY_DIRECTORY_MODE" = "700" ] ||
        { echo "$RECOVERY_LABEL \u6062\u590d\u76ee\u5f55\u6240\u6709\u8005\u6216\u6743\u9650\u4e0d\u5b89\u5168"; return 1; }
    done
  fi
}
claim_running_owner () {
  if [ -e "$RUN_OWNER_FILE" ] || [ -L "$RUN_OWNER_FILE" ]; then
    [ ! -L "$RUN_OWNER_FILE" ] || { echo "$RECOVERY_LABEL \u8fd0\u884c\u6807\u8bb0\u4e0d\u80fd\u662f\u7b26\u53f7\u94fe\u63a5"; return 1; }
    if running_owner_is_live; then
      echo "\u8fd0\u884c\u6807\u8bb0\u5c5e\u4e8e\u4ecd\u5b58\u6d3b\u7684\u8fdb\u7a0b\uff0c\u62d2\u7edd\u63a5\u7ba1"
      return 1
    fi
    STALE_OWNER_INODE="$(path_inode "$RUN_OWNER_FILE")" || { echo "\u65e0\u6cd5\u8bc6\u522b stale \u8fd0\u884c\u6807\u8bb0"; return 1; }
    remove_owned_path "$RUN_OWNER_FILE" "$STALE_OWNER_INODE" yes
    [ ! -e "$RUN_OWNER_FILE" ] && [ ! -L "$RUN_OWNER_FILE" ] ||
      { echo "\u65e0\u6cd5\u56de\u6536 stale \u8fd0\u884c\u6807\u8bb0"; return 1; }
  fi
  SELF_START="$(process_start_identity "$$")" || { echo "\u65e0\u6cd5\u8bc6\u522b\u5f53\u524d $RECOVERY_LABEL \u8fdb\u7a0b"; return 1; }
  if ! (set -C; printf '%s\\n%s\\n' "$$" "$SELF_START" > "$RUN_OWNER_FILE") 2>/dev/null; then
    echo "\u65e0\u6cd5\u539f\u5b50\u521b\u5efa $RECOVERY_LABEL \u8fd0\u884c\u6807\u8bb0"
    return 1
  fi
  RUN_OWNER_INODE="$(path_inode "$RUN_OWNER_FILE")" || {
    rm -f -- "$RUN_OWNER_FILE" 2>/dev/null || true
    echo "\u65e0\u6cd5\u8bc6\u522b $RECOVERY_LABEL \u8fd0\u884c\u6807\u8bb0"
    return 1
  }
  RUN_OWNER_OWNED=yes
}
create_consumed_marker () {
  if ! mkdir -- "$CONSUMED_MARKER" 2>/dev/null; then
    echo "\u65e0\u6cd5\u521b\u5efa $RECOVERY_LABEL \u56de\u6eda\u6d88\u8d39\u6807\u8bb0"
    return 1
  fi
}`

function buildRecoveryRuntimeShell (label, {
  preserveLock = false,
  secureStorage = false
} = {}) {
  return `RECOVERY_LABEL="${label}"
PRESERVE_RUN_LOCK="${preserveLock ? 'yes' : 'no'}"
REQUIRE_SECURE_STORAGE="${secureStorage ? 'yes' : 'no'}"
${RECOVERY_RUNTIME_SHELL}`
}

const HOSTNAME_CHANGE_COMMAND = `set -u
NEW_HOSTNAME="{{\u65b0\u4e3b\u673a\u540d}}"
SYNC_HOSTS="{{\u540c\u6b65Hosts}}"
APPLY_CHANGE="{{\u786e\u8ba4\u6267\u884c}}"
ROLLBACK_DIR="/tmp/shellpilot-rollback"
ROLLBACK_SCRIPT="{{\u56de\u6eda\u811a\u672c}}"
case "$ROLLBACK_SCRIPT" in
  *.sh) VERIFY_SCRIPT="\${ROLLBACK_SCRIPT%.sh}.verify.sh" ;;
  *) echo "\u56de\u6eda\u811a\u672c\u5fc5\u987b\u4ee5 .sh \u7ed3\u5c3e"; exit 1 ;;
esac
CONSUMED_MARKER="$ROLLBACK_SCRIPT.consumed"
RUN_OWNER_FILE="$ROLLBACK_SCRIPT.running"
RUN_LOCK_FILE="$ROLLBACK_SCRIPT.running.lock"
HOSTS_FILE="/etc/hosts"

OLD_HOSTNAME="$(hostnamectl --static 2>/dev/null)" || { echo "\u65e0\u6cd5\u8bfb\u53d6\u5f53\u524d\u4e3b\u673a\u540d"; exit 1; }
[ -n "$OLD_HOSTNAME" ] || { echo "\u5f53\u524d\u4e3b\u673a\u540d\u4e3a\u7a7a\uff0c\u62d2\u7edd\u4fee\u6539"; exit 1; }
OLD_HOSTS_MODE="$(stat -c %a -- "$HOSTS_FILE" 2>/dev/null)" || { echo "\u65e0\u6cd5\u8bfb\u53d6 hosts \u6743\u9650"; exit 1; }
OLD_HOSTS_UID="$(stat -c %u -- "$HOSTS_FILE" 2>/dev/null)" || { echo "\u65e0\u6cd5\u8bfb\u53d6 hosts \u6240\u6709\u8005"; exit 1; }
OLD_HOSTS_GID="$(stat -c %g -- "$HOSTS_FILE" 2>/dev/null)" || { echo "\u65e0\u6cd5\u8bfb\u53d6 hosts \u6240\u5c5e\u7ec4"; exit 1; }
printf '\u5f53\u524d\u4e3b\u673a\u540d: %s\\n' "$OLD_HOSTNAME"
printf '\u5f53\u524d hosts \u5185\u5bb9\uff08\u524d 80 \u884c\uff09:\\n'
awk 'NR <= 80 { print }' "$HOSTS_FILE" || { echo "\u65e0\u6cd5\u8bfb\u53d6 hosts"; exit 1; }

if ! awk -v host="$NEW_HOSTNAME" 'BEGIN {
  if (length(host) < 1 || length(host) > 253) exit 1
  count = split(host, labels, ".")
  for (labelIndex = 1; labelIndex <= count; labelIndex++) {
    label = labels[labelIndex]
    if (length(label) < 1 || length(label) > 63 ||
        label !~ /^[A-Za-z0-9-]+$/ || label ~ /^-/ || label ~ /-$/) exit 1
  }
}' </dev/null; then echo "\u65b0\u4e3b\u673a\u540d\u683c\u5f0f\u4e0d\u6b63\u786e"; exit 1; fi
case "$SYNC_HOSTS" in yes|no) ;; *) echo "\u540c\u6b65 Hosts \u9009\u9879\u65e0\u6548"; exit 1 ;; esac
for TOOL in hostnamectl awk cmp df stat mktemp chmod chown ln rm mkdir rmdir cat install cp dirname basename id; do
  command -v "$TOOL" >/dev/null 2>&1 || { echo "\u7f3a\u5c11\u5fc5\u8981\u5de5\u5177: $TOOL"; exit 1; }
done
FREE_KB="$(df -Pk /tmp 2>/dev/null | awk 'NR == 2 { print $4 }')"
case "$FREE_KB" in ""|*[!0-9]*) echo "\u65e0\u6cd5\u786e\u8ba4 /tmp \u53ef\u7528\u7a7a\u95f4"; exit 1 ;; esac
[ "$FREE_KB" -ge 10240 ] || { echo "/tmp \u53ef\u7528\u7a7a\u95f4\u4e0d\u8db3"; exit 1; }
CURRENT_UID="$(id -u 2>/dev/null)" || { echo "\u65e0\u6cd5\u8bfb\u53d6\u5f53\u524d\u7528\u6237"; exit 1; }
RUN_AS=""
if [ "$CURRENT_UID" != "0" ]; then
  command -v sudo >/dev/null 2>&1 || { echo "\u5f53\u524d\u4e0d\u662f root \u4e14\u6ca1\u6709 sudo"; exit 1; }
  RUN_AS="sudo"
fi
case "$ROLLBACK_SCRIPT" in "$ROLLBACK_DIR"/*) ;; *) echo "\u56de\u6eda\u811a\u672c\u8def\u5f84\u5fc5\u987b\u4f4d\u4e8e\u53d7\u63a7\u76ee\u5f55"; exit 1 ;; esac
[ "$(dirname -- "$ROLLBACK_SCRIPT")" = "$ROLLBACK_DIR" ] || { echo "\u56de\u6eda\u811a\u672c\u8def\u5f84\u5fc5\u987b\u4f4d\u4e8e\u53d7\u63a7\u76ee\u5f55"; exit 1; }
ROLLBACK_NAME="$(basename -- "$ROLLBACK_SCRIPT")"
case "$ROLLBACK_NAME" in ""|*..*|*[!A-Za-z0-9._-]*) echo "\u56de\u6eda\u811a\u672c\u6587\u4ef6\u540d\u4e0d\u5b89\u5168"; exit 1 ;; esac
[ "\${#ROLLBACK_NAME}" -le ${rollbackScriptFilenameMaxLength} ] ||
  { echo "\u56de\u6eda\u811a\u672c\u6587\u4ef6\u540d\u8fc7\u957f\uff0c\u65e0\u6cd5\u5b89\u5168\u521b\u5efa\u6062\u590d\u8d44\u4ea7"; exit 1; }
[ ! -L "$ROLLBACK_DIR" ] || { echo "\u56de\u6eda\u76ee\u5f55\u4e0d\u80fd\u662f\u7b26\u53f7\u94fe\u63a5"; exit 1; }
if [ -L "$ROLLBACK_SCRIPT" ]; then echo "\u56de\u6eda\u811a\u672c\u4e0d\u80fd\u662f\u7b26\u53f7\u94fe\u63a5"; exit 1; fi
[ ! -e "$ROLLBACK_SCRIPT" ] || { echo "\u56de\u6eda\u811a\u672c\u8def\u5f84\u5df2\u5b58\u5728\uff0c\u62d2\u7edd\u8986\u76d6"; exit 1; }
if [ -L "$VERIFY_SCRIPT" ]; then echo "\u56de\u6eda\u9a8c\u8bc1\u811a\u672c\u4e0d\u80fd\u662f\u7b26\u53f7\u94fe\u63a5"; exit 1; fi
[ ! -e "$VERIFY_SCRIPT" ] || { echo "\u56de\u6eda\u9a8c\u8bc1\u811a\u672c\u8def\u5f84\u5df2\u5b58\u5728\uff0c\u62d2\u7edd\u8986\u76d6"; exit 1; }
for RECOVERY_MARKER in "$CONSUMED_MARKER" "$RUN_OWNER_FILE" "$RUN_LOCK_FILE"; do
  if [ -e "$RECOVERY_MARKER" ] || [ -L "$RECOVERY_MARKER" ]; then
    echo "\u4e3b\u673a\u540d\u6062\u590d\u6807\u8bb0\u5df2\u5b58\u5728\uff0c\u62d2\u7edd\u4fee\u6539"; exit 1
  fi
done
if [ "$SYNC_HOSTS" = "yes" ] && [ -L "$HOSTS_FILE" ]; then echo "hosts \u4e0d\u80fd\u662f\u7b26\u53f7\u94fe\u63a5"; exit 1; fi

printf '\u5c06\u4fee\u6539\u4e3b\u673a\u540d\u4e3a: %s\uff1b\u540c\u6b65 hosts: %s\\n' "$NEW_HOSTNAME" "$SYNC_HOSTS"
printf '\u8ba1\u5212\u56de\u6eda\u811a\u672c: %s\\n' "$ROLLBACK_SCRIPT"
if [ "$APPLY_CHANGE" != "yes" ]; then
  echo "\u5f53\u524d\u4e3a\u9884\u6f14\u6a21\u5f0f\uff0c\u672a\u521b\u5efa\u6587\u4ef6\uff0c\u4e5f\u672a\u6267\u884c\u4efb\u4f55\u4fee\u6539\u3002"
  exit 0
fi
printf '\u8ba1\u5212\u56de\u6eda\u9a8c\u8bc1\u811a\u672c: %s\\n' "$VERIFY_SCRIPT"
for RECOVERY_TOOL in flock kill sh; do
  command -v "$RECOVERY_TOOL" >/dev/null 2>&1 || { echo "\u7f3a\u5c11\u6062\u590d\u5fc5\u8981\u5de5\u5177: $RECOVERY_TOOL"; exit 1; }
done

if [ "$CURRENT_UID" != "0" ]; then
  sudo -v || { echo "sudo \u6388\u6743\u5931\u8d25\uff0c\u672a\u6267\u884c\u4fee\u6539"; exit 1; }
fi
umask 077
case "$OPERATION_ROLLBACK_DIR" in "$ROLLBACK_DIR"/operation.*) ;; *) echo "\u64cd\u4f5c\u56de\u6eda\u76ee\u5f55\u4e0d\u53d7\u63a7"; exit 1 ;; esac
[ -d "$OPERATION_ROLLBACK_DIR" ] && [ ! -L "$OPERATION_ROLLBACK_DIR" ] || { echo "\u64cd\u4f5c\u56de\u6eda\u76ee\u5f55\u4e0d\u5b89\u5168"; exit 1; }
STATE_FILE="$OPERATION_ROLLBACK_DIR/hostname.state"
HOSTS_BACKUP="$OPERATION_ROLLBACK_DIR/target-1"
if ! printf '%s\\n%s\\n%s\\n%s\\n%s\\n' "$OLD_HOSTNAME" "$SYNC_HOSTS" "$OLD_HOSTS_MODE" "$OLD_HOSTS_UID" "$OLD_HOSTS_GID" > "$STATE_FILE"; then
  echo "\u65e0\u6cd5\u521b\u5efa\u4e3b\u673a\u540d\u72b6\u6001\u5907\u4efd"; exit 1
fi
chmod 600 "$STATE_FILE" || { echo "\u65e0\u6cd5\u4fdd\u62a4\u4e3b\u673a\u540d\u72b6\u6001\u5907\u4efd"; exit 1; }
[ -s "$STATE_FILE" ] || { echo "\u4e3b\u673a\u540d\u72b6\u6001\u5907\u4efd\u4e3a\u7a7a"; exit 1; }
if [ "$SYNC_HOSTS" = "yes" ]; then
  [ -e "$HOSTS_BACKUP" ] && [ ! -L "$HOSTS_BACKUP" ] || { echo "hosts \u5907\u4efd\u4e0d\u53ef\u7528"; exit 1; }
fi
TMP_ROLLBACK=""
TMP_VERIFIER=""
TMP_ROLLBACK_INODE=""
TMP_VERIFIER_INODE=""
ROLLBACK_LINK_ATTEMPTED=no
VERIFIER_LINK_ATTEMPTED=no
RECOVERY_ASSETS_READY=no
${RECOVERY_ASSET_CLEANUP_SHELL}
cleanup_recovery_assets () {
  if [ "$RECOVERY_ASSETS_READY" != "yes" ]; then
    cleanup_owned_recovery_asset "$ROLLBACK_SCRIPT" "$TMP_ROLLBACK_INODE" "$ROLLBACK_LINK_ATTEMPTED"
    cleanup_owned_recovery_asset "$VERIFY_SCRIPT" "$TMP_VERIFIER_INODE" "$VERIFIER_LINK_ATTEMPTED"
    for RECOVERY_ASSET in "$TMP_ROLLBACK" "$TMP_VERIFIER"; do
      [ -z "$RECOVERY_ASSET" ] || rm -f -- "$RECOVERY_ASSET" 2>/dev/null || true
    done
  fi
}
trap cleanup_recovery_assets EXIT
trap 'exit 1' HUP INT TERM
TMP_ROLLBACK="$(mktemp "$OPERATION_ROLLBACK_DIR/hostname-rollback.XXXXXX")" || { echo "\u65e0\u6cd5\u521b\u5efa\u56de\u6eda\u811a\u672c\u4e34\u65f6\u6587\u4ef6"; exit 1; }
TMP_VERIFIER="$(mktemp "$OPERATION_ROLLBACK_DIR/hostname-verify.XXXXXX")" || { echo "\u65e0\u6cd5\u521b\u5efa\u56de\u6eda\u9a8c\u8bc1\u811a\u672c\u4e34\u65f6\u6587\u4ef6"; exit 1; }
if ! {
  printf '%s\\n' '#!/bin/sh' 'set -efu'
  printf "STATE_FILE='%s'\\n" "$STATE_FILE"
  printf "HOSTS_BACKUP='%s'\\n" "$HOSTS_BACKUP"
  printf "RUN_AS='%s'\\n" "$RUN_AS"
  printf "VERIFY_SCRIPT='%s'\\n" "$VERIFY_SCRIPT"
  printf "CONSUMED_MARKER='%s'\\n" "$CONSUMED_MARKER"
  printf "RUN_OWNER_FILE='%s'\\n" "$RUN_OWNER_FILE"
  printf "RUN_LOCK_FILE='%s'\\n" "$RUN_LOCK_FILE"
  cat <<'SHELLPILOT_HOSTNAME_ROLLBACK'
HOSTS_FILE="/etc/hosts"
umask 077
${buildRecoveryRuntimeShell('\u4e3b\u673a\u540d\u6062\u590d')}
trap release_running_lock EXIT
trap 'release_running_lock; exit 1' HUP INT TERM
for ROLLBACK_TOOL in flock stat cat hostnamectl sh rm mkdir kill; do
  command -v "$ROLLBACK_TOOL" >/dev/null 2>&1 ||
    { echo "\u7f3a\u5c11\u4e3b\u673a\u540d\u6062\u590d\u5de5\u5177: $ROLLBACK_TOOL"; exit 1; }
done
acquire_running_lock || exit 1
claim_running_owner || exit 1
if [ -e "$CONSUMED_MARKER" ] || [ -L "$CONSUMED_MARKER" ]; then
  echo "\u56de\u6eda\u811a\u672c\u5df2\u88ab\u6d88\u8d39"; exit 1
fi
[ -r "$STATE_FILE" ] || { echo "\u4e3b\u673a\u540d\u56de\u6eda\u72b6\u6001\u4e0d\u5b58\u5728"; exit 1; }
{
  IFS= read -r OLD_HOSTNAME
  IFS= read -r SYNC_HOSTS
  IFS= read -r OLD_HOSTS_MODE
  IFS= read -r OLD_HOSTS_UID
  IFS= read -r OLD_HOSTS_GID
} < "$STATE_FILE"
command -v hostnamectl >/dev/null 2>&1 || { echo "\u7f3a\u5c11 hostnamectl\uff0c\u65e0\u6cd5\u56de\u6eda"; exit 1; }
$RUN_AS hostnamectl set-hostname "$OLD_HOSTNAME"
if [ "$SYNC_HOSTS" = "yes" ]; then
  [ -f "$HOSTS_BACKUP" ] && [ ! -L "$HOSTS_BACKUP" ] || { echo "hosts \u56de\u6eda\u5907\u4efd\u4e0d\u53ef\u7528"; exit 1; }
  [ ! -L "$HOSTS_FILE" ] || { echo "hosts \u5df2\u53d8\u6210\u7b26\u53f7\u94fe\u63a5\uff0c\u62d2\u7edd\u56de\u6eda"; exit 1; }
  command -v cp >/dev/null 2>&1 && command -v chmod >/dev/null 2>&1 && command -v chown >/dev/null 2>&1 ||
    { echo "\u7f3a\u5c11 hosts \u6062\u590d\u5de5\u5177"; exit 1; }
  $RUN_AS cp -- "$HOSTS_BACKUP" "$HOSTS_FILE"
  $RUN_AS chown "$OLD_HOSTS_UID:$OLD_HOSTS_GID" -- "$HOSTS_FILE"
  $RUN_AS chmod "$OLD_HOSTS_MODE" -- "$HOSTS_FILE"
fi
[ -f "$VERIFY_SCRIPT" ] && [ ! -L "$VERIFY_SCRIPT" ] ||
  { echo "\u4e3b\u673a\u540d\u56de\u6eda\u9a8c\u8bc1\u811a\u672c\u4e0d\u53ef\u7528"; exit 1; }
sh -- "$VERIFY_SCRIPT"
create_consumed_marker || exit 1
release_running_lock
trap - EXIT HUP INT TERM
printf '\u5df2\u6062\u590d\u539f\u4e3b\u673a\u540d: %s\\n' "$OLD_HOSTNAME"
SHELLPILOT_HOSTNAME_ROLLBACK
} > "$TMP_ROLLBACK"; then
  echo "\u65e0\u6cd5\u5199\u5165\u56de\u6eda\u811a\u672c"; exit 1
fi
if ! {
  printf '%s\\n' '#!/bin/sh' 'set -eu'
  printf "STATE_FILE='%s'\\n" "$STATE_FILE"
  printf "HOSTS_BACKUP='%s'\\n" "$HOSTS_BACKUP"
  cat <<'SHELLPILOT_HOSTNAME_VERIFY'
HOSTS_FILE="/etc/hosts"
[ -r "$STATE_FILE" ] || { echo "\u4e3b\u673a\u540d\u56de\u6eda\u72b6\u6001\u4e0d\u5b58\u5728"; exit 1; }
{
  IFS= read -r OLD_HOSTNAME
  IFS= read -r SYNC_HOSTS
  IFS= read -r OLD_HOSTS_MODE
  IFS= read -r OLD_HOSTS_UID
  IFS= read -r OLD_HOSTS_GID
} < "$STATE_FILE"
command -v hostnamectl >/dev/null 2>&1 && command -v awk >/dev/null 2>&1 ||
  { echo "\u7f3a\u5c11\u4e3b\u673a\u540d\u9a8c\u8bc1\u5de5\u5177"; exit 1; }
CURRENT_HOSTNAME="$(hostnamectl --static 2>/dev/null)" || { echo "\u65e0\u6cd5\u8bfb\u53d6\u5f53\u524d\u4e3b\u673a\u540d"; exit 1; }
if ! awk -v actual="$CURRENT_HOSTNAME" -v expected="$OLD_HOSTNAME" 'BEGIN {
  exit tolower(actual) != tolower(expected)
}' </dev/null; then
  echo "\u539f\u4e3b\u673a\u540d\u6062\u590d\u9a8c\u8bc1\u5931\u8d25"; exit 1
fi
if [ "$SYNC_HOSTS" = "yes" ]; then
  [ -f "$HOSTS_BACKUP" ] && [ ! -L "$HOSTS_BACKUP" ] || { echo "hosts \u56de\u6eda\u5907\u4efd\u4e0d\u53ef\u7528"; exit 1; }
  [ -f "$HOSTS_FILE" ] && [ ! -L "$HOSTS_FILE" ] || { echo "hosts \u6587\u4ef6\u4e0d\u53ef\u7528"; exit 1; }
  command -v cmp >/dev/null 2>&1 && command -v stat >/dev/null 2>&1 ||
    { echo "\u7f3a\u5c11 hosts \u9a8c\u8bc1\u5de5\u5177"; exit 1; }
  cmp -s -- "$HOSTS_BACKUP" "$HOSTS_FILE" || { echo "hosts \u5185\u5bb9\u6062\u590d\u9a8c\u8bc1\u5931\u8d25"; exit 1; }
  [ "$(stat -c %a -- "$HOSTS_FILE")" = "$OLD_HOSTS_MODE" ] &&
    [ "$(stat -c %u -- "$HOSTS_FILE")" = "$OLD_HOSTS_UID" ] &&
    [ "$(stat -c %g -- "$HOSTS_FILE")" = "$OLD_HOSTS_GID" ] ||
    { echo "hosts \u6743\u9650\u6216\u5c5e\u4e3b\u6062\u590d\u9a8c\u8bc1\u5931\u8d25"; exit 1; }
fi
printf '\u4e3b\u673a\u540d\u56de\u6eda\u72b6\u6001\u9a8c\u8bc1\u6210\u529f: %s\\n' "$OLD_HOSTNAME"
SHELLPILOT_HOSTNAME_VERIFY
} > "$TMP_VERIFIER"; then
  echo "\u65e0\u6cd5\u5199\u5165\u56de\u6eda\u9a8c\u8bc1\u811a\u672c"; exit 1
fi
chmod 700 "$TMP_ROLLBACK" "$TMP_VERIFIER" || { echo "\u65e0\u6cd5\u8bbe\u7f6e\u56de\u6eda\u8d44\u4ea7\u6743\u9650"; exit 1; }
TMP_ROLLBACK_INODE="$(stat -c %d:%i -- "$TMP_ROLLBACK" 2>/dev/null)" ||
  { echo "\u65e0\u6cd5\u8bc6\u522b\u56de\u6eda\u811a\u672c\u4e34\u65f6\u6587\u4ef6"; exit 1; }
TMP_VERIFIER_INODE="$(stat -c %d:%i -- "$TMP_VERIFIER" 2>/dev/null)" ||
  { echo "\u65e0\u6cd5\u8bc6\u522b\u56de\u6eda\u9a8c\u8bc1\u4e34\u65f6\u6587\u4ef6"; exit 1; }
ROLLBACK_LINK_ATTEMPTED=yes
if ln -- "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"; then
  :
else
  echo "\u65e0\u6cd5\u539f\u5b50\u521b\u5efa\u56de\u6eda\u811a\u672c"; exit 1
fi
VERIFIER_LINK_ATTEMPTED=yes
if ln -- "$TMP_VERIFIER" "$VERIFY_SCRIPT"; then
  :
else
  echo "\u65e0\u6cd5\u539f\u5b50\u521b\u5efa\u56de\u6eda\u9a8c\u8bc1\u811a\u672c"; exit 1
fi
rm -f -- "$TMP_ROLLBACK" "$TMP_VERIFIER" || { echo "\u65e0\u6cd5\u6e05\u7406\u56de\u6eda\u8d44\u4ea7\u4e34\u65f6\u6587\u4ef6"; exit 1; }
[ -f "$ROLLBACK_SCRIPT" ] && [ ! -L "$ROLLBACK_SCRIPT" ] &&
  [ -f "$VERIFY_SCRIPT" ] && [ ! -L "$VERIFY_SCRIPT" ] ||
  { echo "\u56de\u6eda\u8d44\u4ea7\u521b\u5efa\u9a8c\u8bc1\u5931\u8d25"; exit 1; }
[ "$(stat -c %a -- "$ROLLBACK_SCRIPT")" = "700" ] &&
  [ "$(stat -c %a -- "$VERIFY_SCRIPT")" = "700" ] ||
  { echo "\u56de\u6eda\u8d44\u4ea7\u6743\u9650\u9a8c\u8bc1\u5931\u8d25"; exit 1; }
[ "$(stat -c %d:%i -- "$ROLLBACK_SCRIPT")" = "$TMP_ROLLBACK_INODE" ] &&
  [ "$(stat -c %d:%i -- "$VERIFY_SCRIPT")" = "$TMP_VERIFIER_INODE" ] ||
  { echo "\u56de\u6eda\u8d44\u4ea7\u5728\u53d1\u5e03\u671f\u95f4\u88ab\u66ff\u6362"; exit 1; }
RECOVERY_ASSETS_READY=yes
trap - EXIT HUP INT TERM

for RECOVERY_MARKER in "$CONSUMED_MARKER" "$RUN_OWNER_FILE" "$RUN_LOCK_FILE"; do
  if [ -e "$RECOVERY_MARKER" ] || [ -L "$RECOVERY_MARKER" ]; then
    echo "\u4e3b\u673a\u540d\u6062\u590d\u6807\u8bb0\u5728\u4fee\u6539\u524d\u51fa\u73b0\uff0c\u62d2\u7edd\u4fee\u6539"; exit 1
  fi
done

printf '\u56de\u6eda\u811a\u672c: %s\\n' "$ROLLBACK_SCRIPT"
printf '\u56de\u6eda\u9a8c\u8bc1\u811a\u672c: %s\\n' "$VERIFY_SCRIPT"
$RUN_AS hostnamectl set-hostname "$NEW_HOSTNAME"
if [ "$SYNC_HOSTS" = "yes" ]; then
  HOSTS_TMP="$(mktemp "$OPERATION_ROLLBACK_DIR/hosts.XXXXXX")" || { echo "\u65e0\u6cd5\u521b\u5efa hosts \u4e34\u65f6\u6587\u4ef6\uff1b\u56de\u6eda: $ROLLBACK_SCRIPT"; exit 1; }
  if ! awk -v oldHost="$OLD_HOSTNAME" -v newHost="$NEW_HOSTNAME" '
    BEGIN { changed = 0 }
    /^[[:space:]]*#/ || NF == 0 { print; next }
    {
      original = $0
      content = original
      comment = ""
      hashIndex = index(original, "#")
      if (hashIndex > 0) {
        content = substr(original, 1, hashIndex - 1)
        match(content, /[[:space:]]*$/)
        comment = substr(content, RSTART, RLENGTH) substr(original, hashIndex)
        content = substr(content, 1, RSTART - 1)
      }
      $0 = content
      if (NF < 2) { print original; next }

      lineChanged = 0
      for (field = 2; field <= NF; field++) {
        if (tolower($field) == tolower(oldHost)) {
          $field = newHost
          changed = 1
          lineChanged = 1
        }
      }
      if (lineChanged) {
        output = $1
        for (field = 2; field <= NF; field++) output = output OFS $field
        print output comment
      } else {
        print original
      }
    }
    END {
      if (!changed) print "127.0.1.1\\t" newHost
    }
  ' "$HOSTS_FILE" > "$HOSTS_TMP"; then
    rm -f -- "$HOSTS_TMP"; echo "\u751f\u6210 hosts \u65b0\u5185\u5bb9\u5931\u8d25\uff1b\u56de\u6eda: $ROLLBACK_SCRIPT"; exit 1
  fi
  $RUN_AS install -o "$OLD_HOSTS_UID" -g "$OLD_HOSTS_GID" -m "$OLD_HOSTS_MODE" -- "$HOSTS_TMP" "$HOSTS_FILE" ||
    { rm -f -- "$HOSTS_TMP"; echo "\u5199\u5165 hosts \u5931\u8d25\uff1b\u56de\u6eda: $ROLLBACK_SCRIPT"; exit 1; }
  rm -f -- "$HOSTS_TMP" || { echo "\u6e05\u7406 hosts \u4e34\u65f6\u6587\u4ef6\u5931\u8d25\uff1b\u56de\u6eda: $ROLLBACK_SCRIPT"; exit 1; }
fi

FINAL_HOSTNAME="$(hostnamectl --static 2>/dev/null)" || FINAL_HOSTNAME=""
if ! printf '%s\n' "$FINAL_HOSTNAME" | awk -v expected="$NEW_HOSTNAME" '{ exit tolower($0) != tolower(expected) }'; then
  echo "\u4fee\u6539\u540e\u4e3b\u673a\u540d\u9a8c\u8bc1\u5931\u8d25\uff1b\u8bf7\u56de\u6eda: $ROLLBACK_SCRIPT"
  exit 1
fi
if [ "$SYNC_HOSTS" = "yes" ] && ! awk -v host="$NEW_HOSTNAME" '
  /^[[:space:]]*#/ { next }
  {
    effective = $0
    hashIndex = index(effective, "#")
    if (hashIndex > 0) effective = substr(effective, 1, hashIndex - 1)
    $0 = effective
    if (NF < 2) next
    for (field = 2; field <= NF; field++) if (tolower($field) == tolower(host)) found = 1
  }
  END { exit !found }
' "$HOSTS_FILE"; then
  echo "\u4fee\u6539\u540e hosts \u9a8c\u8bc1\u5931\u8d25\uff1b\u8bf7\u56de\u6eda: $ROLLBACK_SCRIPT"
  exit 1
fi
printf '\u4e3b\u673a\u540d\u4fee\u6539\u5e76\u9a8c\u8bc1\u6210\u529f\u3002\u56de\u6eda\u811a\u672c: %s\\n' "$ROLLBACK_SCRIPT"`

const TIMEZONE_CHANGE_COMMAND = `set -u
NEW_TIMEZONE="{{\u65b0\u65f6\u533a}}"
APPLY_CHANGE="{{\u786e\u8ba4\u6267\u884c}}"
ROLLBACK_DIR="/tmp/shellpilot-rollback"
ROLLBACK_SCRIPT="{{\u56de\u6eda\u811a\u672c}}"
case "$ROLLBACK_SCRIPT" in
  *.sh) VERIFY_SCRIPT="\${ROLLBACK_SCRIPT%.sh}.verify.sh" ;;
  *) echo "\u56de\u6eda\u811a\u672c\u5fc5\u987b\u4ee5 .sh \u7ed3\u5c3e"; exit 1 ;;
esac
CONSUMED_MARKER="$ROLLBACK_SCRIPT.consumed"
RUN_OWNER_FILE="$ROLLBACK_SCRIPT.running"
RUN_LOCK_FILE="$ROLLBACK_SCRIPT.running.lock"

OLD_TIMEZONE="$(timedatectl show -p Timezone --value 2>/dev/null)" || { echo "\u65e0\u6cd5\u8bfb\u53d6\u5f53\u524d\u65f6\u533a"; exit 1; }
[ -n "$OLD_TIMEZONE" ] || { echo "\u5f53\u524d\u65f6\u533a\u4e3a\u7a7a\uff0c\u62d2\u7edd\u4fee\u6539"; exit 1; }
printf '\u5f53\u524d\u65f6\u533a: %s\\n' "$OLD_TIMEZONE"
case "$NEW_TIMEZONE" in
  ""|.*|*/.|*/..|*//*|*..*|*[!A-Za-z0-9._+/-]*) echo "\u76ee\u6807\u65f6\u533a\u683c\u5f0f\u4e0d\u6b63\u786e"; exit 1 ;;
esac
for TOOL in timedatectl grep df awk stat mktemp chmod ln rm cat dirname basename id; do
  command -v "$TOOL" >/dev/null 2>&1 || { echo "\u7f3a\u5c11\u5fc5\u8981\u5de5\u5177: $TOOL"; exit 1; }
done
if ! timedatectl list-timezones 2>/dev/null | grep -Fqx -- "$NEW_TIMEZONE"; then
  echo "\u76ee\u6807\u65f6\u533a\u4e0d\u5728 timedatectl list-timezones \u4e2d\uff0c\u62d2\u7edd\u731c\u6d4b\u7cfb\u7edf\u6587\u4ef6"
  exit 1
fi
FREE_KB="$(df -Pk /tmp 2>/dev/null | awk 'NR == 2 { print $4 }')"
case "$FREE_KB" in ""|*[!0-9]*) echo "\u65e0\u6cd5\u786e\u8ba4 /tmp \u53ef\u7528\u7a7a\u95f4"; exit 1 ;; esac
[ "$FREE_KB" -ge 10240 ] || { echo "/tmp \u53ef\u7528\u7a7a\u95f4\u4e0d\u8db3"; exit 1; }
CURRENT_UID="$(id -u 2>/dev/null)" || { echo "\u65e0\u6cd5\u8bfb\u53d6\u5f53\u524d\u7528\u6237"; exit 1; }
RUN_AS=""
if [ "$CURRENT_UID" != "0" ]; then
  command -v sudo >/dev/null 2>&1 || { echo "\u5f53\u524d\u4e0d\u662f root \u4e14\u6ca1\u6709 sudo"; exit 1; }
  RUN_AS="sudo"
fi
case "$ROLLBACK_SCRIPT" in "$ROLLBACK_DIR"/*) ;; *) echo "\u56de\u6eda\u811a\u672c\u8def\u5f84\u5fc5\u987b\u4f4d\u4e8e\u53d7\u63a7\u76ee\u5f55"; exit 1 ;; esac
[ "$(dirname -- "$ROLLBACK_SCRIPT")" = "$ROLLBACK_DIR" ] || { echo "\u56de\u6eda\u811a\u672c\u8def\u5f84\u5fc5\u987b\u4f4d\u4e8e\u53d7\u63a7\u76ee\u5f55"; exit 1; }
ROLLBACK_NAME="$(basename -- "$ROLLBACK_SCRIPT")"
case "$ROLLBACK_NAME" in ""|*..*|*[!A-Za-z0-9._-]*) echo "\u56de\u6eda\u811a\u672c\u6587\u4ef6\u540d\u4e0d\u5b89\u5168"; exit 1 ;; esac
[ "\${#ROLLBACK_NAME}" -le ${rollbackScriptFilenameMaxLength} ] ||
  { echo "\u56de\u6eda\u811a\u672c\u6587\u4ef6\u540d\u8fc7\u957f\uff0c\u65e0\u6cd5\u5b89\u5168\u521b\u5efa\u6062\u590d\u8d44\u4ea7"; exit 1; }
[ ! -L "$ROLLBACK_DIR" ] || { echo "\u56de\u6eda\u76ee\u5f55\u4e0d\u80fd\u662f\u7b26\u53f7\u94fe\u63a5"; exit 1; }
if [ -L "$ROLLBACK_SCRIPT" ]; then echo "\u56de\u6eda\u811a\u672c\u4e0d\u80fd\u662f\u7b26\u53f7\u94fe\u63a5"; exit 1; fi
[ ! -e "$ROLLBACK_SCRIPT" ] || { echo "\u56de\u6eda\u811a\u672c\u8def\u5f84\u5df2\u5b58\u5728\uff0c\u62d2\u7edd\u8986\u76d6"; exit 1; }
if [ -L "$VERIFY_SCRIPT" ]; then echo "\u56de\u6eda\u9a8c\u8bc1\u811a\u672c\u4e0d\u80fd\u662f\u7b26\u53f7\u94fe\u63a5"; exit 1; fi
[ ! -e "$VERIFY_SCRIPT" ] || { echo "\u56de\u6eda\u9a8c\u8bc1\u811a\u672c\u8def\u5f84\u5df2\u5b58\u5728\uff0c\u62d2\u7edd\u8986\u76d6"; exit 1; }
for RECOVERY_MARKER in "$CONSUMED_MARKER" "$RUN_OWNER_FILE"; do
  if [ -e "$RECOVERY_MARKER" ] || [ -L "$RECOVERY_MARKER" ]; then
    echo "\u65f6\u533a\u6062\u590d\u6807\u8bb0\u5df2\u5b58\u5728\uff0c\u62d2\u7edd\u4fee\u6539"; exit 1
  fi
done
[ ! -L "$RUN_LOCK_FILE" ] || { echo "\u65f6\u533a\u64cd\u4f5c\u9501\u4e0d\u80fd\u662f\u7b26\u53f7\u94fe\u63a5"; exit 1; }
if [ -e "$RUN_LOCK_FILE" ] && [ ! -f "$RUN_LOCK_FILE" ]; then
  echo "\u65f6\u533a\u64cd\u4f5c\u9501\u7c7b\u578b\u4e0d\u5b89\u5168"; exit 1
fi

printf '\u5c06\u4fee\u6539\u65f6\u533a\u4e3a: %s\\n' "$NEW_TIMEZONE"
printf '\u8ba1\u5212\u56de\u6eda\u811a\u672c: %s\\n' "$ROLLBACK_SCRIPT"
if [ "$APPLY_CHANGE" != "yes" ]; then
  echo "\u5f53\u524d\u4e3a\u9884\u6f14\u6a21\u5f0f\uff0c\u672a\u521b\u5efa\u6587\u4ef6\uff0c\u4e5f\u672a\u6267\u884c\u4efb\u4f55\u4fee\u6539\u3002"
  exit 0
fi
printf '\u8ba1\u5212\u56de\u6eda\u9a8c\u8bc1\u811a\u672c: %s\\n' "$VERIFY_SCRIPT"
for RECOVERY_TOOL in flock kill ps sh mkdir; do
  command -v "$RECOVERY_TOOL" >/dev/null 2>&1 || { echo "\u7f3a\u5c11\u6062\u590d\u5fc5\u8981\u5de5\u5177: $RECOVERY_TOOL"; exit 1; }
done

if [ "$CURRENT_UID" != "0" ]; then
  sudo -v || { echo "sudo \u6388\u6743\u5931\u8d25\uff0c\u672a\u6267\u884c\u4fee\u6539"; exit 1; }
fi
umask 077
case "$OPERATION_ROLLBACK_DIR" in "$ROLLBACK_DIR"/operation.*) ;; *) echo "\u64cd\u4f5c\u56de\u6eda\u76ee\u5f55\u4e0d\u53d7\u63a7"; exit 1 ;; esac
[ -d "$OPERATION_ROLLBACK_DIR" ] && [ ! -L "$OPERATION_ROLLBACK_DIR" ] || { echo "\u64cd\u4f5c\u56de\u6eda\u76ee\u5f55\u4e0d\u5b89\u5168"; exit 1; }
STATE_FILE="$OPERATION_ROLLBACK_DIR/timezone.state"
TMP_STATE=""
TMP_ROLLBACK=""
TMP_VERIFIER=""
TMP_STATE_INODE=""
TMP_ROLLBACK_INODE=""
TMP_VERIFIER_INODE=""
STATE_LINK_ATTEMPTED=no
ROLLBACK_LINK_ATTEMPTED=no
VERIFIER_LINK_ATTEMPTED=no
RECOVERY_ASSETS_READY=no
${buildRecoveryRuntimeShell('\u65f6\u533a\u64cd\u4f5c', { preserveLock: true, secureStorage: true })}
acquire_timezone_setup_lock () {
  acquire_running_lock || exit 1
  for RECOVERY_PATH in "$ROLLBACK_SCRIPT" "$VERIFY_SCRIPT" "$CONSUMED_MARKER"; do
    if [ -e "$RECOVERY_PATH" ] || [ -L "$RECOVERY_PATH" ]; then
      echo "\u65f6\u533a\u6062\u590d\u8d44\u4ea7\u5728\u52a0\u9501\u671f\u95f4\u5df2\u5b58\u5728\uff0c\u62d2\u7edd\u4fee\u6539"; exit 1
    fi
  done
  claim_running_owner || exit 1
}
${RECOVERY_ASSET_CLEANUP_SHELL}
cleanup_recovery_assets () {
  if [ "$RECOVERY_ASSETS_READY" != "yes" ]; then
    cleanup_owned_recovery_asset "$STATE_FILE" "$TMP_STATE_INODE" "$STATE_LINK_ATTEMPTED"
    cleanup_owned_recovery_asset "$ROLLBACK_SCRIPT" "$TMP_ROLLBACK_INODE" "$ROLLBACK_LINK_ATTEMPTED"
    cleanup_owned_recovery_asset "$VERIFY_SCRIPT" "$TMP_VERIFIER_INODE" "$VERIFIER_LINK_ATTEMPTED"
    cleanup_owned_recovery_asset "$TMP_STATE" "$TMP_STATE_INODE" yes
    cleanup_owned_recovery_asset "$TMP_ROLLBACK" "$TMP_ROLLBACK_INODE" yes
    cleanup_owned_recovery_asset "$TMP_VERIFIER" "$TMP_VERIFIER_INODE" yes
  fi
}
cleanup_timezone_setup () {
  cleanup_recovery_assets
  release_running_lock
}
trap cleanup_timezone_setup EXIT
trap 'exit 1' HUP INT TERM
acquire_timezone_setup_lock
TMP_STATE="$(mktemp "$OPERATION_ROLLBACK_DIR/timezone-state.XXXXXX")" || { echo "\u65e0\u6cd5\u521b\u5efa\u65f6\u533a\u72b6\u6001\u4e34\u65f6\u6587\u4ef6"; exit 1; }
TMP_STATE_INODE="$(stat -c %d:%i -- "$TMP_STATE" 2>/dev/null)" ||
  { echo "\u65e0\u6cd5\u8bc6\u522b\u65f6\u533a\u72b6\u6001\u4e34\u65f6\u6587\u4ef6"; exit 1; }
if ! printf '%s\\n' "$OLD_TIMEZONE" > "$TMP_STATE"; then echo "\u65e0\u6cd5\u521b\u5efa\u65f6\u533a\u72b6\u6001\u5907\u4efd"; exit 1; fi
chmod 600 "$TMP_STATE" || { echo "\u65e0\u6cd5\u4fdd\u62a4\u65f6\u533a\u72b6\u6001\u5907\u4efd"; exit 1; }
[ -s "$TMP_STATE" ] || { echo "\u65f6\u533a\u72b6\u6001\u5907\u4efd\u4e3a\u7a7a"; exit 1; }
[ "$(stat -c %d:%i -- "$TMP_STATE" 2>/dev/null)" = "$TMP_STATE_INODE" ] ||
  { echo "\u65f6\u533a\u72b6\u6001\u4e34\u65f6\u6587\u4ef6\u88ab\u66ff\u6362"; exit 1; }
STATE_LINK_ATTEMPTED=yes
if ln -- "$TMP_STATE" "$STATE_FILE"; then
  :
else
  echo "\u65e0\u6cd5\u539f\u5b50\u521b\u5efa\u65f6\u533a\u72b6\u6001\u5907\u4efd"; exit 1
fi
[ -f "$STATE_FILE" ] && [ ! -L "$STATE_FILE" ] &&
  [ "$(stat -c %d:%i -- "$STATE_FILE" 2>/dev/null)" = "$TMP_STATE_INODE" ] &&
  [ "$(stat -c %u -- "$STATE_FILE" 2>/dev/null)" = "$RECOVERY_UID" ] &&
  [ "$(stat -c %a -- "$STATE_FILE" 2>/dev/null)" = "600" ] ||
  { echo "\u65f6\u533a\u72b6\u6001\u5907\u4efd\u5728\u53d1\u5e03\u671f\u95f4\u88ab\u66ff\u6362"; exit 1; }
cleanup_owned_recovery_asset "$TMP_STATE" "$TMP_STATE_INODE" yes
if [ -e "$TMP_STATE" ] || [ -L "$TMP_STATE" ]; then
  echo "\u65e0\u6cd5\u6e05\u7406\u65f6\u533a\u72b6\u6001\u4e34\u65f6\u6587\u4ef6"; exit 1
fi
TMP_ROLLBACK="$(mktemp "$OPERATION_ROLLBACK_DIR/timezone-rollback.XXXXXX")" || { echo "\u65e0\u6cd5\u521b\u5efa\u56de\u6eda\u811a\u672c\u4e34\u65f6\u6587\u4ef6"; exit 1; }
TMP_ROLLBACK_INODE="$(stat -c %d:%i -- "$TMP_ROLLBACK" 2>/dev/null)" ||
  { echo "\u65e0\u6cd5\u8bc6\u522b\u56de\u6eda\u811a\u672c\u4e34\u65f6\u6587\u4ef6"; exit 1; }
TMP_VERIFIER="$(mktemp "$OPERATION_ROLLBACK_DIR/timezone-verify.XXXXXX")" || { echo "\u65e0\u6cd5\u521b\u5efa\u56de\u6eda\u9a8c\u8bc1\u811a\u672c\u4e34\u65f6\u6587\u4ef6"; exit 1; }
TMP_VERIFIER_INODE="$(stat -c %d:%i -- "$TMP_VERIFIER" 2>/dev/null)" ||
  { echo "\u65e0\u6cd5\u8bc6\u522b\u56de\u6eda\u9a8c\u8bc1\u4e34\u65f6\u6587\u4ef6"; exit 1; }
if ! {
  printf '%s\\n' '#!/bin/sh' 'set -efu'
  printf "STATE_FILE='%s'\\n" "$STATE_FILE"
  printf "VERIFY_SCRIPT='%s'\\n" "$VERIFY_SCRIPT"
  printf "CONSUMED_MARKER='%s'\\n" "$CONSUMED_MARKER"
  printf "RUN_OWNER_FILE='%s'\\n" "$RUN_OWNER_FILE"
  printf "RUN_LOCK_FILE='%s'\\n" "$RUN_LOCK_FILE"
  cat <<'SHELLPILOT_TIMEZONE_ROLLBACK'
umask 077
${buildRecoveryRuntimeShell('\u65f6\u533a\u6062\u590d', { preserveLock: true, secureStorage: true })}
trap release_running_lock EXIT
trap 'release_running_lock; exit 1' HUP INT TERM
for ROLLBACK_TOOL in flock stat cat timedatectl sh rm mkdir kill ps id; do
  command -v "$ROLLBACK_TOOL" >/dev/null 2>&1 ||
    { echo "\u7f3a\u5c11\u65f6\u533a\u6062\u590d\u5de5\u5177: $ROLLBACK_TOOL"; exit 1; }
done
acquire_running_lock || exit 1
claim_running_owner || exit 1
[ -f "$STATE_FILE" ] && [ ! -L "$STATE_FILE" ] ||
  { echo "\u65f6\u533a\u56de\u6eda\u72b6\u6001\u4e0d\u5b58\u5728"; exit 1; }
[ "$(stat -c %u -- "$STATE_FILE" 2>/dev/null)" = "$RECOVERY_UID" ] &&
  [ "$(stat -c %a -- "$STATE_FILE" 2>/dev/null)" = "600" ] ||
  { echo "\u65f6\u533a\u56de\u6eda\u72b6\u6001\u6240\u6709\u8005\u6216\u6743\u9650\u4e0d\u5b89\u5168"; exit 1; }
IFS= read -r OLD_TIMEZONE < "$STATE_FILE" && [ -n "$OLD_TIMEZONE" ] ||
  { echo "\u65e0\u6cd5\u8bfb\u53d6\u539f\u65f6\u533a\u56de\u6eda\u72b6\u6001"; exit 1; }
[ -f "$VERIFY_SCRIPT" ] && [ ! -L "$VERIFY_SCRIPT" ] ||
  { echo "\u65f6\u533a\u56de\u6eda\u9a8c\u8bc1\u811a\u672c\u4e0d\u53ef\u7528"; exit 1; }
[ "$(stat -c %u -- "$VERIFY_SCRIPT" 2>/dev/null)" = "$RECOVERY_UID" ] &&
  [ "$(stat -c %a -- "$VERIFY_SCRIPT" 2>/dev/null)" = "700" ] ||
  { echo "\u65f6\u533a\u56de\u6eda\u9a8c\u8bc1\u811a\u672c\u6240\u6709\u8005\u6216\u6743\u9650\u4e0d\u5b89\u5168"; exit 1; }
if [ -e "$CONSUMED_MARKER" ] || [ -L "$CONSUMED_MARKER" ]; then
  [ -d "$CONSUMED_MARKER" ] && [ ! -L "$CONSUMED_MARKER" ] ||
    { echo "\u65f6\u533a\u56de\u6eda\u6d88\u8d39\u6807\u8bb0\u4e0d\u5b89\u5168"; exit 1; }
  [ "$(stat -c %u -- "$CONSUMED_MARKER" 2>/dev/null)" = "$RECOVERY_UID" ] &&
    [ "$(stat -c %a -- "$CONSUMED_MARKER" 2>/dev/null)" = "700" ] ||
    { echo "\u65f6\u533a\u56de\u6eda\u6d88\u8d39\u6807\u8bb0\u6240\u6709\u8005\u6216\u6743\u9650\u4e0d\u5b89\u5168"; exit 1; }
  if ! sh -- "$VERIFY_SCRIPT"; then
    echo "\u65f6\u533a\u5df2\u6807\u8bb0\u4e3a\u5df2\u6d88\u8d39\uff0c\u4f46\u539f\u65f6\u533a\u9a8c\u8bc1\u5931\u8d25\uff0c\u65e0\u6cd5\u8c03\u548c"
    exit 1
  fi
  release_running_lock
  trap - EXIT HUP INT TERM
  printf '\u539f\u65f6\u533a\u5df2\u6062\u590d\uff0c\u56de\u6eda\u72b6\u6001\u5df2\u8c03\u548c: %s\\n' "$OLD_TIMEZONE"
  exit 0
fi
ROLLBACK_UID="$(id -u 2>/dev/null)" ||
  { echo "\u65e0\u6cd5\u786e\u8ba4\u5f53\u524d\u7528\u6237\uff0c\u672a\u6062\u590d\u65f6\u533a"; exit 1; }
ROLLBACK_AS=""
if [ "$ROLLBACK_UID" != "0" ]; then
  command -v sudo >/dev/null 2>&1 ||
    { echo "\u5f53\u524d\u4e0d\u662f root \u4e14\u6ca1\u6709 sudo\uff0c\u65e0\u6cd5\u6062\u590d\u65f6\u533a"; exit 1; }
  sudo -v || { echo "sudo \u6388\u6743\u5931\u8d25\uff0c\u672a\u6062\u590d\u65f6\u533a"; exit 1; }
  ROLLBACK_AS="sudo"
fi
if ! $ROLLBACK_AS timedatectl set-timezone "$OLD_TIMEZONE"; then
  echo "\u6062\u590d\u539f\u65f6\u533a\u5931\u8d25: $OLD_TIMEZONE"; exit 1
fi
sh -- "$VERIFY_SCRIPT"
create_consumed_marker || exit 1
release_running_lock
trap - EXIT HUP INT TERM
printf '\u5df2\u6062\u590d\u539f\u65f6\u533a: %s\\n' "$OLD_TIMEZONE"
SHELLPILOT_TIMEZONE_ROLLBACK
} > "$TMP_ROLLBACK"; then
  echo "\u65e0\u6cd5\u5199\u5165\u56de\u6eda\u811a\u672c"; exit 1
fi
if ! {
  printf '%s\\n' '#!/bin/sh' 'set -eu'
  printf "STATE_FILE='%s'\\n" "$STATE_FILE"
  cat <<'SHELLPILOT_TIMEZONE_VERIFY'
[ -r "$STATE_FILE" ] || { echo "\u65f6\u533a\u56de\u6eda\u72b6\u6001\u4e0d\u5b58\u5728"; exit 1; }
IFS= read -r OLD_TIMEZONE < "$STATE_FILE"
command -v timedatectl >/dev/null 2>&1 || { echo "\u7f3a\u5c11 timedatectl\uff0c\u65e0\u6cd5\u9a8c\u8bc1\u65f6\u533a"; exit 1; }
CURRENT_TIMEZONE="$(timedatectl show -p Timezone --value 2>/dev/null)" ||
  { echo "\u65e0\u6cd5\u8bfb\u53d6\u5f53\u524d\u65f6\u533a"; exit 1; }
[ "$CURRENT_TIMEZONE" = "$OLD_TIMEZONE" ] ||
  { echo "\u539f\u65f6\u533a\u6062\u590d\u9a8c\u8bc1\u5931\u8d25"; exit 1; }
printf '\u65f6\u533a\u56de\u6eda\u72b6\u6001\u9a8c\u8bc1\u6210\u529f: %s\\n' "$OLD_TIMEZONE"
SHELLPILOT_TIMEZONE_VERIFY
} > "$TMP_VERIFIER"; then
  echo "\u65e0\u6cd5\u5199\u5165\u56de\u6eda\u9a8c\u8bc1\u811a\u672c"; exit 1
fi
chmod 700 "$TMP_ROLLBACK" "$TMP_VERIFIER" || { echo "\u65e0\u6cd5\u8bbe\u7f6e\u56de\u6eda\u8d44\u4ea7\u6743\u9650"; exit 1; }
ROLLBACK_LINK_ATTEMPTED=yes
if ln -- "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"; then
  :
else
  echo "\u65e0\u6cd5\u539f\u5b50\u521b\u5efa\u56de\u6eda\u811a\u672c"; exit 1
fi
VERIFIER_LINK_ATTEMPTED=yes
if ln -- "$TMP_VERIFIER" "$VERIFY_SCRIPT"; then
  :
else
  echo "\u65e0\u6cd5\u539f\u5b50\u521b\u5efa\u56de\u6eda\u9a8c\u8bc1\u811a\u672c"; exit 1
fi
cleanup_owned_recovery_asset "$TMP_ROLLBACK" "$TMP_ROLLBACK_INODE" yes
cleanup_owned_recovery_asset "$TMP_VERIFIER" "$TMP_VERIFIER_INODE" yes
if [ -e "$TMP_ROLLBACK" ] || [ -L "$TMP_ROLLBACK" ] ||
  [ -e "$TMP_VERIFIER" ] || [ -L "$TMP_VERIFIER" ]; then
  echo "\u65e0\u6cd5\u6e05\u7406\u56de\u6eda\u8d44\u4ea7\u4e34\u65f6\u6587\u4ef6"
  exit 1
fi
[ -f "$ROLLBACK_SCRIPT" ] && [ ! -L "$ROLLBACK_SCRIPT" ] &&
  [ -f "$VERIFY_SCRIPT" ] && [ ! -L "$VERIFY_SCRIPT" ] ||
  { echo "\u56de\u6eda\u8d44\u4ea7\u521b\u5efa\u9a8c\u8bc1\u5931\u8d25"; exit 1; }
[ "$(stat -c %a -- "$ROLLBACK_SCRIPT")" = "700" ] &&
  [ "$(stat -c %a -- "$VERIFY_SCRIPT")" = "700" ] ||
  { echo "\u56de\u6eda\u8d44\u4ea7\u6743\u9650\u9a8c\u8bc1\u5931\u8d25"; exit 1; }
[ "$(stat -c %d:%i -- "$ROLLBACK_SCRIPT")" = "$TMP_ROLLBACK_INODE" ] &&
  [ "$(stat -c %d:%i -- "$VERIFY_SCRIPT")" = "$TMP_VERIFIER_INODE" ] ||
  { echo "\u56de\u6eda\u8d44\u4ea7\u5728\u53d1\u5e03\u671f\u95f4\u88ab\u66ff\u6362"; exit 1; }
RECOVERY_ASSETS_READY=yes

printf '\u56de\u6eda\u811a\u672c: %s\\n' "$ROLLBACK_SCRIPT"
printf '\u56de\u6eda\u9a8c\u8bc1\u811a\u672c: %s\\n' "$VERIFY_SCRIPT"
if ! $RUN_AS timedatectl set-timezone "$NEW_TIMEZONE"; then
  echo "\u4fee\u6539\u65f6\u533a\u5931\u8d25: $NEW_TIMEZONE"; exit 1
fi
FINAL_TIMEZONE="$(timedatectl show -p Timezone --value 2>/dev/null)" || FINAL_TIMEZONE=""
if [ "$FINAL_TIMEZONE" != "$NEW_TIMEZONE" ]; then
  echo "\u4fee\u6539\u540e\u65f6\u533a\u9a8c\u8bc1\u5931\u8d25\uff1b\u8bf7\u56de\u6eda: $ROLLBACK_SCRIPT"
  exit 1
fi
release_running_lock
trap - EXIT HUP INT TERM
printf '\u65f6\u533a\u4fee\u6539\u5e76\u9a8c\u8bc1\u6210\u529f\u3002\u56de\u6eda\u811a\u672c: %s\\n' "$ROLLBACK_SCRIPT"`

export function getSystemCommands () {
  return [
    defineCommand({
      id: 'builtin-server-overview',
      name: '系统概览',
      description: '查看运行时间、系统版本和当前登录用户。',
      usage: '用于快速判断服务器是否重启、系统类型和当前登录会话。',
      labels: [READ_ONLY, '系统'],
      advancedUsage: [
        '进一步看内核：uname -a',
        '进一步看登录来源：last -n 20'
      ],
      commands: [
        step('uptime'),
        step('hostnamectl 2>/dev/null || uname -a'),
        step('who -u')
      ]
    }),
    defineCommand({
      id: 'builtin-server-memory',
      name: '内存与 Swap',
      description: '查看内存、Swap 和占用内存最高的进程。',
      usage: '适合排查内存不足、Swap 过高、进程异常占用。',
      labels: [READ_ONLY, '内存'],
      advancedUsage: [
        '实时观察：vmstat 1 10',
        '按内存查看更多进程：ps aux --sort=-%mem | head -n 30'
      ],
      commands: [
        step('free -h'),
        step('ps aux --sort=-%mem | head -n 15')
      ]
    }),
    defineCommand({
      id: 'builtin-server-process-top',
      name: '进程资源排行',
      description: '按 CPU 和内存查看当前资源占用最高的进程。',
      usage: '用于初步定位高负载、高 CPU、高内存进程。',
      labels: [READ_ONLY, '进程'],
      advancedUsage: [
        '看进程树：pstree -ap 2>/dev/null | head -n 80',
        '查看指定 PID：ps -fp <PID>'
      ],
      commands: [
        step('ps aux --sort=-%cpu | head -n 15'),
        step('ps aux --sort=-%mem | head -n 15')
      ]
    }),
    defineCommand({
      id: 'builtin-server-time-query',
      name: '时间与时区',
      description: '查看系统时间、时区、NTP 同步状态和硬件时间。',
      usage: '适合排查证书过期、日志时间错乱、定时任务异常。',
      labels: [READ_ONLY, '时间'],
      advancedUsage: [
        '查看定时任务：systemctl list-timers --all --no-pager',
        '校验时间同步：timedatectl timesync-status 2>/dev/null'
      ],
      commands: [
        step('date -R'),
        step('timedatectl 2>/dev/null || true'),
        step('hwclock -r 2>/dev/null || true')
      ]
    }),
    defineCommand(withRollback({
      id: 'builtin-server-hostname-change',
      name: '\u4fee\u6539\u4e3b\u673a\u540d',
      description: '\u8bfb\u53d6\u5f53\u524d\u4e3b\u673a\u540d\u540e\u5b89\u5168\u4fee\u6539\uff0c\u5e76\u53ef\u9009\u62e9\u540c\u6b65\u66f4\u65b0 /etc/hosts\u3002',
      usage: '\u9ed8\u8ba4\u53ea\u9884\u89c8\uff1b\u786e\u8ba4\u540e\u521b\u5efa\u53d7\u63a7\u5907\u4efd\u548c\u56de\u6eda\u811a\u672c\uff0c\u9a8c\u8bc1\u65b0\u4e3b\u673a\u540d\u540e\u767b\u8bb0\u5feb\u6377\u56de\u6eda\u3002',
      labels: [NEED_EDIT, '\u7cfb\u7edf', '\u9ad8\u98ce\u9669'],
      params: [
        inputParam('\u65b0\u4e3b\u673a\u540d', '\u65b0\u4e3b\u673a\u540d', '', '\u586b\u5199\u5b8c\u6574\u4e3b\u673a\u540d\uff0c\u4f8b\u5982 web-01.example.com\u3002', '\u4f8b\u5982 web-01.example.com', {
          validationType: 'hostname',
          required: true
        }),
        selectParam('\u540c\u6b65Hosts', '\u540c\u6b65 /etc/hosts', 'yes', '\u540c\u6b65\u66f4\u65b0\u672c\u673a\u540d\u79f0\u6620\u5c04\u3002', [
          { label: '\u662f', value: 'yes' },
          { label: '\u5426', value: 'no' }
        ], {
          validationType: 'enum',
          required: true
        })
      ],
      commands: [step(HOSTNAME_CHANGE_COMMAND)]
    }, {
      title: '\u4fee\u6539\u4e3b\u673a\u540d',
      actionParam: '\u786e\u8ba4\u6267\u884c',
      mutatingValues: ['yes'],
      backupTargets: ['/etc/hosts'],
      verifyCommands: [
        'hostnamectl --static 2>/dev/null | awk -v expected="{{\u65b0\u4e3b\u673a\u540d}}" \'{ exit tolower($0) != tolower(expected) }\''
      ]
    })),
    defineCommand(withRollback({
      id: 'builtin-server-timezone-change',
      name: '\u4fee\u6539\u7cfb\u7edf\u65f6\u533a',
      description: '\u8bfb\u53d6\u5f53\u524d\u65f6\u533a\u5e76\u4ec5\u901a\u8fc7 timedatectl \u5b89\u5168\u5207\u6362\u5230\u5df2\u5b58\u5728\u7684\u76ee\u6807\u65f6\u533a\u3002',
      usage: '\u9ed8\u8ba4\u53ea\u9884\u89c8\uff1b\u786e\u8ba4\u540e\u4fdd\u5b58\u539f\u65f6\u533a\u3001\u751f\u6210\u56de\u6eda\u811a\u672c\u5e76\u9a8c\u8bc1\u6700\u7ec8\u65f6\u533a\u3002',
      labels: [NEED_EDIT, '\u65f6\u95f4', '\u9ad8\u98ce\u9669'],
      params: [
        inputParam('\u65b0\u65f6\u533a', '\u65b0\u65f6\u533a', 'Asia/Shanghai', '\u5fc5\u987b\u662f timedatectl list-timezones \u8fd4\u56de\u7684\u5b8c\u6574\u65f6\u533a\u540d\u79f0\u3002', '\u4f8b\u5982 Asia/Shanghai', {
          validationType: 'timezone',
          required: true
        })
      ],
      commands: [step(TIMEZONE_CHANGE_COMMAND)]
    }, {
      title: '\u4fee\u6539\u7cfb\u7edf\u65f6\u533a',
      actionParam: '\u786e\u8ba4\u6267\u884c',
      mutatingValues: ['yes'],
      backupTargets: [],
      verifyCommands: [
        'test "$(timedatectl show -p Timezone --value 2>/dev/null)" = "{{\u65b0\u65f6\u533a}}"'
      ]
    })),
    defineCommand({
      id: 'builtin-server-cpu-pressure',
      name: 'CPU \u538b\u529b\u8bca\u65ad',
      description: '\u67e5\u770b\u7cfb\u7edf\u8d1f\u8f7d\u3001\u9010\u6838 CPU \u4f7f\u7528\u7387\u4ee5\u53ca CPU\u3001I/O \u548c\u5185\u5b58\u538b\u529b\u6307\u6807\u3002',
      usage: '\u7528\u4e8e\u5b9a\u4f4d CPU \u9971\u548c\u3001\u8fd0\u884c\u961f\u5217\u5806\u79ef\u548c\u8d44\u6e90\u4e89\u7528\u5bfc\u81f4\u7684\u54cd\u5e94\u53d8\u6162\u3002',
      labels: [READ_ONLY, 'CPU'],
      advancedUsage: [
        'mpstat \u4e0d\u53ef\u7528\u65f6\u4f1a\u81ea\u52a8\u6539\u7528 vmstat \u91c7\u6837\u3002',
        '\u538b\u529b\u6307\u6807\u4f9d\u8d56 Linux PSI\uff0c\u65e7\u5185\u6838\u53ef\u80fd\u6ca1\u6709\u5bf9\u5e94\u6587\u4ef6\u3002'
      ],
      commands: [
        step('uptime || true'),
        step('mpstat -P ALL 1 3 || vmstat 1 4 || true'),
        step('cat /proc/pressure/cpu || true'),
        step('cat /proc/pressure/io || true'),
        step('cat /proc/pressure/memory || true')
      ]
    }),
    defineCommand({
      id: 'builtin-server-kernel-errors',
      name: '\u5185\u6838\u544a\u8b66\u4e0e\u9519\u8bef',
      description: '\u67e5\u770b\u6700\u8fd1 24 \u5c0f\u65f6\u7684\u5185\u6838\u544a\u8b66\u548c\u9519\u8bef\uff0c\u5e76\u517c\u5bb9\u6ca1\u6709 journalctl \u7684\u7cfb\u7edf\u3002',
      usage: '\u7528\u4e8e\u6392\u67e5\u9a71\u52a8\u3001\u786c\u4ef6\u3001\u6587\u4ef6\u7cfb\u7edf\u548c\u5185\u6838\u5b50\u7cfb\u7edf\u7684\u8fd1\u671f\u5f02\u5e38\u3002',
      labels: [READ_ONLY, '\u5185\u6838'],
      advancedUsage: [
        'journalctl \u67e5\u8be2\u5931\u8d25\u65f6\u4f1a\u56de\u9000\u5230\u5e26\u65f6\u95f4\u6233\u7684 dmesg \u8f93\u51fa\u3002'
      ],
      commands: [
        step("journalctl -k -p warning..alert --since '-24 hours' -n 200 --no-pager || dmesg -T | tail -n 200 || true")
      ]
    }),
    defineCommand({
      id: 'builtin-server-boot-history',
      name: '\u542f\u52a8\u4e0e\u5173\u673a\u5386\u53f2',
      description: '\u67e5\u770b\u6700\u8fd1\u7684\u542f\u52a8\u3001\u5173\u673a\u3001\u91cd\u542f\u8bb0\u5f55\u4ee5\u53ca systemd \u542f\u52a8\u4f1a\u8bdd\u5217\u8868\u3002',
      usage: '\u7528\u4e8e\u786e\u8ba4\u670d\u52a1\u5668\u91cd\u542f\u65f6\u95f4\u3001\u5f02\u5e38\u5173\u673a\u8bb0\u5f55\u548c\u53ef\u67e5\u8be2\u7684\u5386\u53f2\u542f\u52a8\u6279\u6b21\u3002',
      labels: [READ_ONLY, '\u542f\u52a8'],
      advancedUsage: [
        '\u53ef\u7ed3\u5408 journalctl -b -1 \u67e5\u770b\u4e0a\u4e00\u6b21\u542f\u52a8\u4f1a\u8bdd\u7684\u65e5\u5fd7\u3002'
      ],
      commands: [
        step('last -x -n 30 || true'),
        step('journalctl --list-boots --no-pager | tail -n 30 || true')
      ]
    }),
    defineCommand({
      id: 'builtin-server-process-detail',
      name: '进程详情查询',
      description: '按 PID 或进程名查看命令行、资源、端口、文件和线程信息。',
      usage: '适合排查进程占用过高、启动参数错误、端口冲突或文件句柄异常。',
      labels: [NEED_EDIT, '进程', READ_ONLY],
      editBeforeRun: true,
      confirmRequired: true,
      params: [
        selectParam('查询方式', '查询方式', 'name', '知道 PID 时更精确；不知道时可按进程名搜索。', [
          { label: '按进程名', value: 'name' },
          { label: '按 PID', value: 'pid' }
        ]),
        inputParam('进程关键字', '进程名或 PID', 'nginx', '进程名可填写 nginx、java、mysqld；PID 只填写数字。', '例如 nginx 或 1234'),
        numberParam('输出行数', '输出行数', '100', '限制 lsof 和线程输出行数，避免刷屏。', 20, 1000)
      ],
      advancedUsage: [
        '持续观察某 PID：top -H -p PID。',
        '查看系统调用：strace -p PID，生产环境使用前请评估性能影响。'
      ],
      commands: [
        step(`QUERY_MODE="{{查询方式}}"
QUERY="{{进程关键字}}"
LIMIT="{{输出行数}}"
if [ -z "$QUERY" ]; then echo "请填写进程名或 PID"; exit 1; fi
if [ "$QUERY_MODE" = "pid" ]; then PIDS="$QUERY"; else PIDS="$(pgrep -d ' ' -f -- "$QUERY")"; fi
if [ -z "$PIDS" ]; then echo "未找到匹配进程"; exit 1; fi
for PID in $PIDS; do
  echo "===== PID $PID ====="
  ps -fp "$PID"
  cat "/proc/$PID/status" 2>/dev/null | head -n 40
  ss -tunlp 2>/dev/null | grep "pid=$PID," || true
  lsof -p "$PID" 2>/dev/null | head -n "$LIMIT" || true
done`)
      ]
    })
  ]
}
