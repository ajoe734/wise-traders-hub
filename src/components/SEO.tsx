import { Helmet } from "react-helmet-async";

interface SEOProps {
  title: string;
  description: string;
  /** Path-only canonical, e.g. "/experts" or "/expert/foo". Leave empty for "/". */
  path?: string;
  /** og:type override (default "website"). Use "article" for blog/journal etc. */
  type?: "website" | "article" | "profile";
  /** Optional absolute image URL for og:image. */
  image?: string;
  /** Optional JSON-LD structured data (object or array). */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  /** If true, adds <meta name="robots" content="noindex"> for this route. */
  noindex?: boolean;
}

const SITE_URL = "https://legendflow.tw";

/**
 * Per-route SEO head. Overrides the sitewide tags shipped in index.html
 * so each public page sends its own title/description/canonical/og:* to
 * JS-executing crawlers (Google, Bing). Static og:* in index.html stays
 * as fallback for non-JS crawlers (LinkedIn/Slack/Facebook).
 */
export function SEO({
  title,
  description,
  path = "/",
  type = "website",
  image,
  jsonLd,
  noindex = false,
}: SEOProps) {
  const url = `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const ldArray = Array.isArray(jsonLd) ? jsonLd : jsonLd ? [jsonLd] : [];

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:type" content={type} />
      {image ? <meta property="og:image" content={image} /> : null}
      {noindex ? <meta name="robots" content="noindex,nofollow" /> : null}
      {ldArray.map((ld, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(ld)}
        </script>
      ))}
    </Helmet>
  );
}

export default SEO;
