import { allocationColor } from "@/lib/allocation-colors";
import type { ConceptBasket } from "@/lib/concept-basket";
import { formatBpsAsPercent } from "@/lib/format";

/** Compact link-card companion; the downloadable poster retains every holding. */
export function basketSocialImage(basket: ConceptBasket, cover: string) {
  const shown = basket.assets.slice(0, 4);
  const thesis = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(basket.thesis.replace(/\s+/gu, " ").trim()), ({ segment }) => segment);
  const description = thesis.length > 145 ? `${thesis.slice(0, 144).join("").trimEnd()}…` : thesis.join("");
  return <div style={{ display: "flex", width: "100%", height: "100%", background: "#0A0A0B", color: "#F6F6F4", padding: 48, flexDirection: "column" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #303032", paddingBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 36, fontWeight: 700 }}>
        <svg width="36" height="42" viewBox="0 0 24 24"><g fill="none" stroke="#FCEE0A" strokeWidth="1.7"><path d="M4.3 3.7 L6.5 2.5 L8.7 3.7 L8.7 21.5 L4.3 21.5 Z" /><path d="M9.8 10.7 L12 9.5 L14.2 10.7 L14.2 21.5 L9.8 21.5 Z" /><path d="M15.3 15.7 L17.5 14.5 L19.7 15.7 L19.7 21.5 L15.3 21.5 Z" /></g></svg>
        <span>Basalt</span>
      </div>
      <div style={{ display: "flex", color: "#AAA9A3", fontSize: 17, letterSpacing: 2 }}>STOCK BASKET</div>
    </div>
    <div style={{ display: "flex", gap: 42, paddingTop: 30, flex: 1 }}>
      <img src={cover} alt="" width={420} height={420} style={{ objectFit: "cover" }} />
      <div style={{ display: "flex", flexDirection: "column", width: 642, justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: basket.name.length > 40 ? 38 : basket.name.length > 24 ? 44 : 54, fontWeight: 700, letterSpacing: -2, lineHeight: 1.1, wordBreak: "break-word" }}>{basket.name}</div>
          {description && <div style={{ display: "flex", marginTop: 16, fontSize: 23, lineHeight: 1.3, maxHeight: 92, overflow: "hidden", color: "#AAA9A3", wordBreak: "break-word" }}>{description}</div>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {shown.map((asset) => <div key={asset.symbol} style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid #303032", padding: "9px 12px", fontSize: 19 }}>
              <div style={{ display: "flex", width: 8, height: 8, background: allocationColor(asset.symbol, asset.mint) }} />
              <span>{asset.symbol.length > 8 ? `${asset.symbol.slice(0, 7)}…` : asset.symbol}</span><span style={{ color: "#AAA9A3" }}>{formatBpsAsPercent(asset.weightBps)}</span>
            </div>)}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 17, color: "#AAA9A3" }}>
            <span>{basket.assets.length} holdings{basket.assets.length > 4 ? ` · +${basket.assets.length - 4} more in the basket` : ""}</span>
            <span>basalt.markets</span>
          </div>
        </div>
      </div>
    </div>
  </div>;
}
