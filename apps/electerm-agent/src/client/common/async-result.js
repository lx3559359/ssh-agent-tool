export function normalizeAsyncResult (result) {
  if (result == null) {
    return { ok: false, data: null, error: 'empty-response' }
  }
  if (result.error) {
    return {
      ok: false,
      data: result.data ?? null,
      error: result.error
    }
  }
  return {
    ok: true,
    data: result.data ?? result,
    error: ''
  }
}
