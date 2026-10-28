import { useState } from "react";
import type { WorldDraft } from "../shared/contracts";
import { api, errorMessage, post } from "./api";
export type SourceImageInput = { label: string; dataUrl: string };
import {
  MAX_SOURCE_IMAGES as limit,
  MAX_SOURCE_IMAGE_BYTES as maxBytes,
  MAX_SOURCE_IMAGE_TOTAL_BYTES,
} from "../shared/source-image-limits";
function decodedBytes(images: SourceImageInput[]) {
  return images.reduce((total, image) => {
    const data = image.dataUrl.split(",")[1] || "";
    return (
      total +
      (data.length * 3) / 4 -
      (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0)
    );
  }, 0);
}
function fileData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("圖片無法讀取，請重新選擇。"));
    reader.readAsDataURL(file);
  });
}
async function readImages(files: File[], remaining: number) {
  if (files.length > remaining)
    throw new Error(`最多可加入 ${limit} 張原作參考圖。`);
  for (const file of files) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
      throw new Error("請選擇 PNG、JPEG 或 WebP 圖片。");
    if (file.size > maxBytes)
      throw new Error(`「${file.name}」超過 5 MB，請縮小後再選擇。`);
    if (!file.size) throw new Error(`「${file.name}」沒有可讀取的圖片內容。`);
  }
  const result: SourceImageInput[] = [];
  for (const file of files)
    result.push({
      label: file.name.slice(0, 200),
      dataUrl: await fileData(file),
    });
  return result;
}
export function SourceImageInputs({
  images,
  onChange,
  disabled = false,
  onBusyChange,
}: {
  images: SourceImageInput[];
  onChange: (images: SourceImageInput[]) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  return (
    <div className="form-stack">
      <label>
        原作參考圖（選填）
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          disabled={disabled || reading || images.length >= limit}
          onChange={async (event) => {
            const files = Array.from(event.currentTarget.files || []);
            event.currentTarget.value = "";
            if (!files.length) return;
            setError("");
            setReading(true);
            onBusyChange?.(true);
            try {
              const selected = [
                ...images,
                ...(await readImages(files, limit - images.length)),
              ];
              if (decodedBytes(selected) > MAX_SOURCE_IMAGE_TOTAL_BYTES)
                throw new Error(
                  "原作參考圖合計不可超過 15 MB，請縮小圖片後重試。",
                );
              onChange(selected);
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setReading(false);
              onBusyChange?.(false);
            }
          }}
        />
      </label>
      <p className="field-note">
        最多 6 張，每張 5 MB、合計 15 MB。參考圖只保存在私人
        Studio，用來核對原作的視覺特徵，不會隨世界網站公開。
      </p>
      {!!images.length && (
        <ul>
          {images.map((image, i) => (
            <li key={`${i}-${image.label}`}>
              <img
                src={image.dataUrl}
                alt={image.label}
                width={96}
                height={72}
                style={{ objectFit: "contain" }}
              />
              <span>{image.label}</span>{" "}
              <button
                type="button"
                className="quiet"
                disabled={disabled || reading}
                onClick={() =>
                  onChange(images.filter((_, index) => index !== i))
                }
                aria-label={`移除參考圖 ${image.label}`}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      )}
      {reading && (
        <p role="status" className="field-note">
          正在讀取圖片⋯
        </p>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
    </div>
  );
}

export function SourceImagePicker({
  world,
  onUploaded,
  disabled = false,
}: {
  world: WorldDraft;
  onUploaded: (world: WorldDraft) => void;
  disabled?: boolean;
}) {
  const [images, setImages] = useState<SourceImageInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  async function upload() {
    setBusy(true);
    setError("");
    const pending = [...images];
    let current = world;
    try {
      while (pending.length) {
        const detail = await api<{ world: WorldDraft }>(
          `/api/worlds/${encodeURIComponent(world.id)}`,
        );
        current = detail.world;
        const result = await post<{ world: WorldDraft }>(
          `/api/worlds/${encodeURIComponent(world.id)}/source-images`,
          {
            revision: current.revision,
            recordVersion: current.recordVersion,
            image: pending[0],
          },
        );
        current = result.world;
        pending.shift();
        setImages([...pending]);
        onUploaded(current);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const saved = world.sourceImages || [];
  return (
    <section className="form-stack" aria-label="原作參考圖">
      <div>
        <h3>原作參考圖</h3>
        <p className="field-note">
          補上原作中的配圖，讓世界設定與視覺方向有可核對的依據。加入新圖後，請重新檢視並核准世界設定。
        </p>
      </div>
      {!!saved.length && (
        <ul>
          {saved.map((image) => (
            <li key={image.id}>
              <a
                href={`/media/${encodeURIComponent(image.assetId)}`}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  src={`/media/${encodeURIComponent(image.assetId)}`}
                  alt={image.label}
                  width={96}
                  height={72}
                  style={{ objectFit: "contain" }}
                />
              </a>{" "}
              <span>
                {image.label} ·{" "}
                {image.status === "reviewed" ? "已檢視" : "已保存，待檢視"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <SourceImageInputs
        images={images}
        onChange={setImages}
        disabled={disabled || busy}
        onBusyChange={setReading}
      />
      {saved.length >= limit && (
        <p className="field-note">
          已保存 6
          張參考圖。可選擇原圖重新上傳以修復讀取問題；無法再新增不同圖片。
        </p>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error} 已上傳的圖片會保留，可繼續重試。
        </p>
      )}
      {!!images.length && (
        <button
          type="button"
          className="primary"
          disabled={disabled || busy || reading}
          onClick={() => void upload()}
        >
          {busy ? "正在保存⋯" : error ? "重試剩餘圖片" : "保存參考圖"}
        </button>
      )}
    </section>
  );
}
