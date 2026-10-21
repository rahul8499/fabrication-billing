import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "RS Fabrication Billing",
    short_name: "RS Fabrication",
    description: "Manage RS Fabrication invoices, quotations, purchases and GST reports.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f6f9",
    theme_color: "#14263a",
    lang: "en-IN",
    categories: ["business", "finance"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
