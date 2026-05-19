import { useEffect } from "react";

/**
 * P0-3: lightweight head setter used by heavy lazy routes (FreeCheckup) to
 * avoid pulling `react-helmet-async` (~31 KB) into their chunk.
 *
 * Imperatively sets document.title + the canonical/description/og:* meta tags.
 * No SSR concerns — the FreeCheckup route is client-only behind auth.
 */
interface SEOLiteProps {
  title: string;
  description: string;
  path?: string;
  type?: "website" | "article" | "profile";
}

const SITE_URL = "https://legendflow.tw";

function setMeta(selector: string, attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setLinkCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

export function SEOLite({ title, description, path = "/", type = "website" }: SEOLiteProps) {
  useEffect(() => {
    const url = `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
    const prevTitle = document.title;
    document.title = title;
    setMeta('meta[name="description"]', "name", "description", description);
    setLinkCanonical(url);
    setMeta('meta[property="og:title"]', "property", "og:title", title);
    setMeta('meta[property="og:description"]', "property", "og:description", description);
    setMeta('meta[property="og:url"]', "property", "og:url", url);
    setMeta('meta[property="og:type"]', "property", "og:type", type);
    return () => {
      document.title = prevTitle;
    };
  }, [title, description, path, type]);
  return null;
}

export default SEOLite;
