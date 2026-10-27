import React from "react";
import { createRoot } from "react-dom/client";
import { Studio } from "./studio";
import { PublicSite } from "./public";
import "./styles.css";
import type { Locale } from "../shared/contracts";

const path = window.location.pathname;
const legacy = path.match(/^\/worlds\/([^/]+)\/?$/);
if (legacy)
  window.location.replace(`/en/worlds/${legacy[1]}${window.location.search}`);
const previewMatch = path.match(/^\/preview\/([^/]+)\/(en|zh-Hant|ja)\/?$/);
const publicMatch = path.match(/^\/(en|zh-Hant|ja)\/worlds\/([^/]+)\/?$/);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {previewMatch ? (
      <PublicSite
        locale={previewMatch[2] as Locale}
        previewId={decodeURIComponent(previewMatch[1])}
        returnWorldId={
          new URLSearchParams(location.search).get("world") || undefined
        }
      />
    ) : publicMatch ? (
      <PublicSite
        locale={publicMatch[1] as Locale}
        slug={decodeURIComponent(publicMatch[2])}
      />
    ) : legacy ? null : (
      <Studio />
    )}
  </React.StrictMode>,
);
