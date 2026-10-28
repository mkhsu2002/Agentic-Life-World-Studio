import type { WorldDetail, WorldDraft } from "../shared/contracts";
import { isFrameworkApproved } from "./world-review";

export function reviewTabStatus(detail: WorldDetail) {
  if (
    detail.jobs.some(
      (job) =>
        ["import", "analyze"].includes(job.kind) &&
        ["queued", "running"].includes(job.status),
    )
  )
    return "整理中";
  if (detail.importReview) return "需確認";
  if (!detail.world.framework) return "待建立";
  return isFrameworkApproved(detail) ? "已核准" : "待核准";
}
export function isVisualApproved(world: WorldDraft) {
  return (
    world.visualApproval?.revision === world.revision &&
    world.previews.some(
      (preview) =>
        preview.id === world.visualApproval?.previewId &&
        preview.revision === world.revision &&
        preview.styleId === world.selectedStyleId &&
        preview.review.verdict === "pass",
    )
  );
}
export function WorldWorkflow({
  detail,
  tab,
  busy,
  onNavigate,
  openImportReview,
  retry,
}: {
  detail: WorldDetail;
  tab: string;
  busy: boolean;
  onNavigate?: (tab: string) => void;
  openImportReview: () => void;
  retry: (id: string) => void;
}) {
  const active = detail.jobs.find(
    (job) =>
      ["import", "analyze"].includes(job.kind) &&
      ["queued", "running"].includes(job.status),
  );
  const failed = detail.jobs.find(
    (job) =>
      ["import", "analyze"].includes(job.kind) && job.status === "failed",
  );
  const { world, source } = detail;
  const read =
    source.segmentCount > 0 && source.processedCount === source.segmentCount;
  let title: string,
    description: string,
    label = "",
    target = "review";
  let action: (() => void) | undefined;
  let approvalLink = false;
  if (active) {
    title = read ? "正在整理世界設定" : "正在閱讀原作";
    description = read
      ? "原作閱讀已完成，正在整理世界設定、視覺依據與忠實度檢查。完成後會自動顯示審核入口，現在不需要核准。"
      : "正在逐段閱讀與整理原作。完成後會自動顯示審核入口，現在不需要核准。";
  } else if (detail.importReview) {
    title = "需要你確認後才能繼續整理";
    description =
      "已保留目前進度。請開啟確認對話，查看問題與可採用的處理方式。";
    label = "開啟確認對話";
    action = openImportReview;
  } else if (!world.framework && failed) {
    title = "世界整理暫時中斷";
    description = "已保存完成的進度，可以從中斷處重試。";
    label = "從已保存進度重試";
    action = () => retry(failed.id);
  } else if (!world.framework) {
    title = "下一步：建立世界審核表";
    description = read
      ? "原作閱讀已完成，請到世界審核建立設定表，再親自確認核心與補全。"
      : "請到原作與世界檢查閱讀進度與需要處理的事項。";
    label = read ? "前往建立審核表" : "查看原作進度";
    target = read ? "review" : "source";
  } else if (!isFrameworkApproved(detail)) {
    title = "下一步：親自核准世界設定";
    description =
      "請核對核心設定，逐項決定補全與探索範圍，並選定視覺方向。如有修改，請先儲存再核准。";
    label = tab === "review" ? "前往核准區" : "開啟世界審核表";
    approvalLink = tab === "review";
  } else if (!isVisualApproved(world)) {
    title = "下一步：校準並核准視覺試稿";
    description =
      "世界設定已由你核准。請前往視覺方向產生試稿，檢視後親自核准。";
    label = "前往視覺校準";
    target = "visual";
  } else if (world.status !== "confirmed") {
    title = "下一步：啟用這個世界";
    description =
      "目前版本的設定與視覺均已核准。請回世界審核的啟用區完成最後確認。";
    label = tab === "review" ? "前往啟用區" : "前往啟用世界";
    approvalLink = tab === "review";
  } else {
    title = "世界已啟用";
    description = "接著可以校準語系，再預覽並發布網站。";
    label = "前往語系校準";
    target = "translations";
  }
  return (
    <section className="panel workflow-next" aria-label="下一步">
      <div>
        <h2>{title}</h2>
        <p className="muted" role="status">
          {description}
        </p>
        {active && active.total > 0 && (
          <div className="workflow-progress">
            <progress
              aria-label="世界整理進度"
              value={active.completed}
              max={active.total}
            />
            <span>
              已完成 {active.completed} / {active.total} 個步驟
            </span>
          </div>
        )}
      </div>
      {label &&
        (approvalLink ? (
          <a
            className="primary"
            href={
              isFrameworkApproved(detail)
                ? "#world-activation"
                : "#world-review-approval"
            }
          >
            {label}
          </a>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={action || (() => onNavigate?.(target))}
          >
            {label}
          </button>
        ))}
    </section>
  );
}
