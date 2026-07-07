export function isSftpOverwriteConflict(result = {}) {
  if (!result || result.ok) return false;
  const message = String(result.message || "");
  return /文件已存在|已存在|宸插瓨|目标文件已存在|本地文件已存在/.test(message);
}

export function buildSftpOverwriteConfirmMessage(result = {}, direction = "transfer") {
  const action = direction === "download" ? "下载" : direction === "upload" ? "上传" : "传输";
  const paths = [result.remotePath, result.localPath]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const pathText = paths.length ? `\n\n${paths.join("\n")}` : "";
  return `${action}目标文件已存在，是否覆盖？${pathText}`;
}

export function buildSftpOverwriteCancelledResult(result = {}, direction = "transfer") {
  const action = direction === "download" ? "下载" : direction === "upload" ? "上传" : "传输";
  return {
    ...result,
    ok: false,
    cancelled: true,
    status: "cancelled",
    message: `已取消覆盖，${action}未执行。`,
  };
}
