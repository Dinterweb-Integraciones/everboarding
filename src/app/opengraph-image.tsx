import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

export const alt = "Dinterweb";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default async function Image() {
  const logo = await readFile(join(process.cwd(), "public", "dinterweb.png"));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#111820",
          color: "white",
          fontFamily: "Arial, sans-serif",
          padding: "72px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "44px",
            width: "100%",
            height: "100%",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: "28px",
            background: "rgba(255,255,255,0.04)",
            padding: "64px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "220px",
              height: "220px",
              borderRadius: "44px",
              background: "#ffffff",
            }}
          >
            <img src={logoSrc} alt="" style={{ width: 150, height: 150 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <div
              style={{
                color: "#ff3b30",
                fontSize: "32px",
                fontWeight: 800,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
            >
              Dinterweb
            </div>
            <div
              style={{
                maxWidth: "720px",
                fontSize: "58px",
                lineHeight: 1.05,
                fontWeight: 900,
              }}
            >
              Strategic Roadmap & Capacity Manager
            </div>
            <div
              style={{
                maxWidth: "680px",
                color: "#c8d3df",
                fontSize: "28px",
                lineHeight: 1.35,
                fontWeight: 600,
              }}
            >
              Gestiona clientes, roadmap de estrategia y capacidad operativa.
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
