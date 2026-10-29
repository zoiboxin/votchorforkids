import { CIVIL_COLORS, POLICE_COLORS, SHOE_COLORS, SKIN_TONES, type Appearance } from "@votechor/shared";
import { connect } from "./net";
import { useGame } from "./store";

type Key = keyof Pick<Appearance, "fac" | "sex" | "age" | "cap">;
const OPTIONS: { label: string; key: Key; values: [string | number, string][] }[] = [
  { label: "Side", key: "fac", values: [["protester", "Protester"], ["police", "Police"]] },
  { label: "Body", key: "sex", values: [["boy", "Boy"], ["girl", "Girl"]] },
  { label: "Age", key: "age", values: [["kid", "Kid"], ["teen", "Teen"], ["young", "Young"], ["old", "Old"]] },
  { label: "Headwear", key: "cap", values: [[1, "Cap on"], [0, "No cap"]] },
];
function Swatches({ label, field, colors }: { label: string; field: "skin" | "shirt" | "shoe"; colors: string[] }) {
  const look = useGame((s) => s.look), setLook = useGame((s) => s.setLook);
  return (<div className="row"><b>{label}</b>{colors.map((c) => (
    <button key={c} className={`sw${look[field] === c ? " on" : ""}`} style={{ background: c }} aria-label={`${label} ${c}`} onClick={() => setLook({ [field]: c })} />))}</div>);
}
export function Creator() {
  const look = useGame((s) => s.look), name = useGame((s) => s.name), setLook = useGame((s) => s.setLook);
  return (
    <aside className="pan creator">
      <h1>VoteChor</h1>
      <p className="tag">The votes are missing. The protest is on. Everybody run!</p>
      <div className="row"><b>Your name</b><input value={name} maxLength={16} placeholder="Guest" onChange={(e) => useGame.setState({ name: e.target.value })} /></div>
      {OPTIONS.map((o) => (<div className="row" key={o.key}><b>{o.label}</b>{o.values.map(([v, t]) => (
        <button key={String(v)} className={`chip${look[o.key] === v ? " on" : ""}`}
          onClick={() => o.key === "fac" ? setLook({ fac: v as Appearance["fac"], shirt: v === "police" ? POLICE_COLORS[0] : CIVIL_COLORS[0], ...(v === "police" ? { cap: 1 } : {}) }) : setLook({ [o.key]: v })}>{t}</button>))}</div>))}
      <Swatches label="Skin" field="skin" colors={SKIN_TONES} />
      <Swatches label={look.fac === "police" ? "Uniform" : "Clothes"} field="shirt" colors={look.fac === "police" ? POLICE_COLORS : CIVIL_COLORS} />
      <Swatches label="Shoes" field="shoe" colors={SHOE_COLORS} />
      <button className="go" onClick={connect}>Play now</button>
      <p className="note">Joins a live 100-person city. Empty spots are filled by AI fillers that leave as real players arrive.</p>
    </aside>
  );
}
