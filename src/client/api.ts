const messages: Record<string, string> = {
  VALIDATION_FAILED: "輸入內容未符合要求，請檢查必填欄位、文字長度與網址格式。",
  UNAUTHORIZED: "登入已失效，請重新登入 Studio。",
  LOGIN_FAILED: "密碼不正確，請重新輸入。",
  LOGIN_RATE_LIMIT: "嘗試次數過多，請在 15 分鐘後再試。",
  STUDIO_NOT_CONFIGURED: "Studio 存取尚未設定完成。",
  ORIGIN_FORBIDDEN: "無法從目前的頁面執行此操作，請回到 Studio 再試。",
  REVISION_CONFLICT:
    "世界已在另一個操作中更新。已重新讀取最新版本，請檢查內容後重試。",
  SOURCE_INCOMPLETE: "原作尚未完整閱讀，請先等候工作完成。",
  SOURCE_EMPTY: "沒有可讀取的原文，請提供完整文字或可存取的網址。",
  SOURCE_TOO_LARGE: "原作超過可接受的大小，請分割後再匯入。",
  SOURCE_FETCH_FAILED: "無法讀取此網頁，請改貼上原文或上傳文件。",
  SOURCE_NOT_FOUND: "找不到保存的原文。",
  WORLD_NOT_FOUND: "找不到這個世界，請回到工作總覽重新選擇。",
  GOOGLE_AUTH_REQUIRED:
    "此 Google 文件需要讀取授權，請確認檔案權限，或改上傳 DOCX。",
  GOOGLE_AUTH_FAILED: "Google 文件讀取授權未能完成，請確認服務存取設定。",
  GOOGLE_READ_FAILED: "無法讀取這份 Google 文件，請確認存取權限或改上傳 DOCX。",
  GOOGLE_URL_INVALID: "請輸入完整的 Google 文件網址。",
  URL_NOT_ALLOWED: "無法讀取此網址，請提供公開網頁或改貼上原文。",
  META_NOT_CONFIGURED: "模型服務尚未連接完成，目前無法開始處理。",
  UNRESOLVED_QUESTIONS: "仍有未儲存的確認回答，請先完成問答。",
  VISUAL_NOT_APPROVED: "目前版本尚未核准視覺預覽，請先完成校準。",
  VISUAL_REVIEW_REQUIRED:
    "這份預覽尚未通過審查，或已不是目前版本，請重新產生預覽。",
  STYLE_MISMATCH: "請先選定對應的視覺方向，再核准此預覽。",
  VISUAL_TARGET_INVALID: "找不到選取的風格或元素，請重新選擇。",
  STYLE_NOT_FOUND: "找不到選取的視覺方向。",
  WORLD_NOT_CONFIRMED: "請先在確認問答中確認世界設定。",
  WORLD_EMPTY: "世界內容尚未完整，請檢查來源閱讀與元素登錄。",
  STALE_TRANSLATION: "世界設定已更新，請重新建立並審查這個語系。",
  TRANSLATION_INCOMPLETE: "語系內容尚未完整，請補齊名稱、介紹、元素與特色。",
  TRANSLATION_NOT_APPROVED: "選取的語系尚未核准，請先完成語系校準。",
  TRANSLATION_REVIEW_REQUIRED: "語系尚有待調整項目，請儲存修改並重新審查。",
  SLUG_UNAVAILABLE: "這個網址名稱已被使用，請換一個名稱。",
  ENGLISH_REQUIRED: "公開網站必須包含英文語系。",
  DEPLOYMENT_VERIFICATION_FAILED:
    "公開網站未通過發布驗證，先前的版本仍保留。請稍後重試。",
  JOB_NOT_RETRYABLE: "這份工作目前無法重試，請重新整理狀態。",
  INTERNAL_ERROR: "暫時無法完成此操作，已保存的內容仍保留，請稍後再試。",
};
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (!headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(
      (options?.method || "GET").toUpperCase(),
    )
  )
    headers.set("Idempotency-Key", crypto.randomUUID());
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers,
    });
  } catch {
    throw new ApiError("連線中斷，請確認網路後重試。", "NETWORK", 0);
  }
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string; code?: string };
  } | null;
  if (!response.ok)
    throw new ApiError(
      messages[body?.error?.code || ""] ||
        body?.error?.message ||
        "無法完成此操作，請稍後再試。",
      body?.error?.code || "REQUEST_FAILED",
      response.status,
    );
  return body as T;
}
export function post<T>(path: string, body: unknown = {}): Promise<T> {
  return api(path, { method: "POST", body: JSON.stringify(body) });
}
export function patch<T>(path: string, body: unknown): Promise<T> {
  return api(path, { method: "PATCH", body: JSON.stringify(body) });
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "無法完成此操作，請重試。";
